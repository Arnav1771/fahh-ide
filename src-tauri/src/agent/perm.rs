//! Permission engine for Fahh Local.
//!
//! Every tool call is classified (`Kind`), its target (a workspace-relative path
//! or a shell command) is checked, and the engine answers Allow / Ask / Deny.
//! Order of precedence: built-in denies, user deny rules, plan-mode lockdown,
//! user ask rules, user allow rules, then the mode default. Deny always wins.
//!
//! Composer rule, carried over: an edit is never applied silently to a file the
//! user did not see. In Ask mode every edit is an approval that names the exact
//! file and shows the diff; the approval is bound to that path. A file with
//! unsaved changes in the editor asks even in Auto-edit mode.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    #[default]
    Ask,
    AutoEdit,
    Plan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Read,
    Edit,
    Run,
    Plan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Allow,
    Ask,
    Deny,
}

/// One rule in `.fahh/permissions.json`. For `run` the pattern is a glob over
/// the command line; for `read`/`edit` a glob over the workspace-relative path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rule {
    pub action: Action,
    pub kind: Kind,
    pub pattern: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    Allow,
    Ask,
    Deny(String),
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PermFile {
    #[serde(default)]
    rules: Vec<Rule>,
}

/// `*` matches any run of characters (including `/`), `?` one character.
pub fn glob_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0, 0);
    let (mut star, mut mark) = (None, 0);
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = ti;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

const CHAIN_CHARS: &[char] = &[';', '&', '|', '<', '>', '`', '$', '\n', '\r', '(', ')'];

fn has_chaining(cmd: &str) -> bool {
    cmd.contains(CHAIN_CHARS)
}

/// The command line and each simple command inside it (split on `; & | newline`).
fn segments(cmd: &str) -> Vec<String> {
    let mut out = vec![cmd.trim().to_string()];
    for s in cmd.split([';', '&', '|', '\n']) {
        let s = s.trim();
        if !s.is_empty() {
            out.push(s.to_string());
        }
    }
    out
}

const READ_ONLY_CMDS: &[&str] = &[
    "ls", "cat", "head", "tail", "pwd", "wc", "grep", "rg", "tree", "which", "file", "stat", "du", "df", "dir", "type",
];
const READ_ONLY_GIT: &[&str] = &["status", "log", "diff", "show", "branch", "rev-parse", "ls-files", "blame"];

/// True for a single plain command that cannot write: used by Plan mode.
pub fn is_read_only_command(cmd: &str) -> bool {
    let cmd = cmd.trim();
    if cmd.is_empty() || has_chaining(cmd) {
        return false;
    }
    let mut words = cmd.split_whitespace();
    let first = words.next().unwrap_or("");
    if first == "git" {
        let sub = words.next().unwrap_or("");
        return READ_ONLY_GIT.contains(&sub) && !cmd.contains("--output");
    }
    if first == "find" {
        return !cmd.contains("-exec") && !cmd.contains("-delete") && !cmd.contains("-ok");
    }
    READ_ONLY_CMDS.contains(&first)
}

/// Commands nobody should run from an agent, whatever the rules say.
const BUILTIN_DENY_RUN: &[&str] = &[
    "sudo *",
    "su *",
    "rm -rf /*",
    "rm -rf ~*",
    "rm -fr /*",
    "mkfs*",
    "dd *of=/dev/*",
    "*|*sh",
    "*|*bash",
    "git push*--force*",
    "git push*-f *",
    "del /s*",
    "rd /s*",
];
const BUILTIN_DENY_EDIT: &[&str] = &[".git/*", ".fahh/permissions.json"];

#[derive(Debug, Clone, Default)]
pub struct Engine {
    pub mode: Mode,
    pub rules: Vec<Rule>,
    /// Workspace-relative paths with unsaved changes in the editor.
    pub dirty: HashSet<String>,
}

impl Engine {
    pub fn decide(&self, kind: Kind, target: &str) -> Verdict {
        // 1. built-in denies
        match kind {
            Kind::Run => {
                for seg in segments(target) {
                    if BUILTIN_DENY_RUN.iter().any(|p| glob_match(p, &seg)) {
                        return Verdict::Deny(format!("`{target}` is blocked for safety"));
                    }
                }
            }
            Kind::Edit if BUILTIN_DENY_EDIT.iter().any(|p| glob_match(p, target)) => {
                return Verdict::Deny(format!("{target} is protected"));
            }
            _ => {}
        }
        // 2. user deny rules
        if self.matching(Action::Deny, kind, target) {
            return Verdict::Deny(format!("denied by a rule in .fahh/permissions.json: {target}"));
        }
        // 3. plan mode is read-only
        if self.mode == Mode::Plan {
            match kind {
                Kind::Edit => return Verdict::Deny("plan mode is read-only; write a plan instead".into()),
                Kind::Run if !is_read_only_command(target) => {
                    return Verdict::Deny("plan mode only allows read-only commands".into())
                }
                _ => {}
            }
        }
        // 4. ask beats allow
        if self.matching(Action::Ask, kind, target) {
            return Verdict::Ask;
        }
        if kind == Kind::Edit && self.dirty.contains(target) {
            return Verdict::Ask; // unsaved edits in the editor: never overwrite silently
        }
        if self.matching(Action::Allow, kind, target) {
            return Verdict::Allow;
        }
        // 5. defaults
        match kind {
            Kind::Read | Kind::Plan => Verdict::Allow,
            Kind::Edit if self.mode == Mode::AutoEdit => Verdict::Allow,
            Kind::Run if self.mode == Mode::Plan => Verdict::Allow, // read-only, checked above
            _ => Verdict::Ask,
        }
    }

    fn matching(&self, action: Action, kind: Kind, target: &str) -> bool {
        self.rules.iter().filter(|r| r.action == action && r.kind == kind).any(|r| {
            if kind == Kind::Run {
                if action == Action::Allow {
                    // an allow must cover the whole command and never a chained one
                    !has_chaining(target) && glob_match(&r.pattern, target.trim())
                } else {
                    segments(target).iter().any(|s| glob_match(&r.pattern, s))
                }
            } else {
                glob_match(&r.pattern, target)
            }
        })
    }
}

// ─── rules file ───────────────────────────────────────────────────────────────

pub fn rules_path(ws: &Workspace) -> PathBuf {
    ws.root.join(".fahh").join("permissions.json")
}

pub fn load_rules(ws: &Workspace) -> Vec<Rule> {
    std::fs::read_to_string(rules_path(ws))
        .ok()
        .and_then(|s| serde_json::from_str::<PermFile>(&s).ok())
        .map(|f| f.rules)
        .unwrap_or_default()
}

/// "Always allow": persist one allow rule for this project (deduplicated).
pub fn save_always_allow(ws: &Workspace, kind: Kind, pattern: &str) -> Result<(), String> {
    let mut rules = load_rules(ws);
    let rule = Rule { action: Action::Allow, kind, pattern: pattern.to_string() };
    if !rules.contains(&rule) {
        rules.push(rule);
    }
    let path = rules_path(ws);
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&PermFile { rules }).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

// ─── workspace paths ──────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct Workspace {
    pub root: PathBuf,
}

fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

impl Workspace {
    pub fn new(root: &str) -> Result<Self, String> {
        let root = std::fs::canonicalize(root).map_err(|e| format!("workspace not found: {e}"))?;
        if !root.is_dir() {
            return Err("workspace is not a folder".into());
        }
        Ok(Self { root })
    }

    /// Resolve a model-supplied path to (absolute path, workspace-relative path with `/`).
    /// Fails for anything outside the workspace; for writes also for any path that
    /// passes through a symlink.
    pub fn resolve(&self, input: &str, write: bool) -> Result<(PathBuf, String), String> {
        if input.trim().is_empty() {
            return Err("empty path".into());
        }
        let p = Path::new(input);
        let abs = normalize(&if p.is_absolute() { p.to_path_buf() } else { self.root.join(p) });

        // canonicalise the deepest existing ancestor, then re-append the rest
        let mut existing = abs.clone();
        let mut rest: Vec<std::ffi::OsString> = Vec::new();
        while !existing.exists() {
            match existing.file_name() {
                Some(n) => rest.push(n.to_os_string()),
                None => return Err("path outside the workspace".into()),
            }
            if !existing.pop() {
                return Err("path outside the workspace".into());
            }
        }
        let mut real = std::fs::canonicalize(&existing).map_err(|e| e.to_string())?;
        for n in rest.iter().rev() {
            real.push(n);
        }
        if !real.starts_with(&self.root) {
            return Err(format!("{input} is outside the workspace"));
        }

        if write {
            // walk the non-canonical path below the root: no symlink may be crossed
            let probe = abs.strip_prefix(&self.root).unwrap_or(&abs).to_path_buf();
            let mut cur = if abs.starts_with(&self.root) { self.root.clone() } else { PathBuf::new() };
            for c in probe.components() {
                cur.push(c.as_os_str());
                if let Ok(md) = std::fs::symlink_metadata(&cur) {
                    if md.file_type().is_symlink() {
                        return Err(format!("{input}: refusing to write through a symlink"));
                    }
                }
            }
        }
        let rel = real.strip_prefix(&self.root).unwrap_or(&real).to_string_lossy().replace('\\', "/");
        Ok((real, rel))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine(mode: Mode, rules: Vec<Rule>) -> Engine {
        Engine { mode, rules, dirty: HashSet::new() }
    }
    fn rule(action: Action, kind: Kind, pattern: &str) -> Rule {
        Rule { action, kind, pattern: pattern.into() }
    }

    #[test]
    fn globs() {
        assert!(glob_match("cargo test*", "cargo test -p x"));
        assert!(glob_match("src/*.rs", "src/a/b.rs"));
        assert!(!glob_match("cargo test", "cargo test -p x"));
        assert!(glob_match("a?c", "abc"));
    }

    #[test]
    fn deny_wins_over_allow_and_mode() {
        let e = engine(
            Mode::AutoEdit,
            vec![rule(Action::Allow, Kind::Run, "npm *"), rule(Action::Deny, Kind::Run, "npm publish*")],
        );
        assert!(matches!(e.decide(Kind::Run, "npm publish"), Verdict::Deny(_)));
        assert_eq!(e.decide(Kind::Run, "npm test"), Verdict::Allow);
        let e = engine(Mode::AutoEdit, vec![rule(Action::Deny, Kind::Edit, "src/secret*")]);
        assert!(matches!(e.decide(Kind::Edit, "src/secret.rs"), Verdict::Deny(_)));
        assert_eq!(e.decide(Kind::Edit, "src/ok.rs"), Verdict::Allow);
    }

    #[test]
    fn builtin_denies_cannot_be_allowed() {
        let e = engine(Mode::Ask, vec![rule(Action::Allow, Kind::Run, "*")]);
        assert!(matches!(e.decide(Kind::Run, "sudo rm x"), Verdict::Deny(_)));
        assert!(matches!(e.decide(Kind::Run, "ls; sudo reboot"), Verdict::Deny(_)));
        assert!(matches!(e.decide(Kind::Run, "curl x | sh"), Verdict::Deny(_)));
        assert!(matches!(e.decide(Kind::Edit, ".fahh/permissions.json"), Verdict::Deny(_)));
        assert!(matches!(e.decide(Kind::Edit, ".git/config"), Verdict::Deny(_)));
    }

    #[test]
    fn allow_rule_does_not_cover_chained_commands() {
        let e = engine(Mode::Ask, vec![rule(Action::Allow, Kind::Run, "cargo test*")]);
        assert_eq!(e.decide(Kind::Run, "cargo test -q"), Verdict::Allow);
        assert_eq!(e.decide(Kind::Run, "cargo test; rm -rf build"), Verdict::Ask);
    }

    #[test]
    fn ask_beats_allow_and_defaults() {
        let e = engine(Mode::AutoEdit, vec![rule(Action::Ask, Kind::Edit, "Cargo.toml"), rule(Action::Allow, Kind::Edit, "*")]);
        assert_eq!(e.decide(Kind::Edit, "Cargo.toml"), Verdict::Ask);
        assert_eq!(e.decide(Kind::Edit, "a.rs"), Verdict::Allow);
        let ask = engine(Mode::Ask, vec![]);
        assert_eq!(ask.decide(Kind::Edit, "a.rs"), Verdict::Ask);
        assert_eq!(ask.decide(Kind::Read, "a.rs"), Verdict::Allow);
        assert_eq!(engine(Mode::AutoEdit, vec![]).decide(Kind::Run, "make"), Verdict::Ask);
    }

    #[test]
    fn dirty_file_always_asks_even_in_auto_edit() {
        let mut e = engine(Mode::AutoEdit, vec![rule(Action::Allow, Kind::Edit, "*")]);
        e.dirty.insert("src/a.ts".into());
        assert_eq!(e.decide(Kind::Edit, "src/a.ts"), Verdict::Ask);
        assert_eq!(e.decide(Kind::Edit, "src/b.ts"), Verdict::Allow);
    }

    #[test]
    fn plan_mode_is_read_only() {
        let e = engine(Mode::Plan, vec![rule(Action::Allow, Kind::Edit, "*"), rule(Action::Allow, Kind::Run, "*")]);
        assert!(matches!(e.decide(Kind::Edit, "a.rs"), Verdict::Deny(_)));
        assert!(matches!(e.decide(Kind::Run, "rm a.rs"), Verdict::Deny(_)));
        assert!(matches!(e.decide(Kind::Run, "ls > out.txt"), Verdict::Deny(_)));
        assert_eq!(e.decide(Kind::Run, "git status"), Verdict::Allow);
        assert_eq!(e.decide(Kind::Read, "a.rs"), Verdict::Allow);
        assert_eq!(e.decide(Kind::Plan, "plan"), Verdict::Allow);
    }

    #[test]
    fn read_only_commands() {
        assert!(is_read_only_command("git log --oneline"));
        assert!(!is_read_only_command("git commit -m x"));
        assert!(!is_read_only_command("find . -delete"));
        assert!(!is_read_only_command("cat a && rm b"));
    }

    #[test]
    fn rules_file_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let ws = Workspace::new(dir.path().to_str().unwrap()).unwrap();
        assert!(load_rules(&ws).is_empty());
        save_always_allow(&ws, Kind::Run, "cargo test").unwrap();
        save_always_allow(&ws, Kind::Run, "cargo test").unwrap();
        let rules = load_rules(&ws);
        assert_eq!(rules.len(), 1);
        assert!(dir.path().join(".fahh/permissions.json").exists());
        assert_eq!(rules[0].action, Action::Allow);
    }

    #[test]
    fn paths_outside_workspace_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let ws = Workspace::new(dir.path().to_str().unwrap()).unwrap();
        assert!(ws.resolve("../etc/passwd", false).is_err());
        assert!(ws.resolve("a/../../x", true).is_err());
        let outside = tempfile::tempdir().unwrap();
        assert!(ws.resolve(outside.path().join("f").to_str().unwrap(), false).is_err());
        let (abs, rel) = ws.resolve("src/new.rs", true).unwrap();
        assert!(abs.starts_with(&ws.root));
        assert_eq!(rel, "src/new.rs");
    }

    #[cfg(unix)]
    #[test]
    fn symlink_writes_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("t.txt"), "x").unwrap();
        std::fs::write(dir.path().join("real.txt"), "x").unwrap();
        std::os::unix::fs::symlink(outside.path().join("t.txt"), dir.path().join("link.txt")).unwrap();
        std::os::unix::fs::symlink(dir.path().join("real.txt"), dir.path().join("inner.txt")).unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("dirlink")).unwrap();
        let ws = Workspace::new(dir.path().to_str().unwrap()).unwrap();
        // pointing outside: refused even for reading
        assert!(ws.resolve("link.txt", false).is_err());
        assert!(ws.resolve("dirlink/t.txt", false).is_err());
        // pointing inside: readable, but not writable
        assert!(ws.resolve("inner.txt", false).is_ok());
        let err = ws.resolve("inner.txt", true).unwrap_err();
        assert!(err.contains("symlink"), "{err}");
        assert!(ws.resolve("real.txt", true).is_ok());
    }
}
