//! Slash commands for the fahh-agent REPL. The command table is the same JSON
//! file the panel's "/" menu reads (`src/lib/slash-commands.json`), so the two
//! surfaces cannot drift apart.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct SlashDef {
    pub name: String,
    pub aliases: Vec<String>,
    pub group: String,
    pub icon: String,
    pub desc: String,
    pub args: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Slash {
    /// Canonical name (aliases resolved).
    pub name: String,
    pub arg: String,
}

pub fn registry() -> Vec<SlashDef> {
    serde_json::from_str(include_str!("../../../src/lib/slash-commands.json")).expect("slash-commands.json is valid")
}

/// `None` when the line is not a slash command at all (so it is a normal prompt).
pub fn parse(line: &str) -> Option<Result<Slash, String>> {
    let line = line.trim();
    let rest = line.strip_prefix('/')?;
    let (word, arg) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
    if word.is_empty() || word.contains('/') {
        return None; // "/usr/bin/x ..." or a lone slash is a prompt, not a command
    }
    let word = word.to_lowercase();
    let def = registry().into_iter().find(|d| d.name == word || d.aliases.contains(&word));
    Some(match def {
        Some(d) => Ok(Slash { name: d.name, arg: arg.trim().to_string() }),
        None => Err(format!("unknown command /{word}; /help lists them")),
    })
}

/// The /help text, grouped.
pub fn help_text() -> String {
    let mut out = String::new();
    let mut group = String::new();
    for d in registry() {
        if d.group != group {
            out += &format!("\n{}\n", d.group);
            group = d.group.clone();
        }
        let usage = format!("/{} {}", d.name, d.args.clone().unwrap_or_default());
        out += &format!("  {:<28} {}\n", usage.trim_end(), d.desc);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_names_aliases_and_arguments() {
        assert_eq!(parse("/plan fix the bug").unwrap().unwrap(), Slash { name: "plan".into(), arg: "fix the bug".into() });
        assert_eq!(parse("  /YOLO  go ").unwrap().unwrap(), Slash { name: "bypass".into(), arg: "go".into() });
        assert_eq!(parse("/dangerous").unwrap().unwrap().name, "bypass");
        assert_eq!(parse("/new").unwrap().unwrap().name, "clear");
        assert_eq!(parse("/list-sessions").unwrap().unwrap().name, "ls");
        assert_eq!(parse("/rename-session My title").unwrap().unwrap(), Slash { name: "title".into(), arg: "My title".into() });
        assert_eq!(parse("/ask\nwhat is x").unwrap().unwrap().arg, "what is x");
        assert_eq!(parse("/?").unwrap().unwrap().name, "help");
    }

    #[test]
    fn non_commands_and_unknown_commands() {
        assert!(parse("fix it").is_none());
        assert!(parse("/").is_none());
        assert!(parse("/usr/bin/env python").is_none());
        assert!(parse("/nope").unwrap().unwrap_err().contains("unknown command /nope"));
    }

    #[test]
    fn registry_is_consistent() {
        let r = registry();
        let mut seen = std::collections::HashSet::new();
        for d in &r {
            assert!(seen.insert(d.name.clone()), "duplicate {}", d.name);
            for a in &d.aliases {
                assert!(seen.insert(a.clone()), "alias clash {a}");
            }
            assert!(!d.desc.is_empty() && !d.icon.is_empty());
        }
        // everything in the addendum's list is there
        for n in ["model", "mode", "ask", "plan", "code", "smart", "bypass", "compact", "context", "fast", "loop", "btw", "clear", "continue", "resume", "ls", "title", "rm-session", "steps", "fork", "revert", "export", "copy", "exit", "usage", "workspace", "add-dir", "remove-dir", "help", "shortcuts", "config", "agents", "agent"] {
            assert!(seen.contains(n), "missing /{n}");
        }
        assert!(help_text().contains("/loop <prompt>"));
    }
}
