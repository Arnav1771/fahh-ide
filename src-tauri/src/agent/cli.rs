//! `fahh-agent`: Fahh Local from a terminal, no window. Same core as the
//! editor panel (provider, tools, permission engine, checkpoints); this file
//! only parses arguments and talks to the terminal.
//!
//!   fahh-agent [--cwd DIR] [--provider P] [--model M] [--mode ask|auto-edit|plan] ["prompt"]
//!
//! No prompt starts a REPL. API keys come from environment variables only
//! (GROQ_API_KEY, GEMINI_API_KEY, NVIDIA_API_KEY, OPENROUTER_API_KEY,
//! ANTHROPIC_API_KEY) and are never printed.

use super::perm::{Mode, Workspace};
use super::provider::{ModelTurn, Provider, ProviderConfig, ProviderKind};
use super::{run_turn, AgentEvent, Context, Decision, Session, Sink, TurnInput};
use std::io::{BufRead, Write};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

pub const USAGE: &str = "usage: fahh-agent [--cwd DIR] [--provider groq|gemini|nvidia|openrouter|ollama|anthropic] \
[--model M] [--mode ask|auto-edit|plan] [\"prompt\"]\n(no prompt: interactive; `fahh-agent models list` shows the models your key can use; keys come from GROQ_API_KEY, GEMINI_API_KEY, NVIDIA_API_KEY, OPENROUTER_API_KEY, ANTHROPIC_API_KEY)";

#[derive(Debug, PartialEq)]
pub struct Cli {
    pub cwd: String,
    pub provider: String,
    pub model: Option<String>,
    pub mode: Mode,
    pub prompt: Option<String>,
}

pub struct Preset {
    pub kind: ProviderKind,
    pub base_url: &'static str,
    pub key_env: &'static str,
}

pub fn preset(name: &str) -> Option<Preset> {
    // No default model on purpose: models come and go, so ask the provider (`fahh-agent models list`).
    let p = |kind, base_url, key_env| Some(Preset { kind, base_url, key_env });
    match name {
        "groq" => p(ProviderKind::Openai, "https://api.groq.com/openai/v1", "GROQ_API_KEY"),
        "gemini" => p(ProviderKind::Openai, "https://generativelanguage.googleapis.com/v1beta/openai", "GEMINI_API_KEY"),
        "nvidia" => p(ProviderKind::Openai, "https://integrate.api.nvidia.com/v1", "NVIDIA_API_KEY"),
        "openrouter" => p(ProviderKind::Openai, "https://openrouter.ai/api/v1", "OPENROUTER_API_KEY"),
        "ollama" => p(ProviderKind::Openai, "http://localhost:11434/v1", ""),
        "anthropic" => p(ProviderKind::Anthropic, "https://api.anthropic.com", "ANTHROPIC_API_KEY"),
        _ => None,
    }
}

pub fn parse_args(args: &[String]) -> Result<Cli, String> {
    let mut cli = Cli { cwd: ".".into(), provider: "groq".into(), model: None, mode: Mode::Ask, prompt: None };
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let mut val = |name: &str| it.next().cloned().ok_or(format!("{name} needs a value"));
        match a.as_str() {
            "--cwd" => cli.cwd = val("--cwd")?,
            "--provider" => {
                cli.provider = val("--provider")?;
                if cli.provider != "mock" && preset(&cli.provider).is_none() {
                    return Err(format!("unknown provider `{}`", cli.provider));
                }
            }
            "--model" => cli.model = Some(val("--model")?),
            "--mode" => {
                cli.mode = match val("--mode")?.as_str() {
                    "ask" => Mode::Ask,
                    "auto-edit" => Mode::AutoEdit,
                    "plan" => Mode::Plan,
                    m => return Err(format!("unknown mode `{m}` (ask, auto-edit, plan)")),
                }
            }
            "-h" | "--help" => return Err(String::new()),
            s if s.starts_with("--") => return Err(format!("unknown option {s}")),
            _ => {
                let p = cli.prompt.get_or_insert_with(String::new);
                if !p.is_empty() {
                    p.push(' ');
                }
                p.push_str(a);
            }
        }
    }
    Ok(cli)
}

/// `get_env` is injected so tests need no real environment.
pub fn build_provider(cli: &Cli, get_env: impl Fn(&str) -> Option<String>) -> Result<Provider, String> {
    if cli.provider == "mock" {
        // scripted turns for tests and demos: a JSON array of {text, calls}
        let path = get_env("FAHH_AGENT_MOCK_SCRIPT").ok_or("FAHH_AGENT_MOCK_SCRIPT is not set")?;
        let turns: Vec<ModelTurn> = serde_json::from_str(&std::fs::read_to_string(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        return Ok(Provider::mock(turns));
    }
    let p = preset(&cli.provider).ok_or("unknown provider")?;
    let api_key = if p.key_env.is_empty() { None } else { get_env(p.key_env).filter(|k| !k.trim().is_empty()) };
    if !p.key_env.is_empty() && api_key.is_none() {
        return Err(format!("{} is not set (export it, or pick another --provider)", p.key_env));
    }
    let model = cli
        .model
        .clone()
        .or_else(|| get_env("FAHH_AGENT_MODEL"))
        .ok_or(format!("no model: pass --model (see `fahh-agent models list --provider {}`)", cli.provider))?;
    Ok(Provider::Http(ProviderConfig { kind: p.kind, base_url: p.base_url.into(), model, api_key }))
}

fn read_line() -> Option<String> {
    let mut s = String::new();
    match std::io::stdin().lock().read_line(&mut s) {
        Ok(0) | Err(_) => None, // no terminal: never approve by default
        Ok(_) => Some(s.trim().to_string()),
    }
}

fn prompt_user(text: &str) -> Option<String> {
    eprint!("{text}");
    let _ = std::io::stderr().flush();
    read_line()
}

fn one_line(s: &str, max: usize) -> String {
    let s = s.lines().next().unwrap_or("");
    if s.chars().count() > max { format!("{}...", s.chars().take(max).collect::<String>()) } else { s.to_string() }
}

fn answer(ev: &AgentEvent) -> Decision {
    let AgentEvent::ApprovalRequest { summary, command, old_text, new_text, tool, .. } = ev else { return Decision { allow: false, always: false, command: None } };
    eprintln!("\n? {summary}");
    if let Some(c) = command {
        eprintln!("    $ {c}");
    } else {
        for l in old_text.iter().flat_map(|t| t.lines().take(12)) {
            eprintln!("    - {l}");
        }
        for l in new_text.iter().flat_map(|t| t.lines().take(12)) {
            eprintln!("    + {l}");
        }
    }
    let opts = if tool == "run_command" { "[y]es / [N]o / [a]lways / [e]dit" } else { "[y]es / [N]o / [a]lways" };
    match prompt_user(&format!("  allow? {opts} > ")).as_deref().map(str::to_lowercase).as_deref() {
        Some("y" | "yes") => Decision { allow: true, always: false, command: None },
        Some("a" | "always") => Decision { allow: true, always: true, command: None },
        Some("e" | "edit") if tool == "run_command" => {
            let edited = prompt_user("  command > ").filter(|c| !c.is_empty());
            Decision { allow: edited.is_some(), always: false, command: edited }
        }
        _ => Decision { allow: false, always: false, command: None },
    }
}

/// What a turn ended in, for the exit code and the plan hand-off.
#[derive(Default)]
struct Outcome {
    ok: bool,
    plan: Option<String>,
}

fn make_sink(s: Arc<Session>, out: Arc<Mutex<Outcome>>) -> Sink {
    Arc::new(move |ev| {
        match &ev {
            AgentEvent::TextDelta { text, .. } => {
                print!("{text}");
                let _ = std::io::stdout().flush();
            }
            AgentEvent::ToolCall { name, args, .. } => println!("\n  > {name} {}", one_line(&args.to_string(), 100)),
            AgentEvent::ToolResult { ok, output, .. } => println!("    {} {}", if *ok { "ok" } else { "failed:" }, if *ok { String::new() } else { one_line(output, 120) }),
            AgentEvent::FileChanged { path, .. } => println!("    changed {path}"),
            AgentEvent::PlanWritten { path, .. } => {
                println!("\n  plan written to {path}");
                out.lock().unwrap().plan = Some(path.clone());
            }
            AgentEvent::ApprovalRequest { id, .. } => {
                let d = answer(&ev);
                s.resolve(id, d);
            }
            AgentEvent::Done { steps, files, .. } => {
                println!("\n[done in {steps} step(s); changed: {}]", if files.is_empty() { "nothing".into() } else { files.join(", ") });
                out.lock().unwrap().ok = true;
            }
            AgentEvent::Error { message, .. } => eprintln!("\nerror: {message}"),
            AgentEvent::TurnStarted { .. } => {}
        }
    })
}

/// `fahh-agent models list [--provider P]`: what this key can use right now.
async fn models_list(args: &[String]) -> i32 {
    let cli = match parse_args(args) {
        Ok(c) => c,
        Err(e) => return fail(&e),
    };
    let Some(p) = preset(&cli.provider) else { return fail("choose a real --provider") };
    let key = (!p.key_env.is_empty()).then(|| std::env::var(p.key_env).ok()).flatten();
    if !p.key_env.is_empty() && key.is_none() {
        return fail(&format!("{} is not set", p.key_env));
    }
    let cfg = ProviderConfig { kind: p.kind, base_url: p.base_url.into(), model: String::new(), api_key: key };
    match super::provider::list_models(&cfg).await {
        Ok(ids) => {
            ids.iter().for_each(|m| println!("{m}"));
            0
        }
        Err(e) => fail(&e),
    }
}

/// Run the CLI; returns the process exit code.
pub async fn main_cli(args: Vec<String>, provider_override: Option<Provider>) -> i32 {
    if args.first().map(String::as_str) == Some("models") {
        return match args.get(1).map(String::as_str) {
            Some("list") => models_list(&args[2..]).await,
            _ => fail("usage: fahh-agent models list [--provider P]"),
        };
    }
    let cli = match parse_args(&args) {
        Ok(c) => c,
        Err(e) => {
            if e.is_empty() {
                println!("{USAGE}");
                return 0;
            }
            eprintln!("fahh-agent: {e}\n{USAGE}");
            return 2;
        }
    };
    let ws = match Workspace::new(&cli.cwd) {
        Ok(w) => w,
        Err(e) => return fail(&e),
    };
    let provider = match provider_override.map(Ok).unwrap_or_else(|| build_provider(&cli, |k| std::env::var(k).ok())) {
        Ok(p) => p,
        Err(e) => return fail(&e),
    };
    let session = Arc::new(Session::new("cli".into(), ws, Default::default()));
    let outcome = Arc::new(Mutex::new(Outcome::default()));
    let sink = make_sink(session.clone(), outcome.clone());

    let mut turn_once = |prompt: String, mode: Mode| {
        let (s, p, sink) = (session.clone(), &provider, sink.clone());
        let outcome = outcome.clone();
        async move {
            *outcome.lock().unwrap() = Outcome::default();
            let turn = s.next_turn.fetch_add(1, Ordering::Relaxed);
            let input = TurnInput { prompt, mode, context: Context::default() };
            run_turn(&s, p, input, turn, &sink).await;
            let o = outcome.lock().unwrap();
            (o.ok, o.plan.clone())
        }
    };

    let mut code = 0;
    let mut prompts = cli.prompt.clone().map(|p| vec![p]).unwrap_or_default();
    let interactive = prompts.is_empty();
    loop {
        let prompt = match prompts.pop() {
            Some(p) => p,
            None if interactive => match prompt_user("\nfahh> ") {
                Some(l) if matches!(l.as_str(), "" | "exit" | "quit" | "/quit") => break,
                Some(l) => l,
                None => break,
            },
            None => break,
        };
        let (ok, plan) = turn_once(prompt, cli.mode).await;
        code = if ok { 0 } else { 1 };
        if let (true, Some(path)) = (ok, plan) {
            if matches!(prompt_user(&format!("Implement {path}? [y/N] > ")).as_deref(), Some("y" | "Y" | "yes")) {
                let (ok2, _) = turn_once(format!("Implement the approved plan in {path}, step by step."), Mode::Ask).await;
                code = if ok2 { 0 } else { 1 };
            }
        }
    }
    code
}

fn fail(msg: &str) -> i32 {
    eprintln!("fahh-agent: {msg}");
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_flags_and_joins_the_prompt() {
        let c = parse_args(&a(&["--cwd", "/x", "--provider", "gemini", "--model", "m", "--mode", "plan", "fix", "the", "bug"])).unwrap();
        assert_eq!(c, Cli { cwd: "/x".into(), provider: "gemini".into(), model: Some("m".into()), mode: Mode::Plan, prompt: Some("fix the bug".into()) });
        let d = parse_args(&[]).unwrap();
        assert_eq!((d.provider.as_str(), d.mode, d.prompt), ("groq", Mode::Ask, None));
    }

    #[test]
    fn rejects_bad_input() {
        assert!(parse_args(&a(&["--mode", "yolo"])).is_err());
        assert!(parse_args(&a(&["--provider", "nope"])).is_err());
        assert!(parse_args(&a(&["--model"])).is_err());
        assert!(parse_args(&a(&["--wat"])).is_err());
        assert_eq!(parse_args(&a(&["--help"])), Err(String::new()));
    }

    #[test]
    fn provider_keys_come_from_the_environment_only() {
        let cli = parse_args(&a(&["--provider", "groq", "hi"])).unwrap();
        assert!(build_provider(&cli, |_| None).unwrap_err().contains("GROQ_API_KEY"));
        let env = |k: &str| (k == "GROQ_API_KEY").then(|| "sk-test".to_string());
        // no hardcoded default model: it must be named
        assert!(build_provider(&cli, env).unwrap_err().contains("no model"));
        let cli = parse_args(&a(&["--provider", "groq", "--model", "m1", "hi"])).unwrap();
        let p = build_provider(&cli, env).unwrap();
        match p {
            Provider::Http(c) => {
                assert_eq!(c.model, "m1");
                assert!(!format!("{c:?}").contains("sk-test"));
            }
            _ => panic!("expected http provider"),
        }
        let ollama = parse_args(&a(&["--provider", "ollama"])).unwrap();
        assert!(build_provider(&ollama, |k| (k == "FAHH_AGENT_MODEL").then(|| "x".to_string())).is_ok()); // no key needed
    }
}
