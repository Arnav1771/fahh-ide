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

/// Devin naming in brackets: Ask = Normal, AutoEdit = Accept Edits, Qa = the one-shot /ask.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    #[default]
    Ask,
    AutoEdit,
    /// Edits auto-approved; a fast judge model classifies each command.
    Smart,
    Plan,
    /// Every prompt auto-approved. Deny rules still apply.
    Bypass,
    /// Read-only Q&A (no commands, no plan files).
    Qa,
}

impl Mode {
    /// How much the mode may do; a child agent never gets a higher rank than its parent.
    pub fn rank(self) -> u8 {
        match self {
            Mode::Qa => 0,
            Mode::Plan => 1,
            Mode::Ask => 2,
            Mode::AutoEdit => 3,
            Mode::Smart => 4,
            Mode::Bypass => 5,
        }
    }

    /// The lower-ranked of the two.
    pub fn clamp_to(self, parent: Mode) -> Mode {
        if self.rank() <= parent.rank() { self } else { parent }
    }

    pub fn read_only(self) -> bool {
        matches!(self, Mode::Plan | Mode::Qa)
    }

    /// Accepts Devin names and aliases.
    pub fn parse(name: &str) -> Option<Mode> {
        Some(match name.trim().to_lowercase().as_str() {
            "ask" | "normal" | "code" | "default" => Mode::Ask,
            "auto-edit" | "accept-edits" | "acceptedits" | "edits" => Mode::AutoEdit,
            "smart" => Mode::Smart,
            "plan" => Mode::Plan,
            "bypass" | "yolo" | "dangerous" => Mode::Bypass,
            "qa" | "ask-only" | "readonly" | "read-only" => Mode::Qa,
            _ => return None,
        })
    }

    pub fn label(self) -> &'static str {
        match self {
            Mode::Ask => "normal",
            Mode::AutoEdit => "accept-edits",
            Mode::Smart => "smart",
            Mode::Plan => "plan",
            Mode::Bypass => "bypass",
            Mode::Qa => "ask (read-only)",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Read,
    Edit,
    Run,
    Plan,
    /// Starting a subagent: always allowed; the child is clamped to the parent's mode.
    Agent,
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
    /// Smart mode: let the judge model classify the command; unsafe still asks.
    Judge,
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
        // 3. read-only modes
        if self.mode == Mode::Plan {
            match kind {
                Kind::Edit => return Verdict::Deny("plan mode is read-only; write a plan instead".into()),
                Kind::Run if !is_read_only_command(target) => {
                    return Verdict::Deny("plan mode only allows read-only commands".into())
                }
                _ => {}
            }
        }
        if self.mode == Mode::Qa && matches!(kind, Kind::Edit | Kind::Run | Kind::Plan) {
            return Verdict::Deny("ask mode is read-only Q&A: it can read and search, nothing else".into());
        }
        // bypass: every prompt is auto-approved, but the denies above already applied
        if self.mode == Mode::Bypass {
            return Verdict::Allow;
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
            Kind::Read | Kind::Plan | Kind::Agent => Verdict::Allow,
            Kind::Edit if matches!(self.mode, Mode::AutoEdit | Mode::Smart) => Verdict::Allow,
            Kind::Run if self.mode == Mode::Plan => Verdict::Allow, // read-only, checked above
            Kind::Run if self.mode == Mode::Smart => Verdict::Judge,
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
    /// Extra folders added with /add-dir; paths inside them are shown absolute.
    pub extra: Vec<PathBuf>,
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
        Ok(Self { root, extra: vec![] })
    }

    /// The root (primary or extra) a canonical path lives under.
    fn base_of(&self, p: &Path) -> Option<&PathBuf> {
        std::iter::once(&self.root).chain(self.extra.iter()).find(|r| p.starts_with(r))
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
        let Some(base) = self.base_of(&real).cloned() else {
            return Err(format!("{input} is outside the workspace"));
        };

        if write {
            // walk the non-canonical path below the root: no symlink may be crossed
            let lexical_base = std::iter::once(&self.root).chain(self.extra.iter()).find(|r| abs.starts_with(r)).cloned();
            let probe = lexical_base.as_ref().map(|b| abs.strip_prefix(b).unwrap_or(&abs).to_path_buf()).unwrap_or_else(|| abs.clone());
            let mut cur = lexical_base.unwrap_or_default();
            for c in probe.components() {
                cur.push(c.as_os_str());
                if let Ok(md) = std::fs::symlink_metadata(&cur) {
                    if md.file_type().is_symlink() {
                        return Err(format!("{input}: refusing to write through a symlink"));
                    }
                }
            }
        }
        let rel = if base == self.root {
            real.strip_prefix(&base).unwrap_or(&real).to_string_lossy().replace('\\', "/")
        } else {
            real.to_string_lossy().replace('\\', "/") // extra roots: absolute
        };
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
    fn mode_names_aliases_and_ranks() {
        assert_eq!(Mode::parse("normal"), Some(Mode::Ask));
        assert_eq!(Mode::parse("code"), Some(Mode::Ask));
        assert_eq!(Mode::parse("Accept-Edits"), Some(Mode::AutoEdit));
        assert_eq!(Mode::parse("yolo"), Some(Mode::Bypass));
        assert_eq!(Mode::parse("dangerous"), Some(Mode::Bypass));
        assert_eq!(Mode::parse("nope"), None);
        // children never exceed the parent
        assert_eq!(Mode::AutoEdit.clamp_to(Mode::Plan), Mode::Plan);
        assert_eq!(Mode::Bypass.clamp_to(Mode::Ask), Mode::Ask);
        assert_eq!(Mode::Plan.clamp_to(Mode::Bypass), Mode::Plan);
        assert_eq!(Mode::Ask.clamp_to(Mode::Qa), Mode::Qa);
    }

    #[test]
    fn qa_mode_is_read_only_and_smart_judges_commands() {
        let q = engine(Mode::Qa, vec![rule(Action::Allow, Kind::Edit, "*"), rule(Action::Allow, Kind::Run, "*")]);
        assert!(matches!(q.decide(Kind::Edit, "a.rs"), Verdict::Deny(_)));
        assert!(matches!(q.decide(Kind::Run, "ls"), Verdict::Deny(_)));
        assert!(matches!(q.decide(Kind::Plan, "plan"), Verdict::Deny(_)));
        assert_eq!(q.decide(Kind::Read, "a.rs"), Verdict::Allow);
        let s = engine(Mode::Smart, vec![rule(Action::Allow, Kind::Run, "make*")]);
        assert_eq!(s.decide(Kind::Edit, "a.rs"), Verdict::Allow);
        assert_eq!(s.decide(Kind::Run, "npm test"), Verdict::Judge);
        assert_eq!(s.decide(Kind::Run, "make build"), Verdict::Allow);
        assert!(matches!(s.decide(Kind::Run, "sudo x"), Verdict::Deny(_)));
    }

    #[test]
    fn bypass_auto_approves_but_deny_rules_still_win() {
        let b = engine(Mode::Bypass, vec![rule(Action::Deny, Kind::Run, "npm publish*"), rule(Action::Ask, Kind::Run, "git push*"), rule(Action::Deny, Kind::Edit, "secrets/*")]);
        assert_eq!(b.decide(Kind::Run, "cargo build"), Verdict::Allow);
        assert_eq!(b.decide(Kind::Run, "git push origin x"), Verdict::Allow); // ask rule is a prompt: auto-approved
        assert_eq!(b.decide(Kind::Edit, "a.rs"), Verdict::Allow);
        assert!(matches!(b.decide(Kind::Run, "npm publish"), Verdict::Deny(_)));
        assert!(matches!(b.decide(Kind::Run, "sudo reboot"), Verdict::Deny(_)));
        assert!(matches!(b.decide(Kind::Edit, "secrets/key"), Verdict::Deny(_)));
        assert!(matches!(b.decide(Kind::Edit, ".git/config"), Verdict::Deny(_)));
    }

    #[test]
    fn extra_roots_are_allowed_and_shown_absolute() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        std::fs::write(b.path().join("x.txt"), "x").unwrap();
        let mut ws = Workspace::new(a.path().to_str().unwrap()).unwrap();
        assert!(ws.resolve(b.path().join("x.txt").to_str().unwrap(), false).is_err());
        ws.extra.push(std::fs::canonicalize(b.path()).unwrap());
        let (abs, rel) = ws.resolve(b.path().join("x.txt").to_str().unwrap(), true).unwrap();
        assert!(abs.ends_with("x.txt") && rel.ends_with("/x.txt"), "{rel}");
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
