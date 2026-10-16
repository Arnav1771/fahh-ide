//! The agent's tools, plus checkpoints (undo) for the files they touch.
//! Tools never decide permissions: they take paths already resolved by
//! `perm::Workspace` and approved by `perm::Engine`.

use super::perm::{glob_match, Kind, Mode, Workspace};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Duration;

pub const MAX_OUTPUT: usize = 20_000;

#[derive(Debug, Clone, Serialize)]
pub struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub parameters: Value,
}

pub fn kind_of(tool: &str) -> Option<Kind> {
    Some(match tool {
        "list_dir" | "read_file" | "search" | "get_diagnostics" => Kind::Read,
        "edit_file" | "write_file" => Kind::Edit,
        "run_command" => Kind::Run,
        "write_plan" => Kind::Plan,
        "delegate" => Kind::Agent,
        _ => return None,
    })
}

fn obj(props: Value, required: &[&str]) -> Value {
    json!({"type": "object", "properties": props, "required": required})
}

/// Tool list for a mode. Read-only modes only see tools they can use:
/// Qa gets the read tools, Plan adds read-only commands and `write_plan`.
/// `delegate` is offered only where a subagent may be started.
pub fn specs_for(mode: Mode, allow_delegate: bool) -> Vec<ToolSpec> {
    let keep: &[&str] = match mode {
        Mode::Qa => &["list_dir", "read_file", "search", "get_diagnostics"],
        Mode::Plan => &["list_dir", "read_file", "search", "get_diagnostics", "run_command", "write_plan"],
        _ => &[],
    };
    let mut v: Vec<ToolSpec> = specs(mode == Mode::Plan).into_iter().filter(|t| keep.is_empty() || keep.contains(&t.name)).collect();
    if allow_delegate {
        v.push(ToolSpec {
            name: "delegate",
            description: "Hand a self-contained task to a subagent (see the list in the system prompt). It works with a fresh context and returns a short result.",
            parameters: obj(json!({"agent": {"type": "string"}, "task": {"type": "string"}}), &["agent", "task"]),
        });
    }
    v
}

pub fn specs(plan_mode: bool) -> Vec<ToolSpec> {
    let s = |name, description, parameters| ToolSpec { name, description, parameters };
    let mut v = vec![
        s("list_dir", "List a directory in the workspace (one level).", obj(json!({"path": {"type": "string", "description": "relative to the workspace root; '.' for the root"}}), &["path"])),
        s("read_file", "Read a text file with line numbers.", obj(json!({"path": {"type": "string"}, "offset": {"type": "integer", "description": "1-based first line"}, "limit": {"type": "integer"}}), &["path"])),
        s("search", "Regex search over workspace files. Returns file:line: text.", obj(json!({"pattern": {"type": "string"}, "path": {"type": "string"}, "glob": {"type": "string", "description": "e.g. *.rs"}}), &["pattern"])),
        s("get_diagnostics", "Current editor errors and warnings (LSP / compiler markers) per file.", obj(json!({}), &[])),
        s("run_command", "Run a shell command in the workspace root. Shows the user for approval unless a rule allows it.", obj(json!({"command": {"type": "string"}, "timeout_secs": {"type": "integer"}}), &["command"])),
        s("write_plan", "Write the implementation plan as Markdown (plan mode). The user approves it before anything is implemented.", obj(json!({"title": {"type": "string"}, "markdown": {"type": "string"}}), &["title", "markdown"])),
    ];
    if !plan_mode {
        v.push(s("edit_file", "Replace an exact string in a file. old_str must match exactly once (or set replace_all).", obj(json!({"path": {"type": "string"}, "old_str": {"type": "string"}, "new_str": {"type": "string"}, "replace_all": {"type": "boolean"}}), &["path", "old_str", "new_str"])));
        v.push(s("write_file", "Create a file or overwrite it completely.", obj(json!({"path": {"type": "string"}, "content": {"type": "string"}}), &["path", "content"])));
    }
    v
}

pub fn str_arg<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key).and_then(Value::as_str).ok_or_else(|| format!("missing string argument `{key}`"))
}

pub fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n...[truncated {} bytes]", &s[..end], s.len() - end)
}

// ─── read-only tools ──────────────────────────────────────────────────────────

pub fn list_dir(ws: &Workspace, path: &str) -> Result<String, String> {
    let (abs, _) = ws.resolve(path, false)?;
    let mut entries: Vec<String> = std::fs::read_dir(&abs)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|e| {
            let dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            format!("{}{}", e.file_name().to_string_lossy(), if dir { "/" } else { "" })
        })
        .collect();
    entries.sort();
    Ok(if entries.is_empty() { "(empty)".into() } else { entries.join("\n") })
}

pub fn read_file(ws: &Workspace, path: &str, offset: usize, limit: usize) -> Result<String, String> {
    let (abs, _) = ws.resolve(path, false)?;
    let bytes = std::fs::read(&abs).map_err(|e| e.to_string())?;
    let text = String::from_utf8(bytes).map_err(|_| "not a UTF-8 text file".to_string())?;
    let out: Vec<String> = text
        .lines()
        .enumerate()
        .skip(offset.saturating_sub(1))
        .take(limit)
        .map(|(i, l)| format!("{:>5}\t{}", i + 1, l))
        .collect();
    Ok(truncate(&out.join("\n"), 60_000))
}

const SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", "dist", ".fahh", ".next", "build"];

pub fn search(ws: &Workspace, pattern: &str, path: &str, glob: Option<&str>) -> Result<String, String> {
    let re = regex::Regex::new(pattern).or_else(|_| regex::Regex::new(&regex::escape(pattern))).map_err(|e| e.to_string())?;
    let (start, _) = ws.resolve(path, false)?;
    let mut hits = Vec::new();
    let walker = walkdir::WalkDir::new(&start).into_iter().filter_entry(|e| {
        !(e.file_type().is_dir() && e.file_name().to_str().map(|n| SKIP_DIRS.contains(&n)).unwrap_or(false))
    });
    'files: for entry in walker.filter_map(Result::ok).filter(|e| e.file_type().is_file()) {
        let rel = entry.path().strip_prefix(&ws.root).unwrap_or(entry.path()).to_string_lossy().replace('\\', "/");
        if let Some(g) = glob {
            let name = entry.file_name().to_string_lossy();
            if !(if g.contains('/') { glob_match(g, &rel) } else { glob_match(g, &name) }) {
                continue;
            }
        }
        if entry.metadata().map(|m| m.len() > 1_000_000).unwrap_or(true) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(entry.path()) else { continue };
        for (i, line) in text.lines().enumerate() {
            if re.is_match(line) {
                hits.push(format!("{rel}:{}: {}", i + 1, truncate(line.trim(), 200)));
                if hits.len() >= 100 {
                    hits.push("...[stopped at 100 matches]".into());
                    break 'files;
                }
            }
        }
    }
    Ok(if hits.is_empty() { "no matches".into() } else { hits.join("\n") })
}

// ─── edits ────────────────────────────────────────────────────────────────────

/// Exact-string replace. Errors name the problem so the model can retry.
pub fn apply_edit(content: &str, old: &str, new: &str, replace_all: bool) -> Result<String, String> {
    if old.is_empty() {
        return Err("old_str is empty".into());
    }
    let n = content.matches(old).count();
    match (n, replace_all) {
        (0, _) => Err("old_str not found: it must match the file exactly, including whitespace".into()),
        (1, _) | (_, true) => Ok(content.replace(old, new)),
        (n, false) => Err(format!("old_str matches {n} places; add more context or set replace_all")),
    }
}

/// What an edit tool call would do, computed without touching disk.
pub struct EditPlan {
    pub abs: PathBuf,
    pub rel: String,
    pub before: Option<String>,
    pub after: String,
}

pub fn plan_edit(ws: &Workspace, tool: &str, args: &Value) -> Result<EditPlan, String> {
    let (abs, rel) = ws.resolve(str_arg(args, "path")?, true)?;
    let before = if abs.exists() {
        Some(std::fs::read_to_string(&abs).map_err(|_| "not a UTF-8 text file".to_string())?)
    } else {
        None
    };
    let after = if tool == "write_file" {
        str_arg(args, "content")?.to_string()
    } else {
        let Some(b) = &before else { return Err("file does not exist; use write_file to create it".into()) };
        apply_edit(b, str_arg(args, "old_str")?, str_arg(args, "new_str")?, args.get("replace_all").and_then(Value::as_bool).unwrap_or(false))?
    };
    Ok(EditPlan { abs, rel, before, after })
}

pub fn commit_edit(plan: &EditPlan) -> Result<(), String> {
    if let Some(parent) = plan.abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&plan.abs, &plan.after).map_err(|e| e.to_string())
}

// ─── checkpoints ──────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
struct Snapshot {
    abs: PathBuf,
    rel: String,
    /// `None`: the file did not exist before the agent created it. The edit tools
    /// only touch UTF-8 text, so a string is enough.
    before: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct TurnCheckpoint {
    id: u32,
    files: Vec<Snapshot>,
}

#[derive(Default, Serialize, Deserialize, Clone)]
pub struct Checkpoints {
    turns: Vec<TurnCheckpoint>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FileDiff {
    pub path: String,
    pub before: Option<String>,
    pub after: Option<String>,
}

impl Checkpoints {
    /// Snapshot a file before the first time a turn touches it.
    pub fn touch(&mut self, turn: u32, abs: &PathBuf, rel: &str) {
        if !self.turns.iter().any(|t| t.id == turn) {
            self.turns.push(TurnCheckpoint { id: turn, files: vec![] });
        }
        let t = self.turns.iter_mut().find(|t| t.id == turn).unwrap();
        if t.files.iter().any(|s| s.abs == *abs) {
            return;
        }
        t.files.push(Snapshot { abs: abs.clone(), rel: rel.to_string(), before: std::fs::read_to_string(abs).ok() });
    }

    pub fn files(&self, turn: u32) -> Vec<String> {
        self.turns.iter().find(|t| t.id == turn).map(|t| t.files.iter().map(|s| s.rel.clone()).collect()).unwrap_or_default()
    }

    pub fn diff(&self, turn: u32) -> Vec<FileDiff> {
        let Some(t) = self.turns.iter().find(|t| t.id == turn) else { return vec![] };
        t.files
            .iter()
            .map(|s| FileDiff {
                path: s.rel.clone(),
                before: s.before.clone(),
                after: std::fs::read_to_string(&s.abs).ok(),
            })
            .collect()
    }

    fn restore(s: &Snapshot) -> Result<(), String> {
        match &s.before {
            Some(text) => std::fs::write(&s.abs, text).map_err(|e| e.to_string()),
            None => match std::fs::remove_file(&s.abs) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
                _ => Ok(()),
            },
        }
    }

    /// Put every file the turn touched back; returns the relative paths restored.
    pub fn revert_turn(&mut self, turn: u32) -> Result<Vec<String>, String> {
        let Some(i) = self.turns.iter().position(|t| t.id == turn) else { return Err("nothing to revert for that turn".into()) };
        let t = self.turns.remove(i);
        let mut done = Vec::new();
        for s in t.files.iter() {
            Self::restore(s)?;
            done.push(s.rel.clone());
        }
        Ok(done)
    }

    /// Revert turn `from` and every later turn (newest first): what "rewind to step N" needs.
    pub fn revert_from(&mut self, from: u32) -> Result<Vec<String>, String> {
        let mut ids: Vec<u32> = self.turns.iter().map(|t| t.id).filter(|id| *id >= from).collect();
        ids.sort_unstable_by(|a, b| b.cmp(a));
        let mut all = Vec::new();
        for id in ids {
            all.extend(self.revert_turn(id)?);
        }
        Ok(all)
    }

    /// Reject one file of a turn.
    pub fn revert_file(&mut self, turn: u32, rel: &str) -> Result<(), String> {
        let t = self.turns.iter_mut().find(|t| t.id == turn).ok_or("unknown turn")?;
        let i = t.files.iter().position(|s| s.rel == rel).ok_or("file was not changed in that turn")?;
        let s = t.files.remove(i);
        Self::restore(&s)
    }
}

/// A small unified-style diff: common head and tail trimmed, 3 lines of context.
pub fn simple_diff(path: &str, before: Option<&str>, after: Option<&str>) -> String {
    let (b, a): (Vec<&str>, Vec<&str>) = (before.unwrap_or("").lines().collect(), after.unwrap_or("").lines().collect());
    let head = b.iter().zip(&a).take_while(|(x, y)| x == y).count();
    let tail = b[head..].iter().rev().zip(a[head..].iter().rev()).take_while(|(x, y)| x == y).count();
    let ctx = 3;
    let start = head.saturating_sub(ctx);
    let mut out = format!("--- {path}{}\n", if before.is_none() { " (new file)" } else { "" });
    out += &format!("@@ line {} @@\n", start + 1);
    for l in &b[start..head] {
        out += &format!(" {l}\n");
    }
    for l in &b[head..b.len() - tail] {
        out += &format!("-{l}\n");
    }
    for l in &a[head..a.len() - tail] {
        out += &format!("+{l}\n");
    }
    for l in b[b.len() - tail..].iter().take(ctx) {
        out += &format!(" {l}\n");
    }
    out
}

// ─── run_command ──────────────────────────────────────────────────────────────

/// A shell command that never opens a console window on Windows: it is built by
/// `core::proc::cmd` (the one place that sets CREATE_NO_WINDOW).
pub fn shell(command: &str, cwd: &std::path::Path) -> tokio::process::Command {
    #[cfg(windows)]
    let mut c = {
        let mut c = tokio::process::Command::from(crate::core::proc::cmd("cmd"));
        c.arg("/C").arg(command);
        c
    };
    #[cfg(not(windows))]
    let mut c = {
        let mut c = tokio::process::Command::from(crate::core::proc::cmd("sh"));
        c.arg("-c").arg(command);
        c
    };
    c.current_dir(cwd)
        .stdin(std::process::Stdio::null()) // a sudo/password prompt must not hang the agent
        .env("GIT_TERMINAL_PROMPT", "0")
        .kill_on_drop(true);
    c
}

/// Resolves when the flag is set (polled: a flag has no waker).
async fn cancelled(flag: &std::sync::atomic::AtomicBool) {
    while !flag.load(std::sync::atomic::Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Run a shell command; stopping the agent (or its subagent) kills the process.
pub async fn run_command(ws: &Workspace, command: &str, timeout_secs: u64, cancel: &std::sync::atomic::AtomicBool) -> (bool, String) {
    let mut cmd = shell(command, &ws.root);
    let fut = cmd.output(); // dropped on cancel or timeout: kill_on_drop ends the process
    let outcome = tokio::select! {
        r = tokio::time::timeout(Duration::from_secs(timeout_secs.clamp(1, 600)), fut) => Some(r),
        _ = cancelled(cancel) => None,
    };
    match outcome {
        None => (false, "stopped by the user; the command was killed".to_string()),
        Some(Err(_)) => (false, format!("timed out after {timeout_secs}s and was killed")),
        Some(Ok(Err(e))) => (false, format!("could not start: {e}")),
        Some(Ok(Ok(out))) => {
            let code = out.status.code();
            let mut s = format!("exit code: {}\n", code.map(|c| c.to_string()).unwrap_or_else(|| "none".into()));
            let so = String::from_utf8_lossy(&out.stdout);
            let se = String::from_utf8_lossy(&out.stderr);
            if !so.trim().is_empty() {
                s += &format!("--- stdout ---\n{}\n", truncate(&so, MAX_OUTPUT));
            }
            if !se.trim().is_empty() {
                s += &format!("--- stderr ---\n{}\n", truncate(&se, MAX_OUTPUT));
            }
            (code == Some(0), s)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ws() -> (tempfile::TempDir, Workspace) {
        let d = tempfile::tempdir().unwrap();
        let w = Workspace::new(d.path().to_str().unwrap()).unwrap();
        (d, w)
    }

    #[test]
    fn edit_exact_replace_and_mismatch() {
        assert_eq!(apply_edit("a b c", "b", "X", false).unwrap(), "a X c");
        assert!(apply_edit("a b c", "zzz", "X", false).unwrap_err().contains("not found"));
        assert!(apply_edit("b b", "b", "X", false).unwrap_err().contains("2 places"));
        assert_eq!(apply_edit("b b", "b", "X", true).unwrap(), "X X");
        assert!(apply_edit("a", "", "X", false).is_err());
        // whitespace must match exactly
        assert!(apply_edit("fn  main()", "fn main()", "x", false).is_err());
    }

    #[test]
    fn plan_and_commit_edit() {
        let (d, w) = ws();
        std::fs::write(d.path().join("a.txt"), "hello world").unwrap();
        let p = plan_edit(&w, "edit_file", &json!({"path": "a.txt", "old_str": "world", "new_str": "fahh"})).unwrap();
        assert_eq!(p.after, "hello fahh");
        assert_eq!(std::fs::read_to_string(d.path().join("a.txt")).unwrap(), "hello world"); // not yet
        commit_edit(&p).unwrap();
        assert_eq!(std::fs::read_to_string(d.path().join("a.txt")).unwrap(), "hello fahh");
        assert!(plan_edit(&w, "edit_file", &json!({"path": "nope.txt", "old_str": "a", "new_str": "b"})).is_err());
        assert!(plan_edit(&w, "write_file", &json!({"path": "../x.txt", "content": "y"})).is_err());
    }

    #[test]
    fn checkpoint_revert_turn_and_file() {
        let (d, w) = ws();
        std::fs::write(d.path().join("a.txt"), "one").unwrap();
        let mut cp = Checkpoints::default();
        let (a, ra) = w.resolve("a.txt", true).unwrap();
        let (b, rb) = w.resolve("b.txt", true).unwrap();
        cp.touch(1, &a, &ra);
        std::fs::write(&a, "two").unwrap();
        cp.touch(1, &a, &ra); // second touch must not overwrite the snapshot
        std::fs::write(&a, "three").unwrap();
        cp.touch(1, &b, &rb);
        std::fs::write(&b, "new").unwrap();
        let diff = cp.diff(1);
        assert_eq!(diff[0], FileDiff { path: "a.txt".into(), before: Some("one".into()), after: Some("three".into()) });
        assert_eq!(diff[1].before, None);
        cp.revert_file(1, "b.txt").unwrap();
        assert!(!b.exists());
        std::fs::write(&b, "again").unwrap();
        cp.touch(2, &b, &rb);
        let restored = cp.revert_turn(1).unwrap();
        assert_eq!(restored, vec!["a.txt".to_string()]);
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "one");
        assert!(cp.revert_turn(1).is_err());
    }

    #[test]
    fn tool_sets_per_mode() {
        let names = |m, d| specs_for(m, d).into_iter().map(|t| t.name).collect::<Vec<_>>();
        assert_eq!(names(Mode::Qa, false), vec!["list_dir", "read_file", "search", "get_diagnostics"]);
        let plan = names(Mode::Plan, false);
        assert!(plan.contains(&"write_plan") && plan.contains(&"run_command") && !plan.contains(&"edit_file") && !plan.contains(&"write_file"));
        let ask = names(Mode::Ask, false);
        assert!(ask.contains(&"edit_file") && !ask.contains(&"delegate"));
        assert!(names(Mode::Ask, true).contains(&"delegate"));
        assert!(names(Mode::Qa, true).contains(&"delegate")); // children are read-only too
    }

    #[test]
    fn checkpoints_survive_serialization_and_rewind() {
        let (d, w) = ws();
        std::fs::write(d.path().join("a.txt"), "one").unwrap();
        let (a, ra) = w.resolve("a.txt", true).unwrap();
        let mut cp = Checkpoints::default();
        cp.touch(1, &a, &ra);
        std::fs::write(&a, "two").unwrap();
        cp.touch(2, &a, &ra);
        std::fs::write(&a, "three").unwrap();
        let mut back: Checkpoints = serde_json::from_str(&serde_json::to_string(&cp).unwrap()).unwrap();
        assert_eq!(back.diff(2)[0].before.as_deref(), Some("two"));
        assert_eq!(back.revert_from(1).unwrap(), vec!["a.txt".to_string(), "a.txt".to_string()]);
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "one");
    }

    #[test]
    fn diff_shows_only_the_change() {
        let d = simple_diff("a.rs", Some("a\nb\nc\nd\ne\nf\ng\nh\n"), Some("a\nb\nc\nd\nE\nf\ng\nh\n"));
        assert!(d.contains("-e\n+E\n") && d.contains(" d\n") && d.starts_with("--- a.rs"), "{d}");
        assert!(simple_diff("n.rs", None, Some("x\n")).contains("(new file)"));
    }

    #[test]
    fn read_list_search() {
        let (d, w) = ws();
        std::fs::create_dir(d.path().join("src")).unwrap();
        std::fs::write(d.path().join("src/m.rs"), "fn main() {}\nlet needle = 1;\n").unwrap();
        std::fs::create_dir(d.path().join("node_modules")).unwrap();
        std::fs::write(d.path().join("node_modules/x.js"), "needle").unwrap();
        assert!(list_dir(&w, ".").unwrap().contains("src/"));
        assert!(read_file(&w, "src/m.rs", 2, 10).unwrap().starts_with("    2\tlet needle"));
        let s = search(&w, "needle", ".", None).unwrap();
        assert_eq!(s, "src/m.rs:2: let needle = 1;");
        assert_eq!(search(&w, "needle", ".", Some("*.js")).unwrap(), "no matches");
        assert!(list_dir(&w, "..").is_err());
    }

    #[tokio::test]
    async fn run_command_captures_output() {
        let (_d, w) = ws();
        let no = std::sync::atomic::AtomicBool::new(false);
        let (ok, out) = run_command(&w, "echo hello", 10, &no).await;
        assert!(ok && out.contains("hello"), "{out}");
        let (ok, out) = run_command(&w, "exit 3", 10, &no).await;
        assert!(!ok && out.contains("exit code: 3"), "{out}");
        // a stop flag kills a long command promptly
        let stop = std::sync::atomic::AtomicBool::new(true);
        let t = std::time::Instant::now();
        let (ok, out) = run_command(&w, "sleep 20", 60, &stop).await;
        assert!(!ok && out.contains("stopped") && t.elapsed() < Duration::from_secs(5), "{out}");
    }
}
