//! Fahh Local: the in-editor coding agent (phase 1).
//!
//! The loop calls the model, runs the tool calls it asks for (each one checked
//! by the permission engine, some pausing for the user's approval), feeds the
//! results back, and repeats until the model answers without a tool call or
//! the step limit is hit. The frontend gets every step as an `agent://event`.
//! Event and command shapes mirror `src/lib/types.ts` (Agent* types).

pub mod cli;
pub mod perm;
pub mod provider;
pub mod tools;

use perm::{Engine, Kind, Mode, Verdict, Workspace};
use provider::{ModelTurn, Msg, Provider, ProviderConfig, ToolCall};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;
use tools::{Checkpoints, FileDiff};

pub const MAX_STEPS: u32 = 25;

// ─── contract with the frontend ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    TurnStarted { turn: u32 },
    TextDelta { turn: u32, text: String },
    ToolCall { turn: u32, id: String, name: String, args: Value, kind: Kind },
    ApprovalRequest {
        turn: u32,
        id: String,
        tool: String,
        kind: Kind,
        summary: String,
        command: Option<String>,
        path: Option<String>,
        old_text: Option<String>,
        new_text: Option<String>,
    },
    ToolResult {
        turn: u32,
        id: String,
        ok: bool,
        output: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        elapsed_ms: Option<u64>,
    },
    FileChanged { turn: u32, path: String },
    PlanWritten { turn: u32, id: String, path: String, markdown: String },
    Done { turn: u32, steps: u32, files: Vec<String> },
    Error { turn: u32, message: String },
}

#[derive(Debug, Clone, Deserialize)]
pub struct Decision {
    pub allow: bool,
    #[serde(default)]
    pub always: bool,
    /// The (possibly edited) command to run, for `run_command` approvals.
    #[serde(default)]
    pub command: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Context {
    pub active_file: Option<String>,
    pub selection: Option<String>,
    #[serde(default)]
    pub open_files: Vec<String>,
    /// Open files with unsaved changes: edits to these always ask.
    #[serde(default)]
    pub dirty_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DiagItem {
    pub line: u32,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DiagFile {
    pub path: String,
    #[serde(default)]
    pub items: Vec<DiagItem>,
}

pub type Sink = Arc<dyn Fn(AgentEvent) + Send + Sync>;

// ─── session ──────────────────────────────────────────────────────────────────

pub struct Session {
    pub id: String,
    pub ws: Workspace,
    history: tokio::sync::Mutex<Vec<Msg>>,
    checkpoints: Mutex<Checkpoints>,
    pending: Mutex<HashMap<String, oneshot::Sender<Decision>>>,
    cancel: AtomicBool,
    running: AtomicBool,
    next_turn: AtomicU32,
    next_call: AtomicU32,
    diagnostics: Arc<Mutex<Vec<DiagFile>>>,
}

impl Session {
    pub fn new(id: String, ws: Workspace, diagnostics: Arc<Mutex<Vec<DiagFile>>>) -> Self {
        Self {
            id,
            ws,
            history: Default::default(),
            checkpoints: Default::default(),
            pending: Default::default(),
            cancel: AtomicBool::new(false),
            running: AtomicBool::new(false),
            next_turn: AtomicU32::new(1),
            next_call: AtomicU32::new(1),
            diagnostics,
        }
    }

    /// Answer a pending approval. False if there is none with that id.
    pub fn resolve(&self, approval: &str, d: Decision) -> bool {
        self.pending.lock().unwrap().remove(approval).map(|tx| tx.send(d).is_ok()).unwrap_or(false)
    }

    /// Stop the turn: pending approvals are denied, the loop ends at its next check.
    pub fn stop(&self) {
        self.cancel.store(true, Ordering::Relaxed);
        self.pending.lock().unwrap().clear(); // dropped senders read as "deny"
    }
}

pub struct TurnInput {
    pub prompt: String,
    pub mode: Mode,
    pub context: Context,
}

fn read_capped(p: &std::path::Path) -> Option<String> {
    std::fs::read_to_string(p).ok().map(|s| tools::truncate(&s, 8_000))
}

pub fn system_prompt(ws: &Workspace, mode: Mode) -> String {
    let mut s = format!(
        "You are Fahh Local, a coding agent inside the Fahh Editor desktop IDE. Work in the workspace at {}.\n\
         Use the tools to look before you change anything: read files, search, check get_diagnostics. \
         Make small, exact edits with edit_file (old_str must match once). Run builds/tests with run_command. \
         Every edit and command may be shown to the user for approval; if one is denied, adjust and say so. \
         Never touch paths outside the workspace. Finish with a short summary of what you did.\n",
        ws.root.display()
    );
    if mode == Mode::Plan {
        s += "\nPLAN MODE: you are read-only. Research with the read tools and read-only commands, then call write_plan \
              with a concrete step-by-step plan. Do not try to edit files; the user must approve the plan first.\n";
    }
    for rel in ["AGENTS.md", ".fahh/rules.md"] {
        if let Some(t) = read_capped(&ws.root.join(rel)) {
            s += &format!("\n--- project rules ({rel}) ---\n{t}\n");
        }
    }
    s
}

fn context_block(s: &Session, input: &TurnInput) -> String {
    let c = &input.context;
    let mut out = String::new();
    if let Some(f) = &c.active_file {
        out += &format!("Active file: {f}\n");
    }
    if let Some(sel) = c.selection.as_deref().filter(|x| !x.trim().is_empty()) {
        out += &format!("Selected text:\n```\n{}\n```\n", tools::truncate(sel, 4_000));
    }
    if !c.open_files.is_empty() {
        out += &format!("Open files: {}\n", c.open_files.join(", "));
    }
    let diag = diagnostics_text(&s.diagnostics.lock().unwrap(), 20);
    if !diag.is_empty() {
        out += &format!("Current diagnostics:\n{diag}\n");
    }
    if out.is_empty() { input.prompt.clone() } else { format!("{out}\n{}", input.prompt) }
}

fn diagnostics_text(files: &[DiagFile], max: usize) -> String {
    let mut lines = Vec::new();
    for f in files {
        for d in &f.items {
            lines.push(format!("{}:{}: {}: {}", f.path, d.line, d.severity, d.message));
        }
    }
    let more = lines.len().saturating_sub(max);
    lines.truncate(max);
    if more > 0 {
        lines.push(format!("...and {more} more"));
    }
    lines.join("\n")
}

// ─── the loop ─────────────────────────────────────────────────────────────────

pub async fn run_turn(s: &Arc<Session>, provider: &Provider, input: TurnInput, turn: u32, sink: &Sink) {
    s.cancel.store(false, Ordering::Relaxed);
    sink(AgentEvent::TurnStarted { turn });

    let mut engine = Engine { mode: input.mode, rules: perm::load_rules(&s.ws), ..Default::default() };
    for d in &input.context.dirty_files {
        if let Ok((_, rel)) = s.ws.resolve(d, false) {
            engine.dirty.insert(rel);
        }
    }
    let system = system_prompt(&s.ws, input.mode);
    let specs = tools::specs(input.mode == Mode::Plan);
    s.history.lock().await.push(Msg::User { text: context_block(s, &input) });

    for step in 1..=MAX_STEPS {
        if s.cancel.load(Ordering::Relaxed) {
            return sink(AgentEvent::Error { turn, message: "stopped".into() });
        }
        let history = s.history.lock().await.clone();
        let sink2 = sink.clone();
        let mut on_text = move |t: &str| sink2(AgentEvent::TextDelta { turn, text: t.to_string() });
        let reply: ModelTurn = match provider.complete(&system, &history, &specs, &s.cancel, &mut on_text).await {
            Ok(r) => r,
            Err(message) => return sink(AgentEvent::Error { turn, message }),
        };
        s.history.lock().await.push(Msg::Assistant { text: reply.text.clone(), calls: reply.calls.clone() });
        if reply.calls.is_empty() {
            let files = s.checkpoints.lock().unwrap().files(turn);
            return sink(AgentEvent::Done { turn, steps: step, files });
        }
        for call in reply.calls {
            let start = std::time::Instant::now();
            let (ok, output) = if s.cancel.load(Ordering::Relaxed) {
                (false, "cancelled by the user".to_string())
            } else {
                run_call(s, &engine, turn, &call, sink).await
            };
            let elapsed_ms = Some(start.elapsed().as_millis() as u64);
            sink(AgentEvent::ToolResult {
                turn,
                id: call.id.clone(),
                ok,
                output: tools::truncate(&output, 4_000),
                elapsed_ms,
            });
            s.history.lock().await.push(Msg::ToolResult { id: call.id, name: call.name, content: tools::truncate(&output, 30_000) });
        }
    }
    sink(AgentEvent::Error { turn, message: format!("stopped after {MAX_STEPS} steps without a final answer") });
}

/// Ask the user. `None` means denied (explicitly, or because the turn was stopped).
async fn ask(s: &Session, sink: &Sink, make: impl FnOnce(String) -> AgentEvent) -> Option<Decision> {
    let id = format!("appr-{}", s.next_call.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = oneshot::channel();
    s.pending.lock().unwrap().insert(id.clone(), tx);
    sink(make(id));
    rx.await.ok().filter(|d| d.allow)
}

async fn run_call(s: &Arc<Session>, engine: &Engine, turn: u32, call: &ToolCall, sink: &Sink) -> (bool, String) {
    let Some(kind) = tools::kind_of(&call.name) else { return (false, format!("unknown tool `{}`", call.name)) };
    sink(AgentEvent::ToolCall { turn, id: call.id.clone(), name: call.name.clone(), args: call.args.clone(), kind });
    let args = &call.args;
    let res: Result<String, String> = async {
        match call.name.as_str() {
            "list_dir" => tools::list_dir(&s.ws, tools::str_arg(args, "path")?),
            "read_file" => {
                let n = |k: &str, d: u64| args.get(k).and_then(Value::as_u64).unwrap_or(d) as usize;
                tools::read_file(&s.ws, tools::str_arg(args, "path")?, n("offset", 1), n("limit", 2000))
            }
            "search" => tools::search(
                &s.ws,
                tools::str_arg(args, "pattern")?,
                args.get("path").and_then(Value::as_str).unwrap_or("."),
                args.get("glob").and_then(Value::as_str),
            ),
            "get_diagnostics" => {
                let t = diagnostics_text(&s.diagnostics.lock().unwrap(), 100);
                Ok(if t.is_empty() { "no diagnostics reported (only files open in the editor are checked)".into() } else { t })
            }
            "write_plan" => write_plan(s, turn, args, sink),
            "run_command" => {
                let (ok, o) = run_cmd(s, engine, turn, args, sink).await;
                if ok { Ok(o) } else { Err(o) }
            }
            "edit_file" | "write_file" => edit(s, engine, turn, &call.name, args, sink).await,
            _ => Err("unknown tool".into()),
        }
    }
    .await;
    match res {
        Ok(o) => (true, o),
        Err(e) => (false, e),
    }
}

fn write_plan(s: &Session, turn: u32, args: &Value, sink: &Sink) -> Result<String, String> {
    let title = tools::str_arg(args, "title")?;
    let md = tools::str_arg(args, "markdown")?;
    let slug: String = title.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    let id = format!("{}-{turn}", slug.trim_matches('-').chars().take(40).collect::<String>());
    let rel = format!(".fahh/plans/{id}.md");
    let (abs, rel) = s.ws.resolve(&rel, true)?;
    std::fs::create_dir_all(abs.parent().unwrap()).map_err(|e| e.to_string())?;
    let body = format!("# {title}\n\n{md}\n");
    std::fs::write(&abs, &body).map_err(|e| e.to_string())?;
    sink(AgentEvent::PlanWritten { turn, id, path: rel.clone(), markdown: body });
    Ok(format!("plan saved to {rel}; wait for the user to approve it before implementing"))
}

async fn run_cmd(s: &Arc<Session>, engine: &Engine, turn: u32, args: &Value, sink: &Sink) -> (bool, String) {
    let mut command = match tools::str_arg(args, "command") {
        Ok(c) => c.to_string(),
        Err(e) => return (false, e),
    };
    let timeout = args.get("timeout_secs").and_then(Value::as_u64).unwrap_or(120);
    match engine.decide(Kind::Run, &command) {
        Verdict::Deny(why) => return (false, format!("denied: {why}")),
        Verdict::Allow => {}
        Verdict::Ask => {
            let cmd = command.clone();
            let Some(d) = ask(s, sink, |id| AgentEvent::ApprovalRequest {
                turn,
                id,
                tool: "run_command".into(),
                kind: Kind::Run,
                summary: format!("Run a command in {}", s.ws.root.display()),
                command: Some(cmd),
                path: None,
                old_text: None,
                new_text: None,
            })
            .await
            else {
                return (false, "denied: the user declined to run this command".into());
            };
            if let Some(edited) = d.command.filter(|c| !c.trim().is_empty() && *c != command) {
                // the edited command is judged again: deny rules still win
                if let Verdict::Deny(why) = engine.decide(Kind::Run, &edited) {
                    return (false, format!("denied: {why}"));
                }
                command = edited;
            }
            if d.always {
                let _ = perm::save_always_allow(&s.ws, Kind::Run, &command);
            }
        }
    }
    tools::run_command(&s.ws, &command, timeout).await
}

async fn edit(s: &Arc<Session>, engine: &Engine, turn: u32, tool: &str, args: &Value, sink: &Sink) -> Result<String, String> {
    let plan = tools::plan_edit(&s.ws, tool, args)?;
    match engine.decide(Kind::Edit, &plan.rel) {
        Verdict::Deny(why) => return Err(format!("denied: {why}")),
        Verdict::Allow => {}
        Verdict::Ask => {
            let (old_text, new_text) = if tool == "edit_file" {
                (args["old_str"].as_str().map(str::to_string), args["new_str"].as_str().map(str::to_string))
            } else {
                (plan.before.as_deref().map(|b| tools::truncate(b, 20_000)), Some(tools::truncate(&plan.after, 20_000)))
            };
            let rel = plan.rel.clone();
            let tool_name = tool.to_string();
            let d = ask(s, sink, |id| AgentEvent::ApprovalRequest {
                turn,
                id,
                tool: tool_name,
                kind: Kind::Edit,
                summary: format!("{} {rel}", if plan.before.is_some() { "Edit" } else { "Create" }),
                command: None,
                path: Some(rel),
                old_text,
                new_text,
            })
            .await
            .ok_or("denied: the user declined this edit")?;
            if d.always {
                let _ = perm::save_always_allow(&s.ws, Kind::Edit, &plan.rel);
            }
        }
    }
    // the approval is for this exact file; recompute against the file as it is now
    let plan = tools::plan_edit(&s.ws, tool, args)?;
    s.checkpoints.lock().unwrap().touch(turn, &plan.abs, &plan.rel);
    tools::commit_edit(&plan)?;
    sink(AgentEvent::FileChanged { turn, path: plan.rel.clone() });
    Ok(format!("{} {}", if plan.before.is_some() { "edited" } else { "created" }, plan.rel))
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[derive(Default)]
pub struct AgentState {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    diagnostics: Arc<Mutex<Vec<DiagFile>>>,
    counter: AtomicU32,
}

#[derive(Debug, Deserialize)]
pub struct StartParams {
    pub session: Option<String>,
    pub workspace: String,
    pub prompt: String,
    #[serde(default)]
    pub mode: Mode,
    pub provider: ProviderConfig,
    #[serde(default)]
    pub context: Context,
}

#[derive(Debug, Serialize)]
pub struct StartResult {
    pub session: String,
    pub turn: u32,
}

fn session_of(state: &AgentState, id: &str) -> Result<Arc<Session>, String> {
    state.sessions.lock().unwrap().get(id).cloned().ok_or_else(|| "unknown session".to_string())
}

#[tauri::command]
pub async fn agent_start(app: AppHandle, state: State<'_, AgentState>, params: StartParams) -> Result<StartResult, String> {
    let ws = Workspace::new(&params.workspace)?;
    let session = {
        let mut all = state.sessions.lock().unwrap();
        match params.session.as_ref().and_then(|id| all.get(id)).filter(|s| s.ws.root == ws.root) {
            Some(s) => s.clone(),
            None => {
                let id = format!("s{}", state.counter.fetch_add(1, Ordering::Relaxed) + 1);
                let s = Arc::new(Session::new(id.clone(), ws, state.diagnostics.clone()));
                all.insert(id, s.clone());
                s
            }
        }
    };
    if session.running.swap(true, Ordering::SeqCst) {
        return Err("the agent is already working on a turn".into());
    }
    let turn = session.next_turn.fetch_add(1, Ordering::Relaxed);
    let sid = session.id.clone();
    let sink: Sink = Arc::new(move |ev| {
        let _ = app.emit("agent://event", json!({"session": sid, "event": ev}));
    });
    let provider = Provider::Http(params.provider);
    let input = TurnInput { prompt: params.prompt, mode: params.mode, context: params.context };
    let s2 = session.clone();
    tauri::async_runtime::spawn(async move {
        run_turn(&s2, &provider, input, turn, &sink).await;
        s2.running.store(false, Ordering::SeqCst);
    });
    Ok(StartResult { session: session.id.clone(), turn })
}

#[tauri::command]
pub fn agent_approve(state: State<'_, AgentState>, session: String, approval: String, decision: Decision) -> Result<(), String> {
    session_of(&state, &session)?;
    if session_of(&state, &session)?.resolve(&approval, decision) { Ok(()) } else { Err("no such pending approval".into()) }
}

#[tauri::command]
pub async fn agent_list_models(provider: ProviderConfig) -> Result<Vec<String>, String> {
    provider::list_models(&provider).await
}

#[tauri::command]
pub fn agent_stop(state: State<'_, AgentState>, session: String) -> Result<(), String> {
    session_of(&state, &session)?.stop();
    Ok(())
}

/// Undo everything one turn changed. Returns the workspace-relative paths restored.
#[tauri::command]
pub fn agent_revert_turn(state: State<'_, AgentState>, session: String, turn: u32) -> Result<Vec<String>, String> {
    let s = session_of(&state, &session)?;
    s.stop(); // revert works mid-turn: the turn is cancelled first
    let r = s.checkpoints.lock().unwrap().revert_turn(turn);
    r
}

#[tauri::command]
pub fn agent_revert_file(state: State<'_, AgentState>, session: String, turn: u32, path: String) -> Result<(), String> {
    let r = session_of(&state, &session)?.checkpoints.lock().unwrap().revert_file(turn, &path);
    r
}

#[tauri::command]
pub fn agent_turn_diff(state: State<'_, AgentState>, session: String, turn: u32) -> Result<Vec<FileDiff>, String> {
    Ok(session_of(&state, &session)?.checkpoints.lock().unwrap().diff(turn))
}

/// The editor's current problems, pushed by the frontend; read by `get_diagnostics`.
#[tauri::command]
pub fn agent_set_diagnostics(state: State<'_, AgentState>, files: Vec<DiagFile>) {
    *state.diagnostics.lock().unwrap() = files;
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Harness {
        dir: tempfile::TempDir,
        s: Arc<Session>,
        events: Arc<Mutex<Vec<AgentEvent>>>,
        sink: Sink,
    }

    /// `answer` decides every approval the loop asks for.
    fn harness(answer: impl Fn(&AgentEvent) -> Decision + Send + Sync + 'static) -> Harness {
        let dir = tempfile::tempdir().unwrap();
        let ws = Workspace::new(dir.path().to_str().unwrap()).unwrap();
        let s = Arc::new(Session::new("t".into(), ws, Default::default()));
        let events = Arc::new(Mutex::new(Vec::new()));
        let (s2, e2) = (s.clone(), events.clone());
        let sink: Sink = Arc::new(move |ev| {
            if let AgentEvent::ApprovalRequest { id, .. } = &ev {
                s2.resolve(id, answer(&ev));
            }
            e2.lock().unwrap().push(ev);
        });
        Harness { dir, s, events, sink }
    }

    fn call(id: &str, name: &str, args: Value) -> ToolCall {
        ToolCall { id: id.into(), name: name.into(), args }
    }
    fn turn(text: &str, calls: Vec<ToolCall>) -> ModelTurn {
        ModelTurn { text: text.into(), calls }
    }
    fn input(mode: Mode, prompt: &str) -> TurnInput {
        TurnInput { prompt: prompt.into(), mode, context: Context::default() }
    }
    fn yes() -> Decision {
        Decision { allow: true, always: false, command: None }
    }

    #[tokio::test]
    async fn loop_runs_tool_call_then_final_answer() {
        let h = harness(|_| yes());
        std::fs::write(h.dir.path().join("a.txt"), "hello").unwrap();
        let p = Provider::mock(vec![
            turn("Let me look.", vec![call("1", "read_file", json!({"path": "a.txt"}))]),
            turn("It says hello.", vec![]),
        ]);
        run_turn(&h.s, &p, input(Mode::Ask, "what is in a.txt?"), 1, &h.sink).await;
        let ev = h.events.lock().unwrap();
        assert!(ev.iter().any(|e| matches!(e, AgentEvent::TextDelta { text, .. } if text == "Let me look.")));
        assert!(ev.iter().any(|e| matches!(e, AgentEvent::ToolResult { ok: true, output, .. } if output.contains("hello"))));
        assert!(matches!(ev.last().unwrap(), AgentEvent::Done { steps: 2, .. }));
        // history: user, assistant+call, tool result, assistant
        assert_eq!(h.s.history.try_lock().unwrap().len(), 4);
    }

    #[tokio::test]
    async fn ask_mode_edit_waits_for_approval_and_can_be_reverted() {
        let h = harness(|_| yes());
        let f = h.dir.path().join("a.txt");
        std::fs::write(&f, "one").unwrap();
        let p = Provider::mock(vec![
            turn("", vec![call("1", "edit_file", json!({"path": "a.txt", "old_str": "one", "new_str": "two"}))]),
            turn("done", vec![]),
        ]);
        run_turn(&h.s, &p, input(Mode::Ask, "change it"), 1, &h.sink).await;
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "two");
        {
            let ev = h.events.lock().unwrap();
            assert!(ev.iter().any(|e| matches!(e, AgentEvent::ApprovalRequest { path: Some(p), .. } if p == "a.txt")));
            assert!(ev.iter().any(|e| matches!(e, AgentEvent::FileChanged { path, .. } if path == "a.txt")));
            assert!(matches!(ev.last().unwrap(), AgentEvent::Done { files, .. } if files == &vec!["a.txt".to_string()]));
        }
        assert_eq!(h.s.checkpoints.lock().unwrap().revert_turn(1).unwrap(), vec!["a.txt".to_string()]);
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "one");
    }

    #[tokio::test]
    async fn declined_edit_changes_nothing_and_tells_the_model() {
        let h = harness(|_| Decision { allow: false, always: false, command: None });
        let f = h.dir.path().join("a.txt");
        std::fs::write(&f, "one").unwrap();
        let p = Provider::mock(vec![
            turn("", vec![call("1", "write_file", json!({"path": "a.txt", "content": "x"}))]),
            turn("ok, not touching it", vec![]),
        ]);
        run_turn(&h.s, &p, input(Mode::Ask, "x"), 1, &h.sink).await;
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "one");
        let ev = h.events.lock().unwrap();
        assert!(ev.iter().any(|e| matches!(e, AgentEvent::ToolResult { ok: false, output, .. } if output.starts_with("denied"))));
    }

    #[tokio::test]
    async fn auto_edit_does_not_ask_but_dirty_files_still_do() {
        let h = harness(|_| yes());
        std::fs::write(h.dir.path().join("a.txt"), "one").unwrap();
        std::fs::write(h.dir.path().join("b.txt"), "one").unwrap();
        let p = Provider::mock(vec![
            turn("", vec![call("1", "edit_file", json!({"path": "a.txt", "old_str": "one", "new_str": "A"}))]),
            turn("", vec![call("2", "edit_file", json!({"path": "b.txt", "old_str": "one", "new_str": "B"}))]),
            turn("done", vec![]),
        ]);
        let mut inp = input(Mode::AutoEdit, "x");
        inp.context.dirty_files = vec![h.dir.path().join("b.txt").to_string_lossy().into_owned()];
        run_turn(&h.s, &p, inp, 1, &h.sink).await;
        let asked: Vec<_> = h.events.lock().unwrap().iter().filter_map(|e| match e {
            AgentEvent::ApprovalRequest { path, .. } => path.clone(),
            _ => None,
        }).collect();
        assert_eq!(asked, vec!["b.txt".to_string()]);
    }

    #[tokio::test]
    async fn plan_mode_blocks_edits_and_writes_a_plan() {
        let h = harness(|_| yes());
        let f = h.dir.path().join("a.txt");
        std::fs::write(&f, "one").unwrap();
        let p = Provider::mock(vec![
            turn("", vec![
                call("1", "edit_file", json!({"path": "a.txt", "old_str": "one", "new_str": "two"})),
                call("2", "run_command", json!({"command": "rm a.txt"})),
                call("3", "write_plan", json!({"title": "Change a", "markdown": "1. edit a.txt"})),
            ]),
            turn("plan ready", vec![]),
        ]);
        run_turn(&h.s, &p, input(Mode::Plan, "plan it"), 1, &h.sink).await;
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "one");
        assert!(f.exists());
        let ev = h.events.lock().unwrap();
        assert!(!ev.iter().any(|e| matches!(e, AgentEvent::ApprovalRequest { .. })));
        assert!(ev.iter().any(|e| matches!(e, AgentEvent::PlanWritten { path, .. } if path.starts_with(".fahh/plans/change-a"))));
        let plan = std::fs::read_dir(h.dir.path().join(".fahh/plans")).unwrap().next().unwrap().unwrap().path();
        assert!(std::fs::read_to_string(plan).unwrap().contains("edit a.txt"));
    }

    #[tokio::test]
    async fn command_approval_can_be_edited_and_is_rechecked_against_deny() {
        // edited to something harmless: runs the edited text
        let h = harness(|_| Decision { allow: true, always: false, command: Some("echo edited".into()) });
        let p = Provider::mock(vec![turn("", vec![call("1", "run_command", json!({"command": "echo original"}))]), turn("ok", vec![])]);
        run_turn(&h.s, &p, input(Mode::Ask, "x"), 1, &h.sink).await;
        assert!(h.events.lock().unwrap().iter().any(|e| matches!(e, AgentEvent::ToolResult { ok: true, output, .. } if output.contains("edited") && !output.contains("original"))));
        // edited into a denied command: refused even though the user said yes
        let h = harness(|_| Decision { allow: true, always: false, command: Some("sudo reboot".into()) });
        let p = Provider::mock(vec![turn("", vec![call("1", "run_command", json!({"command": "echo hi"}))]), turn("ok", vec![])]);
        run_turn(&h.s, &p, input(Mode::Ask, "x"), 1, &h.sink).await;
        assert!(h.events.lock().unwrap().iter().any(|e| matches!(e, AgentEvent::ToolResult { ok: false, output, .. } if output.starts_with("denied"))));
    }

    #[tokio::test]
    async fn always_allow_is_saved_and_skips_the_next_prompt() {
        let h = harness(|_| Decision { allow: true, always: true, command: None });
        let p = Provider::mock(vec![turn("", vec![call("1", "run_command", json!({"command": "echo hi"}))]), turn("ok", vec![])]);
        run_turn(&h.s, &p, input(Mode::Ask, "x"), 1, &h.sink).await;
        assert!(std::fs::read_to_string(h.dir.path().join(".fahh/permissions.json")).unwrap().contains("echo hi"));
        let before = h.events.lock().unwrap().iter().filter(|e| matches!(e, AgentEvent::ApprovalRequest { .. })).count();
        let p = Provider::mock(vec![turn("", vec![call("2", "run_command", json!({"command": "echo hi"}))]), turn("ok", vec![])]);
        run_turn(&h.s, &p, input(Mode::Ask, "again"), 2, &h.sink).await;
        let after = h.events.lock().unwrap().iter().filter(|e| matches!(e, AgentEvent::ApprovalRequest { .. })).count();
        assert_eq!((before, after), (1, 1));
    }

    #[tokio::test]
    async fn outside_workspace_and_unknown_tools_fail_cleanly() {
        let h = harness(|_| yes());
        let p = Provider::mock(vec![
            turn("", vec![call("1", "read_file", json!({"path": "../../etc/passwd"})), call("2", "format_disk", json!({}))]),
            turn("sorry", vec![]),
        ]);
        run_turn(&h.s, &p, input(Mode::AutoEdit, "x"), 1, &h.sink).await;
        let ev = h.events.lock().unwrap();
        assert_eq!(ev.iter().filter(|e| matches!(e, AgentEvent::ToolResult { ok: false, .. })).count(), 2);
        assert!(matches!(ev.last().unwrap(), AgentEvent::Done { .. }));
    }

    #[tokio::test]
    async fn step_limit_and_provider_errors_end_the_turn() {
        let h = harness(|_| yes());
        let turns = (0..MAX_STEPS + 2).map(|i| turn("", vec![call(&i.to_string(), "list_dir", json!({"path": "."}))])).collect();
        run_turn(&h.s, &Provider::mock(turns), input(Mode::Ask, "x"), 1, &h.sink).await;
        assert!(matches!(h.events.lock().unwrap().last().unwrap(), AgentEvent::Error { message, .. } if message.contains("steps")));
        let h = harness(|_| yes());
        run_turn(&h.s, &Provider::mock(vec![]), input(Mode::Ask, "x"), 1, &h.sink).await;
        assert!(matches!(h.events.lock().unwrap().last().unwrap(), AgentEvent::Error { .. }));
    }

    #[test]
    fn diagnostics_are_formatted_and_capped() {
        let f = DiagFile { path: "a.ts".into(), items: (1..=3).map(|l| DiagItem { line: l, severity: "error".into(), message: "bad".into() }).collect() };
        let t = diagnostics_text(&[f], 2);
        assert_eq!(t, "a.ts:1: error: bad\na.ts:2: error: bad\n...and 1 more");
    }

    #[test]
    fn project_rules_are_added_to_the_system_prompt() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("AGENTS.md"), "use tabs").unwrap();
        let ws = Workspace::new(dir.path().to_str().unwrap()).unwrap();
        assert!(system_prompt(&ws, Mode::Ask).contains("use tabs"));
        assert!(system_prompt(&ws, Mode::Plan).contains("PLAN MODE"));
    }
}
