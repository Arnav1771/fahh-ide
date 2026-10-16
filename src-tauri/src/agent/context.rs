//! Context-window accounting, /compact and /export.
//! Token counts are estimates (characters / 4): providers count differently and
//! not all report usage while streaming. The UI says "estimated".

use super::provider::{Msg, Provider};
use super::store::{SessionFile, TurnRec};
use serde::Serialize;
use std::sync::atomic::AtomicBool;

pub fn est_tokens(s: &str) -> u64 {
    (s.len() as u64).div_ceil(4)
}

pub fn msg_tokens(m: &Msg) -> u64 {
    match m {
        Msg::User { text } => est_tokens(text),
        Msg::Assistant { text, calls } => est_tokens(text) + calls.iter().map(|c| est_tokens(&c.name) + est_tokens(&c.args.to_string())).sum::<u64>(),
        Msg::ToolResult { content, .. } => est_tokens(content),
    }
}

pub fn history_tokens(h: &[Msg]) -> u64 {
    h.iter().map(msg_tokens).sum()
}

/// The model's context window, by name. A guess for unknown models; the list
/// is data, not a promise, so `/context` labels it as such.
pub fn window_for(model: &str) -> u64 {
    let m = model.to_lowercase();
    if m.contains("gemini") {
        1_000_000
    } else if m.contains("claude") {
        200_000
    } else if m.contains("gpt-oss") || m.contains("llama-3") || m.contains("qwen") || m.contains("gpt-4") {
        128_000
    } else {
        32_000
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ContextInfo {
    pub used: u64,
    pub window: u64,
    pub percent: u32,
    pub messages: usize,
}

pub fn context_info(history: &[Msg], system_tokens: u64, model: &str) -> ContextInfo {
    let used = history_tokens(history) + system_tokens;
    let window = window_for(model);
    ContextInfo { used, window, percent: ((used * 100) / window.max(1)).min(999) as u32, messages: history.len() }
}

fn render(msgs: &[Msg]) -> String {
    let mut out = String::new();
    for m in msgs {
        match m {
            Msg::User { text } => out += &format!("USER: {text}\n"),
            Msg::Assistant { text, calls } => {
                if !text.is_empty() {
                    out += &format!("ASSISTANT: {text}\n");
                }
                for c in calls {
                    out += &format!("ASSISTANT CALLED {} {}\n", c.name, super::tools::truncate(&c.args.to_string(), 300));
                }
            }
            Msg::ToolResult { name, content, .. } => out += &format!("RESULT of {name}: {}\n", super::tools::truncate(content, 600)),
        }
    }
    out
}

const SUMMARY_SYSTEM: &str = "You compress a coding agent's conversation. Write a summary another agent can continue from: the user's goals, decisions made, files changed (paths) and why, commands run and their outcomes, and what is still open. Plain text, under 400 words, no preamble.";

/// Index where the last user request starts: everything before it can be folded.
pub fn compaction_cut(history: &[Msg]) -> Option<usize> {
    let users: Vec<usize> = history.iter().enumerate().filter(|(_, m)| matches!(m, Msg::User { .. })).map(|(i, _)| i).collect();
    (users.len() >= 2).then(|| *users.last().unwrap())
}

/// Replace everything before the last request with one summary message.
/// Returns (messages folded, tokens before, tokens after) and fixes the step offsets.
pub async fn compact(history: &mut Vec<Msg>, turns: &mut [TurnRec], provider: &Provider, cancel: &AtomicBool) -> Result<(usize, u64, u64), String> {
    let cut = compaction_cut(history).ok_or("nothing to compact yet: only one request so far")?;
    let before = history_tokens(history);
    let transcript = super::tools::truncate(&render(&history[..cut]), 80_000);
    let mut sink = |_: &str| {};
    let reply = provider.complete(SUMMARY_SYSTEM, &[Msg::User { text: transcript }], &[], cancel, &mut sink).await?;
    if reply.text.trim().is_empty() {
        return Err("the model returned an empty summary".into());
    }
    let summary = Msg::User { text: format!("[Summary of the earlier conversation]\n{}", reply.text.trim()) };
    history.splice(..cut, [summary]);
    for t in turns.iter_mut() {
        t.hist_start = match t.hist_start {
            Some(s) if s >= cut => Some(s - cut + 1),
            _ => None,
        };
    }
    Ok((cut, before, history_tokens(history)))
}

pub fn export_markdown(f: &SessionFile) -> String {
    let mut out = format!("# {}\n\nSession `{}` in `{}`\n\n", f.title, f.id, f.workspace);
    for m in &f.history {
        match m {
            Msg::User { text } => out += &format!("## You\n\n{text}\n\n"),
            Msg::Assistant { text, calls } => {
                if !text.is_empty() {
                    out += &format!("## Fahh Local\n\n{text}\n\n");
                }
                for c in calls {
                    out += &format!("- tool `{}` `{}`\n", c.name, super::tools::truncate(&c.args.to_string(), 200));
                }
            }
            Msg::ToolResult { name, content, .. } => out += &format!("  - result of `{name}`: {}\n", super::tools::truncate(content, 300).replace('\n', " ")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::perm::Mode;
    use crate::agent::provider::{ModelTurn, ToolCall};

    fn convo() -> Vec<Msg> {
        vec![
            Msg::User { text: "first".into() },
            Msg::Assistant { text: "".into(), calls: vec![ToolCall { id: "1".into(), name: "read_file".into(), args: serde_json::json!({"path": "a"}) }] },
            Msg::ToolResult { id: "1".into(), name: "read_file".into(), content: "x".repeat(4000) },
            Msg::Assistant { text: "done one".into(), calls: vec![] },
            Msg::User { text: "second".into() },
            Msg::Assistant { text: "done two".into(), calls: vec![] },
        ]
    }

    #[test]
    fn estimates_and_windows() {
        assert_eq!(est_tokens("abcd"), 1);
        assert_eq!(est_tokens("abcde"), 2);
        assert!(history_tokens(&convo()) > 1000);
        assert_eq!(window_for("gemini-2.5-flash"), 1_000_000);
        assert_eq!(window_for("openai/gpt-oss-120b"), 128_000);
        assert_eq!(window_for("mystery"), 32_000);
        let c = context_info(&convo(), 100, "mystery");
        assert_eq!(c.window, 32_000);
        assert!(c.percent >= 3 && c.messages == 6, "{c:?}");
    }

    #[tokio::test]
    async fn compact_folds_older_turns_into_a_summary() {
        let mut h = convo();
        let mut turns = vec![
            TurnRec { id: 1, prompt: "first".into(), hist_start: Some(0), mode: Mode::Ask, at: 0 },
            TurnRec { id: 2, prompt: "second".into(), hist_start: Some(4), mode: Mode::Ask, at: 0 },
        ];
        let p = Provider::mock(vec![ModelTurn { text: "Read a, finished step one.".into(), calls: vec![] }]);
        let (folded, before, after) = compact(&mut h, &mut turns, &p, &AtomicBool::new(false)).await.unwrap();
        assert_eq!(folded, 4);
        assert!(after < before);
        assert_eq!(h.len(), 3);
        assert!(matches!(&h[0], Msg::User { text } if text.starts_with("[Summary of the earlier conversation]") && text.contains("finished step one")));
        assert!(matches!(&h[1], Msg::User { text } if text == "second"));
        assert_eq!(turns[0].hist_start, None); // folded into the summary
        assert_eq!(turns[1].hist_start, Some(1));
    }

    #[tokio::test]
    async fn compact_refuses_when_there_is_nothing_to_fold() {
        let mut h = vec![Msg::User { text: "only".into() }];
        let p = Provider::mock(vec![]);
        assert!(compact(&mut h, &mut [], &p, &AtomicBool::new(false)).await.unwrap_err().contains("nothing to compact"));
    }

    #[test]
    fn export_has_the_conversation() {
        let f = SessionFile {
            id: "s1".into(),
            title: "T".into(),
            workspace: "/w".into(),
            created: 0,
            updated: 0,
            next_turn: 3,
            turns: vec![],
            history: convo(),
            checkpoints: Default::default(),
            usage: Default::default(),
        };
        let md = export_markdown(&f);
        assert!(md.starts_with("# T") && md.contains("## You\n\nfirst") && md.contains("done two") && md.contains("tool `read_file`"));
    }
}
