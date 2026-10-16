//! Fahh Local: the in-editor coding agent.
//!
//! The loop (`runner.rs`) calls the model, runs the tool calls it asks for (each
//! one checked by the permission engine, some pausing for the user's approval),
//! feeds the results back, and repeats. Subagents, /loop, Smart-mode judging and
//! compaction live there too. Sessions persist in `store.rs`. The frontend gets
//! every step as an `agent://event`. Event and command shapes mirror
//! `src/lib/types.ts` (Agent* types).

pub mod agents;
pub mod cli;
pub mod context;
pub mod perm;
pub mod provider;
pub mod runner;
pub mod slash;
pub mod store;
pub mod tools;

use perm::{Kind, Mode, Workspace};
use provider::{Msg, Provider, ProviderConfig};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use store::{SessionFile, SessionInfo, TurnRec, Usage};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;
use tools::{Checkpoints, FileDiff};

pub use runner::{run_turn, Limits, TurnInput, MAX_STEPS};

// ─── contract with the frontend ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    TurnStarted { turn: u32 },
    TextDelta { turn: u32, text: String },
    ToolCall { turn: u32, id: String, name: String, args: serde_json::Value, kind: Kind },
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
    ToolResult { turn: u32, id: String, ok: bool, output: String },
    FileChanged { turn: u32, path: String },
    PlanWritten { turn: u32, id: String, path: String, markdown: String },
    /// Smart mode: what the judge model said about a command.
    Judge { turn: u32, command: String, safe: bool, reason: String },
    SubStarted { turn: u32, child: String, name: String, task: String, model: Option<String>, mode: Mode },
    /// An event from inside a subagent, tagged with which one.
    Sub { turn: u32, child: String, name: String, event: Box<AgentEvent> },
    SubDone { turn: u32, child: String, name: String, ok: bool, steps: u32, summary: String },
    LoopRound { turn: u32, round: u32, max: u32, approved: bool, notes: String },
    Notice { turn: u32, text: String },
    Compacted { turn: u32, before: u64, after: u64 },
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

/// What a start request runs.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RunSpec {
    #[default]
    Turn,
    /// Run, then review the diff, repeat until approved or the cap.
    Loop { max_rounds: Option<u32> },
    /// A side question that is not added to the conversation.
    Btw,
    /// Run one subagent directly (`prompt` is its task).
    Agent { name: String },
}

pub type Sink = Arc<dyn Fn(AgentEvent) + Send + Sync>;

// ─── session ──────────────────────────────────────────────────────────────────

struct Meta {
    title: String,
    created: u64,
    turns: Vec<TurnRec>,
    usage: Usage,
}

pub struct Session {
    pub id: String,
    ws: Mutex<Workspace>,
    history: Mutex<Vec<Msg>>,
    meta: Mutex<Meta>,
    checkpoints: Mutex<Checkpoints>,
    /// approval id -> (owning subagent, answer channel)
    pending: Mutex<HashMap<String, (Option<String>, oneshot::Sender<Decision>)>>,
    children: Mutex<HashMap<String, Arc<AtomicBool>>>,
    cancel: Arc<AtomicBool>,
    running: AtomicBool,
    next_turn: AtomicU32,
    next_call: AtomicU32,
    next_child: AtomicU32,
    diagnostics: Arc<Mutex<Vec<DiagFile>>>,
    /// Where this session is saved; `None` keeps it in memory only.
    dir: Option<PathBuf>,
}

#[derive(Debug, Serialize)]
pub struct Loaded {
    pub session: String,
    pub title: String,
    pub history: Vec<Msg>,
    pub turns: Vec<TurnRec>,
}

impl Session {
    pub fn new(id: String, ws: Workspace, diagnostics: Arc<Mutex<Vec<DiagFile>>>) -> Self {
        Self {
            id,
            ws: Mutex::new(ws),
            history: Default::default(),
            meta: Mutex::new(Meta { title: "Untitled".into(), created: store::now(), turns: vec![], usage: Usage::default() }),
            checkpoints: Default::default(),
            pending: Default::default(),
            children: Default::default(),
            cancel: Arc::new(AtomicBool::new(false)),
            running: AtomicBool::new(false),
            next_turn: AtomicU32::new(1),
            next_call: AtomicU32::new(1),
            next_child: AtomicU32::new(1),
            diagnostics,
            dir: None,
        }
    }

    pub fn persistent(mut self, dir: PathBuf) -> Self {
        self.dir = Some(dir);
        self
    }

    pub fn from_file(f: SessionFile, ws: Workspace, diagnostics: Arc<Mutex<Vec<DiagFile>>>, dir: Option<PathBuf>) -> Self {
        let mut s = Session::new(f.id, ws, diagnostics);
        s.dir = dir;
        *s.history.get_mut().unwrap() = f.history;
        *s.meta.get_mut().unwrap() = Meta { title: f.title, created: f.created, turns: f.turns, usage: f.usage };
        *s.checkpoints.get_mut().unwrap() = f.checkpoints;
        *s.next_turn.get_mut() = f.next_turn;
        s
    }

    pub fn ws(&self) -> Workspace {
        self.ws.lock().unwrap().clone()
    }

    pub fn snapshot(&self) -> SessionFile {
        let history = self.history.lock().unwrap().clone();
        let m = self.meta.lock().unwrap();
        SessionFile {
            id: self.id.clone(),
            title: m.title.clone(),
            workspace: self.ws().root.to_string_lossy().into_owned(),
            created: m.created,
            updated: store::now(),
            next_turn: self.next_turn.load(Ordering::Relaxed),
            turns: m.turns.clone(),
            history,
            checkpoints: self.checkpoints.lock().unwrap().clone(),
            usage: m.usage.clone(),
        }
    }

    /// Persist (best effort: a failed save must not stop the agent).
    pub fn save(&self) {
        if let Some(dir) = &self.dir {
            if let Err(e) = store::save(dir, &self.snapshot()) {
                tracing::warn!("could not save session {}: {e}", self.id);
            }
        }
    }

    pub fn loaded(&self) -> Loaded {
        let f = self.snapshot();
        Loaded { session: f.id, title: f.title, history: f.history, turns: f.turns }
    }

    /// Answer a pending approval. False if there is none with that id.
    pub fn resolve(&self, approval: &str, d: Decision) -> bool {
        self.pending.lock().unwrap().remove(approval).map(|(_, tx)| tx.send(d).is_ok()).unwrap_or(false)
    }

    /// Stop the turn: pending approvals are denied, running commands and children are cut off.
    pub fn stop(&self) {
        self.cancel.store(true, Ordering::Relaxed);
        for f in self.children.lock().unwrap().values() {
            f.store(true, Ordering::Relaxed);
        }
        self.pending.lock().unwrap().clear(); // dropped senders read as "deny"
    }

    /// Stop one subagent; the parent turn and the other children carry on.
    pub fn stop_child(&self, child: &str) {
        if let Some(f) = self.children.lock().unwrap().get(child) {
            f.store(true, Ordering::Relaxed);
        }
        self.pending.lock().unwrap().retain(|_, (owner, _)| owner.as_deref() != Some(child));
    }

    /// Undo the file changes of step `step` and every later step, and rewind the
    /// conversation to just before it. The bool says whether the conversation could
    /// be rewound (not if the step was folded into a /compact summary).
    pub fn revert_step(&self, step: u32) -> Result<(Vec<String>, bool), String> {
        let (start, idx) = {
            let m = self.meta.lock().unwrap();
            let idx = m.turns.iter().position(|t| t.id == step).ok_or_else(|| format!("there is no step {step}; /steps lists them"))?;
            (m.turns[idx].hist_start, idx)
        };
        let files = self.checkpoints.lock().unwrap().revert_from(step)?;
        self.meta.lock().unwrap().turns.truncate(idx);
        if let Some(s) = start {
            self.history.lock().unwrap().truncate(s);
        }
        self.save();
        Ok((files, start.is_some()))
    }

    /// A new session holding the conversation up to the end of `step` (all of it by default).
    /// Checkpoints are not copied: file changes belong to the original.
    pub fn fork(&self, new_id: String, step: Option<u32>) -> Result<SessionFile, String> {
        let mut f = self.snapshot();
        if let Some(n) = step {
            let idx = f.turns.iter().position(|t| t.id == n).ok_or_else(|| format!("there is no step {n}"))?;
            let end = f.turns.get(idx + 1).and_then(|t| t.hist_start).unwrap_or(f.history.len());
            f.history.truncate(end);
            f.turns.truncate(idx + 1);
        }
        f.id = new_id;
        f.title = format!("Fork of {}", f.title);
        f.checkpoints = Checkpoints::default();
        f.created = store::now();
        Ok(f)
    }

    /// Fold older turns into a summary. Returns (messages folded, tokens before, tokens after).
    pub async fn compact(&self, provider: &Provider) -> Result<(usize, u64, u64), String> {
        let mut history = self.history.lock().unwrap().clone();
        let mut turns = self.meta.lock().unwrap().turns.clone();
        let r = context::compact(&mut history, &mut turns, provider, &self.cancel).await?;
        *self.history.lock().unwrap() = history;
        self.meta.lock().unwrap().turns = turns;
        self.save();
        Ok(r)
    }
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

pub struct AgentState {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    diagnostics: Arc<Mutex<Vec<DiagFile>>>,
    data_dir: PathBuf,
}

impl Default for AgentState {
    fn default() -> Self {
        Self { sessions: Default::default(), diagnostics: Default::default(), data_dir: store::data_dir() }
    }
}

impl AgentState {
    fn dir_for(&self, root: &std::path::Path) -> PathBuf {
        store::sessions_dir(&self.data_dir, root)
    }
}

#[derive(Debug, Deserialize)]
pub struct StartParams {
    pub session: Option<String>,
    pub workspace: String,
    pub prompt: String,
    #[serde(default)]
    pub mode: Mode,
    pub provider: ProviderConfig,
    /// The fast model for Smart mode's judge; the main model if absent.
    #[serde(default)]
    pub judge: Option<ProviderConfig>,
    #[serde(default)]
    pub context: Context,
    #[serde(default)]
    pub run: RunSpec,
    #[serde(default)]
    pub limits: Option<Limits>,
    /// Extra folders (/add-dir) the agent may also work in.
    #[serde(default)]
    pub extra_dirs: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct StartResult {
    pub session: String,
    pub turn: u32,
}

fn session_of(state: &AgentState, id: &str) -> Result<Arc<Session>, String> {
    state.sessions.lock().unwrap().get(id).cloned().ok_or_else(|| "unknown session".to_string())
}

fn with_extra_dirs(mut ws: Workspace, dirs: &[String]) -> Workspace {
    ws.extra = dirs.iter().filter_map(|d| std::fs::canonicalize(d).ok()).filter(|p| p.is_dir() && *p != ws.root).collect();
    ws
}

#[tauri::command]
pub async fn agent_start(app: AppHandle, state: State<'_, AgentState>, params: StartParams) -> Result<StartResult, String> {
    let ws = with_extra_dirs(Workspace::new(&params.workspace)?, &params.extra_dirs);
    let session = {
        let mut all = state.sessions.lock().unwrap();
        match params.session.as_ref().and_then(|id| all.get(id)).filter(|s| s.ws().root == ws.root) {
            Some(s) => {
                *s.ws.lock().unwrap() = ws;
                s.clone()
            }
            None => {
                let id = store::new_id();
                let dir = state.dir_for(&ws.root);
                let s = Arc::new(Session::new(id.clone(), ws, state.diagnostics.clone()).persistent(dir));
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
    let provider = Arc::new(Provider::Http(params.provider));
    let mut input = TurnInput::new(&params.prompt, params.mode);
    input.context = params.context;
    input.run = params.run;
    input.judge = params.judge.map(|j| Arc::new(Provider::Http(j)));
    input.limits = params.limits.unwrap_or_default();
    input.user_agents_dir = agents::user_dir();
    let s2 = session.clone();
    tauri::async_runtime::spawn(async move {
        run_turn(&s2, provider, input, turn, &sink).await;
        s2.running.store(false, Ordering::SeqCst);
    });
    Ok(StartResult { session: session.id.clone(), turn })
}

#[tauri::command]
pub fn agent_approve(state: State<'_, AgentState>, session: String, approval: String, decision: Decision) -> Result<(), String> {
    if session_of(&state, &session)?.resolve(&approval, decision) { Ok(()) } else { Err("no such pending approval".into()) }
}

#[tauri::command]
pub fn agent_stop(state: State<'_, AgentState>, session: String) -> Result<(), String> {
    session_of(&state, &session)?.stop();
    Ok(())
}

/// Stop one subagent without ending the turn.
#[tauri::command]
pub fn agent_stop_child(state: State<'_, AgentState>, session: String, child: String) -> Result<(), String> {
    session_of(&state, &session)?.stop_child(&child);
    Ok(())
}

#[tauri::command]
pub async fn agent_list_models(provider: ProviderConfig) -> Result<Vec<String>, String> {
    provider::list_models(&provider).await
}

/// Undo everything one turn changed. Returns the workspace-relative paths restored.
#[tauri::command]
pub fn agent_revert_turn(state: State<'_, AgentState>, session: String, turn: u32) -> Result<Vec<String>, String> {
    let s = session_of(&state, &session)?;
    s.stop(); // revert works mid-turn: the turn is cancelled first
    let r = s.checkpoints.lock().unwrap().revert_turn(turn);
    s.save();
    r
}

#[tauri::command]
pub fn agent_revert_file(state: State<'_, AgentState>, session: String, turn: u32, path: String) -> Result<(), String> {
    let s = session_of(&state, &session)?;
    let r = s.checkpoints.lock().unwrap().revert_file(turn, &path);
    s.save();
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

// ─── sessions, steps, context ─────────────────────────────────────────────────

#[tauri::command]
pub fn agent_sessions(state: State<'_, AgentState>, workspace: String) -> Result<Vec<SessionInfo>, String> {
    Ok(store::list(&state.dir_for(&Workspace::new(&workspace)?.root)))
}

/// Open a saved session (the newest when `id` is absent) and make it the live one.
#[tauri::command]
pub fn agent_session_load(state: State<'_, AgentState>, workspace: String, id: Option<String>, extra_dirs: Option<Vec<String>>) -> Result<Loaded, String> {
    let ws = with_extra_dirs(Workspace::new(&workspace)?, &extra_dirs.unwrap_or_default());
    let dir = state.dir_for(&ws.root);
    let id = match id {
        Some(i) => i,
        None => store::latest(&dir).ok_or("no saved sessions for this workspace yet")?,
    };
    let s = Arc::new(Session::from_file(store::load(&dir, &id)?, ws, state.diagnostics.clone(), Some(dir)));
    let loaded = s.loaded();
    state.sessions.lock().unwrap().insert(s.id.clone(), s);
    Ok(loaded)
}

#[tauri::command]
pub fn agent_session_fork(state: State<'_, AgentState>, session: String, step: Option<u32>) -> Result<Loaded, String> {
    let s = session_of(&state, &session)?;
    let f = s.fork(store::new_id(), step)?;
    let dir = s.dir.clone();
    if let Some(d) = &dir {
        store::save(d, &f)?;
    }
    let forked = Arc::new(Session::from_file(f, s.ws(), state.diagnostics.clone(), dir));
    let loaded = forked.loaded();
    state.sessions.lock().unwrap().insert(forked.id.clone(), forked);
    Ok(loaded)
}

#[derive(Serialize)]
pub struct RevertResult {
    pub files: Vec<String>,
    pub rewound: bool,
    pub loaded: Loaded,
}

#[tauri::command]
pub fn agent_session_revert(state: State<'_, AgentState>, session: String, step: u32) -> Result<RevertResult, String> {
    let s = session_of(&state, &session)?;
    s.stop();
    let (files, rewound) = s.revert_step(step)?;
    Ok(RevertResult { files, rewound, loaded: s.loaded() })
}

#[tauri::command]
pub fn agent_session_rename(state: State<'_, AgentState>, session: String, title: String) -> Result<(), String> {
    let s = session_of(&state, &session)?;
    s.meta.lock().unwrap().title = title.trim().chars().take(80).collect();
    s.save();
    Ok(())
}

#[tauri::command]
pub fn agent_session_remove(state: State<'_, AgentState>, workspace: String, id: String) -> Result<(), String> {
    state.sessions.lock().unwrap().remove(&id);
    store::remove(&state.dir_for(&Workspace::new(&workspace)?.root), &id)
}

#[tauri::command]
pub fn agent_steps(state: State<'_, AgentState>, session: String) -> Result<Vec<TurnRec>, String> {
    Ok(session_of(&state, &session)?.meta.lock().unwrap().turns.clone())
}

#[derive(Serialize)]
pub struct CompactResult {
    pub folded: usize,
    pub before: u64,
    pub after: u64,
}

#[tauri::command]
pub async fn agent_compact(state: State<'_, AgentState>, session: String, provider: ProviderConfig) -> Result<CompactResult, String> {
    let s = session_of(&state, &session)?;
    let (folded, before, after) = s.compact(&Provider::Http(provider)).await?;
    Ok(CompactResult { folded, before, after })
}

#[tauri::command]
pub fn agent_context(state: State<'_, AgentState>, session: String, model: String) -> Result<context::ContextInfo, String> {
    let s = session_of(&state, &session)?;
    let h = s.history.lock().unwrap().clone();
    Ok(context::context_info(&h, 1_500, &model)) // ~1.5k tokens of system prompt and tool list
}

#[tauri::command]
pub fn agent_usage(state: State<'_, AgentState>, session: String) -> Result<Usage, String> {
    Ok(session_of(&state, &session)?.meta.lock().unwrap().usage.clone())
}

/// Markdown of the session; written to `path` (inside the workspace) when given.
#[tauri::command]
pub fn agent_export(state: State<'_, AgentState>, session: String, path: Option<String>) -> Result<String, String> {
    let s = session_of(&state, &session)?;
    let md = context::export_markdown(&s.snapshot());
    if let Some(p) = path {
        let (abs, rel) = s.ws().resolve(&p, true)?;
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&abs, &md).map_err(|e| e.to_string())?;
        return Ok(format!("wrote {rel}"));
    }
    Ok(md)
}

#[derive(Serialize)]
pub struct AgentInfo {
    pub name: String,
    pub description: String,
    pub model: Option<String>,
    pub mode: Mode,
    pub source: String,
    pub max_steps: u32,
}

#[derive(Serialize)]
pub struct AgentsReport {
    pub agents: Vec<AgentInfo>,
    /// Definition files that were skipped, and why.
    pub problems: Vec<String>,
}

#[tauri::command]
pub fn agent_agents(workspace: String) -> Result<AgentsReport, String> {
    Ok(agents_report(&Workspace::new(&workspace)?.root, agents::user_dir().as_deref()))
}

pub fn agents_report(root: &std::path::Path, user_dir: Option<&std::path::Path>) -> AgentsReport {
    let (defs, problems) = agents::load_all(root, user_dir);
    AgentsReport {
        agents: defs.into_iter().map(|d| AgentInfo { name: d.name, description: d.description, model: d.model, mode: d.mode, source: d.source, max_steps: d.max_steps }).collect(),
        problems,
    }
}
