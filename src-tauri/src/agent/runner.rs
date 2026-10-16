//! The agent loop: model call -> tool calls -> results, with the permission
//! engine in front of every call, subagents (`delegate`), Smart-mode judging,
//! /loop review rounds, /btw side questions and auto-compaction.

use super::agents::{self, AgentDef};
use super::context;
use super::perm::{self, Engine, Kind, Mode, Verdict, Workspace};
use super::provider::{ModelTurn, Msg, Provider, ToolCall};
use super::store::{self, TurnRec};
use super::tools::{self, ToolSpec};
use super::{AgentEvent, Context, Decision, RunSpec, Session, Sink};
use futures_util::future::{join_all, BoxFuture};
use serde::Deserialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{oneshot, Semaphore};

pub const MAX_STEPS: u32 = 25;
pub const DEFAULT_LOOP_ROUNDS: u32 = 3;

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Limits {
    /// Subagents running at once.
    pub max_parallel: usize,
    /// Model calls in one turn, parent and children together.
    pub turn_steps: u32,
    /// Estimated tokens produced in one turn, parent and children together.
    pub turn_tokens: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self { max_parallel: 3, turn_steps: 80, turn_tokens: 400_000 }
    }
}

struct Budget {
    steps: AtomicU32,
    tokens: AtomicU64,
    limits: Limits,
}

impl Budget {
    fn step(&self) -> Result<(), String> {
        if self.steps.fetch_add(1, Ordering::Relaxed) + 1 > self.limits.turn_steps {
            return Err(format!("this turn used its budget of {} model calls", self.limits.turn_steps));
        }
        Ok(())
    }
    fn tokens(&self, n: u64) -> Result<(), String> {
        if self.tokens.fetch_add(n, Ordering::Relaxed) + n > self.limits.turn_tokens {
            return Err(format!("this turn used its budget of about {} output tokens", self.limits.turn_tokens));
        }
        Ok(())
    }
}

pub struct TurnInput {
    pub prompt: String,
    pub mode: Mode,
    pub context: Context,
    pub run: RunSpec,
    /// The Smart-mode judge; falls back to the main provider.
    pub judge: Option<Arc<Provider>>,
    pub limits: Limits,
    pub user_agents_dir: Option<PathBuf>,
}

impl TurnInput {
    pub fn new(prompt: &str, mode: Mode) -> Self {
        Self { prompt: prompt.into(), mode, context: Context::default(), run: RunSpec::Turn, judge: None, limits: Limits::default(), user_agents_dir: None }
    }
}

struct RunCtx {
    s: Arc<Session>,
    ws: Workspace,
    provider: Arc<Provider>,
    judge: Option<Arc<Provider>>,
    turn: u32,
    budget: Arc<Budget>,
    sem: Semaphore,
    defs: Vec<AgentDef>,
}

struct AgentCtx {
    child: Option<String>,
    depth: u8,
    engine: Engine,
    cancel: Arc<AtomicBool>,
}

enum Hist {
    Session(Arc<Session>),
    Local(Vec<Msg>),
}

impl Hist {
    fn push(&mut self, m: Msg) {
        match self {
            Hist::Session(s) => s.history.lock().unwrap().push(m),
            Hist::Local(v) => v.push(m),
        }
    }
    fn snapshot(&self) -> Vec<Msg> {
        match self {
            Hist::Session(s) => s.history.lock().unwrap().clone(),
            Hist::Local(v) => v.clone(),
        }
    }
}

// ─── prompts ──────────────────────────────────────────────────────────────────

fn read_capped(p: &std::path::Path) -> Option<String> {
    std::fs::read_to_string(p).ok().map(|s| tools::truncate(&s, 8_000))
}

pub fn system_prompt(ws: &Workspace, mode: Mode, defs: &[AgentDef]) -> String {
    let mut s = format!(
        "You are Fahh Local, a coding agent inside the Fahh Editor desktop IDE. Work in the workspace at {}.\n\
         Use the tools to look before you change anything: read files, search, check get_diagnostics. \
         Make small, exact edits with edit_file (old_str must match once). Run builds/tests with run_command. \
         Every edit and command may be shown to the user for approval; if one is denied, adjust and say so. \
         Never touch paths outside the workspace. Finish with a short summary of what you did.\n",
        ws.root.display()
    );
    match mode {
        Mode::Plan => s += "\nPLAN MODE: you are read-only. Research with the read tools and read-only commands, then call write_plan with a concrete step-by-step plan. Do not try to edit files; the user must approve the plan first.\n",
        Mode::Qa => s += "\nASK MODE: answer the user's question from the code. You can only read and search; you cannot change anything or run commands.\n",
        _ => {}
    }
    if !defs.is_empty() && mode != Mode::Qa {
        s += "\nSubagents (call the delegate tool with agent and task; each works with a fresh context and returns a short result, so give it everything it needs; you may delegate several independent tasks in one reply to run them in parallel):\n";
        for d in defs {
            s += &format!("- {}: {}\n", d.name, d.description);
        }
    }
    for rel in ["AGENTS.md", ".fahh/rules.md"] {
        if let Some(t) = read_capped(&ws.root.join(rel)) {
            s += &format!("\n--- project rules ({rel}) ---\n{t}\n");
        }
    }
    s
}

fn child_system(def: &AgentDef, ws: &Workspace, mode: Mode) -> String {
    let mut s = format!(
        "You are the `{}` subagent of Fahh Local, working in {}. You have a fresh context: the task you are given is all you know. \
         Do the task with your tools and finish with a concise result for your parent agent (it only sees that final message).\n",
        def.name,
        ws.root.display()
    );
    if mode.read_only() {
        s += "You are read-only; you cannot change files.\n";
    }
    s += &format!("\n{}\n", def.body);
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

pub fn diagnostics_text(files: &[super::DiagFile], max: usize) -> String {
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

// ─── Smart mode judge ─────────────────────────────────────────────────────────

const JUDGE_SYSTEM: &str = "You are a security judge for a coding agent's shell commands. Reply with exactly one word first, SAFE or UNSAFE, then a short reason. \
SAFE: read-only inspection, builds, tests, linters, formatters, git status/diff/log, installing dependencies from the project's own lockfile. \
UNSAFE: deleting or overwriting files outside build output, downloads piped to a shell, credential access, git push or history rewrite, system changes, anything you are unsure about.";

/// SAFE only when the first word says so; anything else, including garbage, is unsafe.
pub fn parse_verdict(text: &str) -> (bool, String) {
    let t = text.trim();
    let first = t.split_whitespace().next().unwrap_or("").trim_matches(|c: char| !c.is_alphanumeric()).to_uppercase();
    let reason = t.split_once(char::is_whitespace).map(|(_, r)| r.trim().to_string()).unwrap_or_default();
    (first == "SAFE", if reason.is_empty() { t.to_string() } else { reason })
}

async fn judge_command(ctx: &RunCtx, command: &str) -> (bool, String) {
    let p = ctx.judge.as_ref().unwrap_or(&ctx.provider);
    let user = Msg::User { text: format!("Workspace: {}\nCommand: {command}", ctx.ws.root.display()) };
    let mut sink = |_: &str| {};
    match p.complete(JUDGE_SYSTEM, &[user], &[], &AtomicBool::new(false), &mut sink).await {
        Ok(t) => parse_verdict(&t.text),
        Err(e) => (false, format!("judge unavailable ({e})")), // fail closed: ask the user
    }
}

// ─── events ───────────────────────────────────────────────────────────────────

fn child_sink(sink: &Sink, turn: u32, child: String, name: String) -> Sink {
    let sink = sink.clone();
    Arc::new(move |ev| sink(AgentEvent::Sub { turn, child: child.clone(), name: name.clone(), event: Box::new(ev) }))
}

/// Ask the user. `None` means denied (explicitly, or because the turn or the child was stopped).
async fn ask(s: &Session, owner: Option<String>, sink: &Sink, make: impl FnOnce(String) -> AgentEvent) -> Option<Decision> {
    let id = format!("appr-{}", s.next_call.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = oneshot::channel();
    s.pending.lock().unwrap().insert(id.clone(), (owner, tx));
    sink(make(id));
    rx.await.ok().filter(|d| d.allow)
}

fn cancelled(ctx: &RunCtx, ac: &AgentCtx) -> bool {
    ac.cancel.load(Ordering::Relaxed) || ctx.s.cancel.load(Ordering::Relaxed)
}

// ─── the loop ─────────────────────────────────────────────────────────────────

/// Returns the final assistant text and the number of model calls.
fn drive(ctx: Arc<RunCtx>, ac: Arc<AgentCtx>, system: String, specs: Vec<ToolSpec>, mut hist: Hist, max_steps: u32, sink: Sink) -> BoxFuture<'static, Result<(String, u32), String>> {
    Box::pin(async move {
        let turn = ctx.turn;
        let main = matches!(hist, Hist::Session(_));
        for step in 1..=max_steps {
            if cancelled(&ctx, &ac) {
                return Err("stopped".into());
            }
            ctx.budget.step()?;
            let history = hist.snapshot();
            {
                let mut m = ctx.s.meta.lock().unwrap();
                m.usage.model_calls += 1;
                m.usage.tokens_in += context::history_tokens(&history) + context::est_tokens(&system);
            }
            let sink2 = sink.clone();
            let mut on_text = move |t: &str| sink2(AgentEvent::TextDelta { turn, text: t.to_string() });
            let provider = ctx.provider.clone();
            let reply: ModelTurn = provider.complete(&system, &history, &specs, &ac.cancel, &mut on_text).await?;
            let out = context::msg_tokens(&Msg::Assistant { text: reply.text.clone(), calls: reply.calls.clone() });
            ctx.s.meta.lock().unwrap().usage.tokens_out += out;
            ctx.budget.tokens(out)?;
            hist.push(Msg::Assistant { text: reply.text.clone(), calls: reply.calls.clone() });
            if main {
                ctx.s.save();
            }
            if reply.calls.is_empty() {
                return Ok((reply.text, step));
            }

            // plain tools one after another, then every delegate at once
            let mut results: Vec<Option<(bool, String)>> = vec![None; reply.calls.len()];
            for (i, call) in reply.calls.iter().enumerate().filter(|(_, c)| c.name != "delegate") {
                results[i] = Some(if cancelled(&ctx, &ac) { (false, "cancelled by the user".into()) } else { exec_and_report(&ctx, &ac, call, &sink).await });
            }
            let idx: Vec<usize> = (0..reply.calls.len()).filter(|i| reply.calls[*i].name == "delegate").collect();
            let outs = join_all(idx.iter().map(|i| exec_and_report(&ctx, &ac, &reply.calls[*i], &sink))).await;
            for (i, o) in idx.into_iter().zip(outs) {
                results[i] = Some(o);
            }
            for (call, r) in reply.calls.iter().zip(results) {
                let (_, output) = r.unwrap_or((false, String::new()));
                hist.push(Msg::ToolResult { id: call.id.clone(), name: call.name.clone(), content: tools::truncate(&output, 30_000) });
            }
        }
        Err(format!("stopped after {max_steps} steps without a final answer"))
    })
}

async fn exec_and_report(ctx: &Arc<RunCtx>, ac: &Arc<AgentCtx>, call: &ToolCall, sink: &Sink) -> (bool, String) {
    let (ok, output) = run_call(ctx, ac, call, sink).await;
    ctx.s.meta.lock().unwrap().usage.tool_calls += 1;
    sink(AgentEvent::ToolResult { turn: ctx.turn, id: call.id.clone(), ok, output: tools::truncate(&output, 4_000) });
    (ok, output)
}

async fn run_call(ctx: &Arc<RunCtx>, ac: &Arc<AgentCtx>, call: &ToolCall, sink: &Sink) -> (bool, String) {
    let Some(kind) = tools::kind_of(&call.name) else { return (false, format!("unknown tool `{}`", call.name)) };
    let turn = ctx.turn;
    sink(AgentEvent::ToolCall { turn, id: call.id.clone(), name: call.name.clone(), args: call.args.clone(), kind });
    // a tool outside the mode's set is refused even if the model asks for it anyway
    if let Verdict::Deny(why) = ac.engine.decide(kind, "") {
        if kind != Kind::Edit && kind != Kind::Run {
            return (false, format!("denied: {why}"));
        }
    }
    let args = &call.args;
    let ws = &ctx.ws;
    let res: Result<String, String> = async {
        match call.name.as_str() {
            "list_dir" => tools::list_dir(ws, tools::str_arg(args, "path")?),
            "read_file" => {
                let n = |k: &str, d: u64| args.get(k).and_then(Value::as_u64).unwrap_or(d) as usize;
                tools::read_file(ws, tools::str_arg(args, "path")?, n("offset", 1), n("limit", 2000))
            }
            "search" => tools::search(
                ws,
                tools::str_arg(args, "pattern")?,
                args.get("path").and_then(Value::as_str).unwrap_or("."),
                args.get("glob").and_then(Value::as_str),
            ),
            "get_diagnostics" => {
                let t = diagnostics_text(&ctx.s.diagnostics.lock().unwrap(), 100);
                Ok(if t.is_empty() { "no diagnostics reported (only files open in the editor are checked)".into() } else { t })
            }
            "write_plan" => write_plan(ctx, args, sink),
            "delegate" => delegate(ctx, ac, args, sink).await,
            "run_command" => {
                let (ok, o) = run_cmd(ctx, ac, args, sink).await;
                if ok { Ok(o) } else { Err(o) }
            }
            "edit_file" | "write_file" => edit(ctx, ac, &call.name, args, sink).await,
            _ => Err("unknown tool".into()),
        }
    }
    .await;
    match res {
        Ok(o) => (true, o),
        Err(e) => (false, e),
    }
}

fn write_plan(ctx: &RunCtx, args: &Value, sink: &Sink) -> Result<String, String> {
    let title = tools::str_arg(args, "title")?;
    let md = tools::str_arg(args, "markdown")?;
    let slug: String = title.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    let id = format!("{}-{}", slug.trim_matches('-').chars().take(40).collect::<String>(), ctx.turn);
    let rel = format!(".fahh/plans/{id}.md");
    let (abs, rel) = ctx.ws.resolve(&rel, true)?;
    std::fs::create_dir_all(abs.parent().unwrap()).map_err(|e| e.to_string())?;
    let body = format!("# {title}\n\n{md}\n");
    std::fs::write(&abs, &body).map_err(|e| e.to_string())?;
    sink(AgentEvent::PlanWritten { turn: ctx.turn, id, path: rel.clone(), markdown: body });
    Ok(format!("plan saved to {rel}; wait for the user to approve it before implementing"))
}

async fn run_cmd(ctx: &Arc<RunCtx>, ac: &Arc<AgentCtx>, args: &Value, sink: &Sink) -> (bool, String) {
    let turn = ctx.turn;
    let mut command = match tools::str_arg(args, "command") {
        Ok(c) => c.to_string(),
        Err(e) => return (false, e),
    };
    let timeout = args.get("timeout_secs").and_then(Value::as_u64).unwrap_or(120);
    let mut ask_why: Option<String> = None;
    let needs_ask = match ac.engine.decide(Kind::Run, &command) {
        Verdict::Deny(why) => return (false, format!("denied: {why}")),
        Verdict::Allow => false,
        Verdict::Ask => true,
        Verdict::Judge => {
            let (safe, reason) = judge_command(ctx, &command).await;
            tracing::info!(target: "fahh_agent", safe, "smart-mode judge verdict for a command");
            sink(AgentEvent::Judge { turn, command: command.clone(), safe, reason: reason.clone() });
            if !safe {
                ask_why = Some(reason);
            }
            !safe
        }
    };
    if needs_ask {
        let cmd = command.clone();
        let summary = match &ask_why {
            Some(r) => format!("The judge flagged this command as unsafe: {r}"),
            None => format!("Run a command in {}", ctx.ws.root.display()),
        };
        let Some(d) = ask(&ctx.s, ac.child.clone(), sink, |id| AgentEvent::ApprovalRequest {
            turn,
            id,
            tool: "run_command".into(),
            kind: Kind::Run,
            summary,
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
            if let Verdict::Deny(why) = ac.engine.decide(Kind::Run, &edited) {
                return (false, format!("denied: {why}"));
            }
            command = edited;
        }
        if d.always {
            let _ = perm::save_always_allow(&ctx.ws, Kind::Run, &command);
        }
    }
    tools::run_command(&ctx.ws, &command, timeout, &ac.cancel).await
}

async fn edit(ctx: &Arc<RunCtx>, ac: &Arc<AgentCtx>, tool: &str, args: &Value, sink: &Sink) -> Result<String, String> {
    let (s, ws, turn) = (&ctx.s, &ctx.ws, ctx.turn);
    let plan = tools::plan_edit(ws, tool, args)?;
    match ac.engine.decide(Kind::Edit, &plan.rel) {
        Verdict::Deny(why) => return Err(format!("denied: {why}")),
        Verdict::Allow => {}
        Verdict::Ask | Verdict::Judge => {
            let (old_text, new_text) = if tool == "edit_file" {
                (args["old_str"].as_str().map(str::to_string), args["new_str"].as_str().map(str::to_string))
            } else {
                (plan.before.as_deref().map(|b| tools::truncate(b, 20_000)), Some(tools::truncate(&plan.after, 20_000)))
            };
            let rel = plan.rel.clone();
            let tool_name = tool.to_string();
            let d = ask(s, ac.child.clone(), sink, |id| AgentEvent::ApprovalRequest {
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
                let _ = perm::save_always_allow(ws, Kind::Edit, &plan.rel);
            }
        }
    }
    // the approval is for this exact file; recompute against the file as it is now
    let plan = tools::plan_edit(ws, tool, args)?;
    s.checkpoints.lock().unwrap().touch(turn, &plan.abs, &plan.rel);
    tools::commit_edit(&plan)?;
    if ac.child.is_none() {
        s.save(); // the checkpoint is on disk before the next step
    }
    sink(AgentEvent::FileChanged { turn, path: plan.rel.clone() });
    Ok(format!("{} {}", if plan.before.is_some() { "edited" } else { "created" }, plan.rel))
}

// ─── subagents ────────────────────────────────────────────────────────────────

async fn delegate(ctx: &Arc<RunCtx>, ac: &Arc<AgentCtx>, args: &Value, sink: &Sink) -> Result<String, String> {
    if ac.depth >= 1 {
        return Err("nested subagents are not allowed (depth limit 1)".into());
    }
    let name = tools::str_arg(args, "agent")?;
    let task = tools::str_arg(args, "task")?;
    let def = ctx.defs.iter().find(|d| d.name == name).cloned().ok_or_else(|| {
        format!("unknown agent `{name}`; available: {}", ctx.defs.iter().map(|d| d.name.as_str()).collect::<Vec<_>>().join(", "))
    })?;
    let (ok, text) = run_child(ctx, &ac.engine, ac.depth + 1, def, task.to_string(), sink).await;
    if ok { Ok(text) } else { Err(text) }
}

/// Run one subagent to completion. Its mode is clamped to the parent's, so a child can
/// never do more than the parent could; rules (and so deny) are the parent's too.
async fn run_child(ctx: &Arc<RunCtx>, parent: &Engine, depth: u8, def: AgentDef, task: String, sink: &Sink) -> (bool, String) {
    let s = &ctx.s;
    let id = format!("c{}", s.next_child.fetch_add(1, Ordering::Relaxed));
    let flag = Arc::new(AtomicBool::new(false));
    s.children.lock().unwrap().insert(id.clone(), flag.clone());
    let csink = child_sink(sink, ctx.turn, id.clone(), def.name.clone());

    let _permit = ctx.sem.acquire().await; // at most `max_parallel` children at once
    let mode = def.mode.clamp_to(parent.mode);
    sink(AgentEvent::SubStarted { turn: ctx.turn, child: id.clone(), name: def.name.clone(), task: task.clone(), model: def.model.clone(), mode });
    let provider = def.model.as_deref().and_then(|m| ctx.provider.with_model(m)).map(Arc::new).unwrap_or_else(|| ctx.provider.clone());
    let child_ctx = Arc::new(RunCtx {
        s: ctx.s.clone(),
        ws: ctx.ws.clone(),
        provider,
        judge: ctx.judge.clone(),
        turn: ctx.turn,
        budget: ctx.budget.clone(), // one budget for the whole turn, children included
        sem: Semaphore::new(1),
        defs: vec![],
    });
    let ac = Arc::new(AgentCtx { child: Some(id.clone()), depth, engine: Engine { mode, rules: parent.rules.clone(), dirty: parent.dirty.clone() }, cancel: flag.clone() });
    let specs = tools::specs_for(mode, false);
    let result = if flag.load(Ordering::Relaxed) || s.cancel.load(Ordering::Relaxed) {
        Err("stopped".to_string())
    } else {
        drive(child_ctx.clone(), ac, child_system(&def, &ctx.ws, mode), specs, Hist::Local(vec![Msg::User { text: task }]), def.max_steps, csink).await
    };
    s.children.lock().unwrap().remove(&id);
    let (ok, text, steps) = match result {
        Ok((t, n)) => (true, tools::truncate(t.trim(), 8_000), n),
        Err(e) if e == "stopped" => (false, "the subagent was stopped by the user".to_string(), 0),
        Err(e) => (false, format!("the subagent failed: {e}"), 0),
    };
    sink(AgentEvent::SubDone { turn: ctx.turn, child: id, name: def.name.clone(), ok, steps, summary: tools::truncate(&text, 400) });
    (ok, text)
}

// ─── turns ────────────────────────────────────────────────────────────────────

/// Fold older turns into a summary when the history nears the model's window.
async fn maybe_compact(ctx: &RunCtx, system: &str, sink: &Sink) {
    let Some(model) = ctx.provider.model_name() else { return };
    let s = &ctx.s;
    let history = s.history.lock().unwrap().clone();
    let used = context::history_tokens(&history) + context::est_tokens(system);
    if used * 100 < context::window_for(model) * 80 || context::compaction_cut(&history).is_none() {
        return;
    }
    if let Ok((before, after)) = s.compact(&ctx.provider).await.map(|(_, b, a)| (b, a)) {
        sink(AgentEvent::Compacted { turn: ctx.turn, before, after });
    }
}

pub async fn run_turn(s: &Arc<Session>, provider: Arc<Provider>, input: TurnInput, turn: u32, sink: &Sink) {
    s.cancel.store(false, Ordering::Relaxed);
    s.children.lock().unwrap().clear();
    sink(AgentEvent::TurnStarted { turn });

    let ws = s.ws();
    let mut engine = Engine { mode: input.mode, rules: perm::load_rules(&ws), ..Default::default() };
    for d in &input.context.dirty_files {
        if let Ok((_, rel)) = ws.resolve(d, false) {
            engine.dirty.insert(rel);
        }
    }
    let (defs, _problems) = agents::load_all(&ws.root, input.user_agents_dir.as_deref());
    let rounds = match &input.run {
        RunSpec::Loop { max_rounds } => max_rounds.unwrap_or(DEFAULT_LOOP_ROUNDS).clamp(1, 10),
        _ => 1,
    };
    let mut limits = input.limits.clone();
    limits.turn_steps *= rounds;
    let ctx = Arc::new(RunCtx {
        s: s.clone(),
        ws: ws.clone(),
        provider: provider.clone(),
        judge: input.judge.clone(),
        turn,
        budget: Arc::new(Budget { steps: AtomicU32::new(0), tokens: AtomicU64::new(0), limits: limits.clone() }),
        sem: Semaphore::new(limits.max_parallel.max(1)),
        defs: defs.clone(),
    });
    let system = system_prompt(&ws, input.mode, &defs);

    if !matches!(input.run, RunSpec::Btw) {
        let mut m = s.meta.lock().unwrap();
        let hist_start = Some(s.history.lock().unwrap().len());
        if m.turns.is_empty() {
            m.title = store::title_from(&input.prompt);
        }
        m.turns.push(TurnRec { id: turn, prompt: input.prompt.clone(), hist_start, mode: input.mode, at: store::now() });
    }
    if input.mode == Mode::Bypass {
        sink(AgentEvent::Notice { turn, text: "BYPASS MODE: prompts are auto-approved. Deny rules in .fahh/permissions.json and the built-in blocks still apply.".into() });
    }
    maybe_compact(&ctx, &system, sink).await;

    let main_ac = Arc::new(AgentCtx { child: None, depth: 0, engine: engine.clone(), cancel: s.cancel.clone() });
    let specs = tools::specs_for(input.mode, true);
    let result: Result<u32, String> = match &input.run {
        RunSpec::Turn => {
            s.history.lock().unwrap().push(Msg::User { text: context_block(s, &input) });
            drive(ctx.clone(), main_ac, system, specs, Hist::Session(s.clone()), MAX_STEPS, sink.clone()).await.map(|(_, n)| n)
        }
        RunSpec::Btw => {
            // a side question: sees the conversation, adds nothing to it, cannot change anything
            let mut h = s.history.lock().unwrap().clone();
            h.push(Msg::User { text: input.prompt.clone() });
            let qa = Arc::new(AgentCtx { child: None, depth: 0, engine: Engine { mode: Mode::Qa, ..engine.clone() }, cancel: s.cancel.clone() });
            let sys = system_prompt(&ws, Mode::Qa, &defs);
            drive(ctx.clone(), qa, sys, tools::specs_for(Mode::Qa, false), Hist::Local(h), 10, sink.clone()).await.map(|(_, n)| n)
        }
        RunSpec::Agent { name } => run_agent_directly(&ctx, &engine, name, &input.prompt, sink).await,
        RunSpec::Loop { .. } => run_loop(&ctx, &engine, &input, rounds, system, sink).await,
    };
    match result {
        Ok(steps) => {
            let files = s.checkpoints.lock().unwrap().files(turn);
            sink(AgentEvent::Done { turn, steps, files });
        }
        Err(message) => sink(AgentEvent::Error { turn, message }),
    }
    s.save();
}

async fn run_agent_directly(ctx: &Arc<RunCtx>, engine: &Engine, name: &str, task: &str, sink: &Sink) -> Result<u32, String> {
    let def = ctx.defs.iter().find(|d| d.name == name).cloned().ok_or_else(|| format!("unknown agent `{name}`; /agents lists them"))?;
    let (ok, text) = run_child(ctx, engine, 1, def, task.to_string(), sink).await;
    sink(AgentEvent::TextDelta { turn: ctx.turn, text: text.clone() });
    {
        let mut h = ctx.s.history.lock().unwrap();
        h.push(Msg::User { text: format!("/agent {name} {task}") });
        h.push(Msg::Assistant { text: text.clone(), calls: vec![] });
    }
    if ok { Ok(1) } else { Err(text) }
}

// ─── /loop ────────────────────────────────────────────────────────────────────

pub enum Review {
    Approved,
    Changes(String),
}

/// First line APPROVED -> done; otherwise everything after a leading CHANGES is the fix list.
pub fn parse_review(text: &str) -> Review {
    let t = text.trim();
    let first = t.lines().next().unwrap_or("").trim().trim_matches(|c: char| !c.is_alphanumeric()).to_uppercase();
    if first == "APPROVED" {
        return Review::Approved;
    }
    let notes = if first.starts_with("CHANGES") { t.split_once('\n').map(|x| x.1).unwrap_or("").trim() } else { t };
    Review::Changes(if notes.is_empty() { "(the reviewer gave no details)".into() } else { notes.to_string() })
}

fn turn_diff_text(s: &Session, turn: u32) -> String {
    let mut out = String::new();
    for d in s.checkpoints.lock().unwrap().diff(turn) {
        out += &tools::simple_diff(&d.path, d.before.as_deref(), d.after.as_deref());
        out.push('\n');
    }
    tools::truncate(&out, 40_000)
}

async fn run_loop(ctx: &Arc<RunCtx>, engine: &Engine, input: &TurnInput, rounds: u32, system: String, sink: &Sink) -> Result<u32, String> {
    let (s, turn) = (&ctx.s, ctx.turn);
    if engine.mode.read_only() {
        return Err("/loop edits files: switch out of plan/ask mode first".into());
    }
    let dirty = git_dirty(&ctx.ws.root);
    sink(AgentEvent::Notice {
        turn,
        text: if dirty {
            "The workspace has uncommitted changes. Every file the loop touches is checkpointed, so /revert restores just those files.".into()
        } else {
            "Starting /loop: every file it touches is checkpointed, so /revert undoes it.".into()
        },
    });
    let reviewer = ctx.defs.iter().find(|d| d.name == "reviewer").cloned().ok_or("no `reviewer` agent is defined")?;
    let mut prompt = context_block(s, input);
    let mut steps = 0;
    let specs = tools::specs_for(engine.mode, true);
    for round in 1..=rounds {
        s.history.lock().unwrap().push(Msg::User { text: prompt.clone() });
        let ac = Arc::new(AgentCtx { child: None, depth: 0, engine: engine.clone(), cancel: s.cancel.clone() });
        let (_, n) = drive(ctx.clone(), ac, system.clone(), specs.clone(), Hist::Session(s.clone()), MAX_STEPS, sink.clone()).await?;
        steps += n;
        let diff = turn_diff_text(s, turn);
        if diff.trim().is_empty() {
            sink(AgentEvent::Notice { turn, text: "The round changed no files, so there is nothing to review.".into() });
            return Ok(steps);
        }
        let task = format!(
            "Original request:\n{}\n\nReview this change. The first line of your reply must be exactly APPROVED, or CHANGES followed by concrete fix instructions.\n\n{diff}",
            input.prompt
        );
        let (ok, text) = run_child(ctx, engine, 1, reviewer.clone(), task, sink).await;
        if !ok {
            return Err(format!("the reviewer could not finish: {text}"));
        }
        match parse_review(&text) {
            Review::Approved => {
                sink(AgentEvent::LoopRound { turn, round, max: rounds, approved: true, notes: String::new() });
                return Ok(steps);
            }
            Review::Changes(notes) => {
                sink(AgentEvent::LoopRound { turn, round, max: rounds, approved: false, notes: tools::truncate(&notes, 600) });
                if round == rounds {
                    sink(AgentEvent::Notice { turn, text: format!("/loop stopped at its cap of {rounds} round(s) without approval; the last review notes are above.") });
                    return Ok(steps);
                }
                prompt = format!("A reviewer looked at your changes and asked for these fixes:\n{notes}\n\nApply them.");
            }
        }
    }
    Ok(steps)
}

fn git_dirty(root: &std::path::Path) -> bool {
    git2::Repository::discover(root)
        .and_then(|r| r.statuses(None).map(|s| s.iter().any(|e| !e.status().is_ignored())))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::perm::Mode;
    use crate::agent::provider::ModelTurn;
    use serde_json::json;
    use std::sync::Mutex;

    struct Harness {
        dir: tempfile::TempDir,
        s: Arc<Session>,
        events: Arc<Mutex<Vec<AgentEvent>>>,
        sink: Sink,
    }

    fn approval_of(ev: &AgentEvent) -> Option<&str> {
        match ev {
            AgentEvent::ApprovalRequest { id, .. } => Some(id),
            AgentEvent::Sub { event, .. } => approval_of(event),
            _ => None,
        }
    }

    /// `answer` decides every approval the loop asks for (child approvals included).
    fn harness(answer: impl Fn(&AgentEvent) -> Decision + Send + Sync + 'static) -> Harness {
        let dir = tempfile::tempdir().unwrap();
        let ws = Workspace::new(dir.path().to_str().unwrap()).unwrap();
        let s = Arc::new(Session::new("t".into(), ws, Default::default()));
        let events = Arc::new(Mutex::new(Vec::new()));
        let (s2, e2) = (s.clone(), events.clone());
        let sink: Sink = Arc::new(move |ev| {
            if let Some(id) = approval_of(&ev) {
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
    fn yes() -> Decision {
        Decision { allow: true, always: false, command: None }
    }
    fn mock(turns: Vec<ModelTurn>) -> Arc<Provider> {
        Arc::new(Provider::mock(turns))
    }
    async fn run(h: &Harness, p: Arc<Provider>, mode: Mode, prompt: &str, turn_id: u32) {
        run_turn(&h.s, p, TurnInput::new(prompt, mode), turn_id, &h.sink).await;
    }
    fn events(h: &Harness) -> Vec<AgentEvent> {
        h.events.lock().unwrap().clone()
    }
    fn count(h: &Harness, f: impl Fn(&AgentEvent) -> bool) -> usize {
        events(h).iter().filter(|e| f(e)).count()
    }
    fn last_result(h: &Harness) -> String {
        match h.s.history.lock().unwrap().iter().rev().find(|m| matches!(m, Msg::ToolResult { .. })) {
            Some(Msg::ToolResult { content, .. }) => content.clone(),
            _ => String::new(),
        }
    }
    fn user_text(history: &[Msg]) -> String {
        history.iter().find_map(|m| if let Msg::User { text } = m { Some(text.clone()) } else { None }).unwrap_or_default()
    }
    fn has_results(history: &[Msg]) -> bool {
        history.iter().any(|m| matches!(m, Msg::ToolResult { .. }))
    }
    fn write_agent(h: &Harness, name: &str, mode: &str) {
        std::fs::create_dir_all(h.dir.path().join(".fahh/agents")).unwrap();
        std::fs::write(h.dir.path().join(format!(".fahh/agents/{name}.md")), format!("---\nname: {name}\ndescription: test agent\nmode: {mode}\nmax_steps: 6\n---\nYou are {name}.\n")).unwrap();
    }
    fn is_parent(system: &str) -> bool {
        system.contains("You are Fahh Local, a coding agent")
    }

    // ── the basic loop (phase 1) ──

    #[tokio::test]
    async fn loop_runs_tool_call_then_final_answer() {
        let h = harness(|_| yes());
        std::fs::write(h.dir.path().join("a.txt"), "hello").unwrap();
        let p = mock(vec![turn("Let me look.", vec![call("1", "read_file", json!({"path": "a.txt"}))]), turn("It says hello.", vec![])]);
        run(&h, p, Mode::Ask, "what is in a.txt?", 1).await;
        let ev = events(&h);
        assert!(ev.iter().any(|e| matches!(e, AgentEvent::TextDelta { text, .. } if text == "Let me look.")));
        assert!(ev.iter().any(|e| matches!(e, AgentEvent::ToolResult { ok: true, output, .. } if output.contains("hello"))));
        assert!(matches!(ev.last().unwrap(), AgentEvent::Done { steps: 2, .. }));
        assert_eq!(h.s.history.lock().unwrap().len(), 4);
    }

    #[tokio::test]
    async fn ask_mode_edit_waits_for_approval_and_can_be_reverted() {
        let h = harness(|_| yes());
        let f = h.dir.path().join("a.txt");
        std::fs::write(&f, "one").unwrap();
        let p = mock(vec![turn("", vec![call("1", "edit_file", json!({"path": "a.txt", "old_str": "one", "new_str": "two"}))]), turn("done", vec![])]);
        run(&h, p, Mode::Ask, "change it", 1).await;
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "two");
        assert_eq!(count(&h, |e| matches!(e, AgentEvent::ApprovalRequest { path: Some(p), .. } if p == "a.txt")), 1);
        assert!(matches!(events(&h).last().unwrap(), AgentEvent::Done { files, .. } if files == &vec!["a.txt".to_string()]));
        assert_eq!(h.s.checkpoints.lock().unwrap().revert_turn(1).unwrap(), vec!["a.txt".to_string()]);
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "one");
    }

    #[tokio::test]
    async fn declined_edit_changes_nothing_and_tells_the_model() {
        let h = harness(|_| Decision { allow: false, always: false, command: None });
        let f = h.dir.path().join("a.txt");
        std::fs::write(&f, "one").unwrap();
        let p = mock(vec![turn("", vec![call("1", "write_file", json!({"path": "a.txt", "content": "x"}))]), turn("ok", vec![])]);
        run(&h, p, Mode::Ask, "x", 1).await;
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "one");
        assert!(last_result(&h).starts_with("denied"));
    }

    #[tokio::test]
    async fn auto_edit_does_not_ask_but_dirty_files_still_do() {
        let h = harness(|_| yes());
        std::fs::write(h.dir.path().join("a.txt"), "one").unwrap();
        std::fs::write(h.dir.path().join("b.txt"), "one").unwrap();
        let p = mock(vec![
            turn("", vec![call("1", "edit_file", json!({"path": "a.txt", "old_str": "one", "new_str": "A"}))]),
            turn("", vec![call("2", "edit_file", json!({"path": "b.txt", "old_str": "one", "new_str": "B"}))]),
            turn("done", vec![]),
        ]);
        let mut inp = TurnInput::new("x", Mode::AutoEdit);
        inp.context.dirty_files = vec![h.dir.path().join("b.txt").to_string_lossy().into_owned()];
        run_turn(&h.s, p, inp, 1, &h.sink).await;
        let asked: Vec<_> = events(&h).iter().filter_map(|e| if let AgentEvent::ApprovalRequest { path, .. } = e { path.clone() } else { None }).collect();
        assert_eq!(asked, vec!["b.txt".to_string()]);
    }

    #[tokio::test]
    async fn plan_mode_blocks_edits_and_writes_a_plan() {
        let h = harness(|_| yes());
        let f = h.dir.path().join("a.txt");
        std::fs::write(&f, "one").unwrap();
        let p = mock(vec![
            turn("", vec![
                call("1", "edit_file", json!({"path": "a.txt", "old_str": "one", "new_str": "two"})),
                call("2", "run_command", json!({"command": "rm a.txt"})),
                call("3", "write_plan", json!({"title": "Change a", "markdown": "1. edit a.txt"})),
            ]),
            turn("plan ready", vec![]),
        ]);
        run(&h, p, Mode::Plan, "plan it", 1).await;
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "one");
        assert_eq!(count(&h, |e| matches!(e, AgentEvent::ApprovalRequest { .. })), 0);
        assert!(events(&h).iter().any(|e| matches!(e, AgentEvent::PlanWritten { path, .. } if path.starts_with(".fahh/plans/change-a"))));
        let plan = std::fs::read_dir(h.dir.path().join(".fahh/plans")).unwrap().next().unwrap().unwrap().path();
        assert!(std::fs::read_to_string(plan).unwrap().contains("edit a.txt"));
    }

    #[tokio::test]
    async fn command_approval_can_be_edited_and_is_rechecked_against_deny() {
        let h = harness(|_| Decision { allow: true, always: false, command: Some("echo edited".into()) });
        run(&h, mock(vec![turn("", vec![call("1", "run_command", json!({"command": "echo original"}))]), turn("ok", vec![])]), Mode::Ask, "x", 1).await;
        let r = last_result(&h);
        assert!(r.contains("edited") && !r.contains("original"), "{r}");
        let h = harness(|_| Decision { allow: true, always: false, command: Some("sudo reboot".into()) });
        run(&h, mock(vec![turn("", vec![call("1", "run_command", json!({"command": "echo hi"}))]), turn("ok", vec![])]), Mode::Ask, "x", 1).await;
        assert!(last_result(&h).starts_with("denied"));
    }

    #[tokio::test]
    async fn always_allow_is_saved_and_skips_the_next_prompt() {
        let h = harness(|_| Decision { allow: true, always: true, command: None });
        run(&h, mock(vec![turn("", vec![call("1", "run_command", json!({"command": "echo hi"}))]), turn("ok", vec![])]), Mode::Ask, "x", 1).await;
        assert!(std::fs::read_to_string(h.dir.path().join(".fahh/permissions.json")).unwrap().contains("echo hi"));
        run(&h, mock(vec![turn("", vec![call("2", "run_command", json!({"command": "echo hi"}))]), turn("ok", vec![])]), Mode::Ask, "again", 2).await;
        assert_eq!(count(&h, |e| matches!(e, AgentEvent::ApprovalRequest { .. })), 1);
    }

    #[tokio::test]
    async fn outside_workspace_and_unknown_tools_fail_cleanly() {
        let h = harness(|_| yes());
        let p = mock(vec![turn("", vec![call("1", "read_file", json!({"path": "../../etc/passwd"})), call("2", "format_disk", json!({}))]), turn("sorry", vec![])]);
        run(&h, p, Mode::AutoEdit, "x", 1).await;
        assert_eq!(count(&h, |e| matches!(e, AgentEvent::ToolResult { ok: false, .. })), 2);
        assert!(matches!(events(&h).last().unwrap(), AgentEvent::Done { .. }));
    }

    #[tokio::test]
    async fn step_limit_and_provider_errors_end_the_turn() {
        let h = harness(|_| yes());
        let turns = (0..MAX_STEPS + 2).map(|i| turn("", vec![call(&i.to_string(), "list_dir", json!({"path": "."}))])).collect();
        run(&h, mock(turns), Mode::Ask, "x", 1).await;
        assert!(matches!(events(&h).last().unwrap(), AgentEvent::Error { message, .. } if message.contains("steps")));
        let h = harness(|_| yes());
        run(&h, mock(vec![]), Mode::Ask, "x", 1).await;
        assert!(matches!(events(&h).last().unwrap(), AgentEvent::Error { .. }));
    }

    #[test]
    fn project_rules_and_agents_are_added_to_the_system_prompt() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("AGENTS.md"), "use tabs").unwrap();
        let ws = Workspace::new(dir.path().to_str().unwrap()).unwrap();
        let defs = agents::builtins();
        let p = system_prompt(&ws, Mode::Ask, &defs);
        assert!(p.contains("use tabs") && p.contains("- explore:") && p.contains("delegate"));
        assert!(system_prompt(&ws, Mode::Plan, &[]).contains("PLAN MODE"));
        assert!(!system_prompt(&ws, Mode::Qa, &defs).contains("delegate"));
    }

    // ── modes ──

    #[tokio::test]
    async fn qa_mode_refuses_writes_and_commands_even_if_the_model_asks() {
        let h = harness(|_| yes());
        let p = mock(vec![
            turn("", vec![
                call("1", "write_file", json!({"path": "x.txt", "content": "no"})),
                call("2", "run_command", json!({"command": "echo hi > y.txt"})),
                call("3", "read_file", json!({"path": "nope.txt"})),
            ]),
            turn("I can only read.", vec![]),
        ]);
        run(&h, p, Mode::Qa, "change things", 1).await;
        assert!(!h.dir.path().join("x.txt").exists() && !h.dir.path().join("y.txt").exists());
        assert_eq!(count(&h, |e| matches!(e, AgentEvent::ApprovalRequest { .. })), 0);
        assert!(matches!(events(&h).last().unwrap(), AgentEvent::Done { .. }));
    }

    #[tokio::test]
    async fn smart_mode_runs_safe_commands_and_asks_for_unsafe_ones() {
        // judge says SAFE: no approval, command runs, verdict is logged as an event
        let h = harness(|_| yes());
        let mut inp = TurnInput::new("x", Mode::Smart);
        inp.judge = Some(mock(vec![turn("SAFE read-only echo", vec![])]));
        let p = mock(vec![turn("", vec![call("1", "run_command", json!({"command": "echo hi > ran.txt"}))]), turn("ok", vec![])]);
        run_turn(&h.s, p, inp, 1, &h.sink).await;
        assert!(h.dir.path().join("ran.txt").exists());
        assert_eq!(count(&h, |e| matches!(e, AgentEvent::ApprovalRequest { .. })), 0);
        assert_eq!(count(&h, |e| matches!(e, AgentEvent::Judge { safe: true, .. })), 1);

        // judge says UNSAFE: the user is asked; declining stops it
        let h = harness(|_| Decision { allow: false, always: false, command: None });
        let mut inp = TurnInput::new("x", Mode::Smart);
        inp.judge = Some(mock(vec![turn("UNSAFE deletes files", vec![])]));
        let p = mock(vec![turn("", vec![call("1", "run_command", json!({"command": "echo hi > ran.txt"}))]), turn("ok", vec![])]);
        run_turn(&h.s, p, inp, 1, &h.sink).await;
        assert!(!h.dir.path().join("ran.txt").exists());
        assert!(events(&h).iter().any(|e| matches!(e, AgentEvent::ApprovalRequest { summary, .. } if summary.contains("deletes files"))));
        assert_eq!(count(&h, |e| matches!(e, AgentEvent::Judge { safe: false, .. })), 1);

        // judge unavailable: fail closed (asks)
        let h = harness(|_| Decision { allow: false, always: false, command: None });
        let mut inp = TurnInput::new("x", Mode::Smart);
        inp.judge = Some(mock(vec![])); // errors: no scripted turns
        let p = mock(vec![turn("", vec![call("1", "run_command", json!({"command": "echo hi"}))]), turn("ok", vec![])]);
        run_turn(&h.s, p, inp, 1, &h.sink).await;
        assert_eq!(count(&h, |e| matches!(e, AgentEvent::ApprovalRequest { .. })), 1);
        // edits are auto-approved in smart mode
        let h = harness(|_| yes());
        let p = mock(vec![turn("", vec![call("1", "write_file", json!({"path": "a.txt", "content": "x"}))]), turn("ok", vec![])]);
        run(&h, p, Mode::Smart, "x", 1).await;
        assert!(h.dir.path().join("a.txt").exists());
        assert_eq!(count(&h, |e| matches!(e, AgentEvent::ApprovalRequest { .. })), 0);
    }

    #[test]
    fn judge_verdict_parsing() {
        assert_eq!(parse_verdict("SAFE: only reads"), (true, "only reads".into()));
        assert_eq!(parse_verdict("safe - fine").0, true);
        assert_eq!(parse_verdict("UNSAFE it deletes"), (false, "it deletes".into()));
        assert!(!parse_verdict("maybe").0);
        assert!(!parse_verdict("").0);
        assert!(!parse_verdict("This is SAFE").0); // the first word decides
    }

    #[tokio::test]
    async fn bypass_runs_without_asking_but_deny_rules_still_win() {
        let h = harness(|_| yes());
        std::fs::create_dir_all(h.dir.path().join(".fahh")).unwrap();
        std::fs::write(h.dir.path().join(".fahh/permissions.json"), r#"{"rules":[{"action":"deny","kind":"run","pattern":"touch denied*"},{"action":"deny","kind":"edit","pattern":"locked.txt"}]}"#).unwrap();
        let p = mock(vec![
            turn("", vec![
                call("1", "run_command", json!({"command": "touch ok.txt"})),
                call("2", "run_command", json!({"command": "touch denied.txt"})),
                call("3", "write_file", json!({"path": "locked.txt", "content": "x"})),
                call("4", "write_file", json!({"path": "free.txt", "content": "x"})),
            ]),
            turn("done", vec![]),
        ]);
        run(&h, p, Mode::Bypass, "go", 1).await;
        let d = h.dir.path();
        assert!(d.join("ok.txt").exists() && d.join("free.txt").exists());
        assert!(!d.join("denied.txt").exists() && !d.join("locked.txt").exists());
        assert_eq!(count(&h, |e| matches!(e, AgentEvent::ApprovalRequest { .. })), 0);
        assert!(events(&h).iter().any(|e| matches!(e, AgentEvent::Notice { text, .. } if text.contains("BYPASS"))));
    }

    // ── subagents ──

    /// Parent delegates to `explore` twice; each child lists a dir then answers "result-for-<task>".
    fn delegating_provider() -> Arc<Provider> {
        Arc::new(Provider::Scripted(Box::new(|system, history| {
            if is_parent(system) {
                if !has_results(history) {
                    turn("", vec![call("d1", "delegate", json!({"agent": "explore", "task": "alpha"})), call("d2", "delegate", json!({"agent": "explore", "task": "beta"}))])
                } else {
                    let merged: Vec<String> = history.iter().filter_map(|m| if let Msg::ToolResult { content, .. } = m { Some(content.clone()) } else { None }).collect();
                    turn(&format!("merged: {}", merged.join(" | ")), vec![])
                }
            } else if !has_results(history) {
                turn("", vec![call("l", "list_dir", json!({"path": "."}))])
            } else {
                turn(&format!("result-for-{}", user_text(history)), vec![])
            }
        })))
    }

    #[tokio::test]
    async fn parent_delegates_to_two_subagents_and_gets_only_their_results() {
        let h = harness(|_| yes());
        run(&h, delegating_provider(), Mode::Ask, "investigate", 1).await;
        assert_eq!(count(&h, |e| matches!(e, AgentEvent::SubStarted { .. })), 2);
        assert_eq!(count(&h, |e| matches!(e, AgentEvent::SubDone { ok: true, .. })), 2);
        // children's tool lines arrive wrapped, tagged with the agent name
        assert!(events(&h).iter().any(|e| matches!(e, AgentEvent::Sub { name, event, .. } if name == "explore" && matches!(**event, AgentEvent::ToolCall { .. }))));
        let hist = h.s.history.lock().unwrap().clone();
        // parent context: user, assistant(2 delegate calls), 2 results, final assistant: no child tool lines
        assert_eq!(hist.len(), 5, "{hist:?}");
        let Msg::Assistant { text, .. } = hist.last().unwrap() else { panic!() };
        assert!(text.contains("result-for-alpha") && text.contains("result-for-beta"), "{text}");
        assert!(matches!(events(&h).last().unwrap(), AgentEvent::Done { .. }));
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn subagents_really_run_in_parallel() {
        // each child waits for the other's file: this only finishes if both run at once
        let h = harness(|_| yes());
        write_agent(&h, "wa", "accept-edits");
        write_agent(&h, "wb", "accept-edits");
        let p = Arc::new(Provider::Scripted(Box::new(|system, history| {
            if is_parent(system) {
                if !has_results(history) {
                    return turn("", vec![call("1", "delegate", json!({"agent": "wa", "task": "a"})), call("2", "delegate", json!({"agent": "wb", "task": "b"}))]);
                }
                return turn("both done", vec![]);
            }
            if has_results(history) {
                return turn("finished", vec![]);
            }
            let (mine, other) = if system.contains("You are wa.") { ("a.flag", "b.flag") } else { ("b.flag", "a.flag") };
            let cmd = format!("touch {mine}; i=0; while [ ! -e {other} ] && [ $i -lt 200 ]; do sleep 0.05; i=$((i+1)); done; test -e {other}");
            turn("", vec![call("c", "run_command", json!({"command": cmd, "timeout_secs": 30}))])
        })));
        run_turn(&h.s, p, TurnInput::new("go", Mode::Bypass), 1, &h.sink).await;
        assert_eq!(count(&h, |e| matches!(e, AgentEvent::SubDone { ok: true, .. })), 2, "{:?}", events(&h).iter().filter(|e| matches!(e, AgentEvent::Error { .. } | AgentEvent::SubDone { .. })).collect::<Vec<_>>());
        assert!(h.dir.path().join("a.flag").exists() && h.dir.path().join("b.flag").exists());
    }

    #[tokio::test]
    async fn a_child_can_never_exceed_the_parents_mode() {
        let delegate_to = |agent: &'static str| {
            Arc::new(Provider::Scripted(Box::new(move |system, history| {
                if is_parent(system) {
                    if !has_results(history) { turn("", vec![call("d", "delegate", json!({"agent": agent, "task": "write it"}))]) } else { turn("done", vec![]) }
                } else if !has_results(history) {
                    turn("", vec![call("w", "write_file", json!({"path": "child.txt", "content": "from child"}))])
                } else {
                    turn("child done", vec![])
                }
            })))
        };
        // plan-mode parent, child defined as accept-edits: still read-only, nothing written, nobody asked
        let h = harness(|_| yes());
        write_agent(&h, "writer", "accept-edits");
        run(&h, delegate_to("writer"), Mode::Plan, "x", 1).await;
        assert!(!h.dir.path().join("child.txt").exists());
        assert_eq!(count(&h, |e| approval_ev(e)), 0);
        assert!(events(&h).iter().any(|e| matches!(e, AgentEvent::SubStarted { mode: Mode::Plan, .. })));

        // ask-mode parent: the child's edit asks (surfaced through the same prompt, tagged with the agent)
        let h = harness(|_| Decision { allow: false, always: false, command: None });
        write_agent(&h, "writer", "bypass");
        run(&h, delegate_to("writer"), Mode::Ask, "x", 1).await;
        assert!(!h.dir.path().join("child.txt").exists());
        assert!(events(&h).iter().any(|e| matches!(e, AgentEvent::Sub { name, event, .. } if name == "writer" && matches!(**event, AgentEvent::ApprovalRequest { .. }))));
        assert!(events(&h).iter().any(|e| matches!(e, AgentEvent::SubStarted { mode: Mode::Ask, .. })));

        // auto-edit parent + accept-edits child: applies without asking
        let h = harness(|_| yes());
        write_agent(&h, "writer", "accept-edits");
        run(&h, delegate_to("writer"), Mode::AutoEdit, "x", 1).await;
        assert_eq!(std::fs::read_to_string(h.dir.path().join("child.txt")).unwrap(), "from child");
        assert_eq!(count(&h, |e| approval_ev(e)), 0);

        // deny rules reach children
        let h = harness(|_| yes());
        write_agent(&h, "writer", "accept-edits");
        std::fs::create_dir_all(h.dir.path().join(".fahh")).unwrap();
        std::fs::write(h.dir.path().join(".fahh/permissions.json"), r#"{"rules":[{"action":"deny","kind":"edit","pattern":"child.txt"}]}"#).unwrap();
        run(&h, delegate_to("writer"), Mode::Bypass, "x", 1).await;
        assert!(!h.dir.path().join("child.txt").exists());
    }

    fn approval_ev(e: &AgentEvent) -> bool {
        approval_of(e).is_some()
    }

    #[tokio::test]
    async fn nested_delegation_is_refused_at_depth_one() {
        let h = harness(|_| yes());
        write_agent(&h, "boss", "accept-edits");
        let seen_delegate_tool = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = seen_delegate_tool.clone();
        let p = Arc::new(Provider::Scripted(Box::new(move |system, history| {
            if is_parent(system) {
                if !has_results(history) { turn("", vec![call("d", "delegate", json!({"agent": "boss", "task": "t"}))]) } else { turn("parent done", vec![]) }
            } else if !has_results(history) {
                flag.store(true, Ordering::Relaxed);
                // the child tries anyway
                turn("", vec![call("n", "delegate", json!({"agent": "explore", "task": "deeper"}))])
            } else {
                let r = history.iter().find_map(|m| if let Msg::ToolResult { content, .. } = m { Some(content.clone()) } else { None }).unwrap();
                turn(&format!("child saw: {r}"), vec![])
            }
        })));
        run(&h, p, Mode::Ask, "x", 1).await;
        assert!(seen_delegate_tool.load(Ordering::Relaxed));
        assert_eq!(count(&h, |e| matches!(e, AgentEvent::SubStarted { .. })), 1); // no grandchild
        assert!(last_result(&h).contains("depth limit"), "{}", last_result(&h));
        assert!(tools::specs_for(Mode::Ask, false).iter().all(|t| t.name != "delegate"));
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn stopping_one_child_does_not_cancel_the_parent_or_the_other_child() {
        let h = harness(|_| yes());
        write_agent(&h, "slowpoke", "accept-edits");
        write_agent(&h, "quick", "accept-edits");
        let s2 = h.s.clone();
        let events_log = h.events.clone();
        // stop `slowpoke` 300 ms after it starts its long command, from outside the loop
        let sink: Sink = Arc::new(move |ev| {
            if let Some(id) = approval_of(&ev) {
                s2.resolve(id, yes());
            }
            if let AgentEvent::Sub { child, name, event, .. } = &ev {
                if name == "slowpoke" && matches!(**event, AgentEvent::ToolCall { .. }) {
                    let (s3, c) = (s2.clone(), child.clone());
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(300));
                        s3.stop_child(&c);
                    });
                }
            }
            events_log.lock().unwrap().push(ev);
        });
        let p = Arc::new(Provider::Scripted(Box::new(|system, history| {
            if is_parent(system) {
                if !has_results(history) {
                    return turn("", vec![call("1", "delegate", json!({"agent": "slowpoke", "task": "s"})), call("2", "delegate", json!({"agent": "quick", "task": "q"}))]);
                }
                let r: Vec<String> = history.iter().filter_map(|m| if let Msg::ToolResult { content, .. } = m { Some(content.clone()) } else { None }).collect();
                return turn(&format!("parent finished; results: {}", r.join(" | ")), vec![]);
            }
            if has_results(history) {
                return turn("quick result", vec![]);
            }
            if system.contains("You are slowpoke.") {
                turn("", vec![call("c", "run_command", json!({"command": "sleep 30", "timeout_secs": 60}))])
            } else {
                turn("", vec![call("l", "list_dir", json!({"path": "."}))])
            }
        })));
        let t = std::time::Instant::now();
        run_turn(&h.s, p, TurnInput::new("go", Mode::Bypass), 1, &sink).await;
        assert!(t.elapsed() < std::time::Duration::from_secs(20), "the stopped child's sleep must be killed");
        let ev = events(&h);
        assert!(ev.iter().any(|e| matches!(e, AgentEvent::SubDone { ok: false, summary, .. } if summary.contains("stopped"))));
        assert!(ev.iter().any(|e| matches!(e, AgentEvent::SubDone { ok: true, .. })));
        let Some(AgentEvent::Done { .. }) = ev.last() else { panic!("parent should finish: {:?}", ev.last()) };
        let hist = h.s.history.lock().unwrap().clone();
        let Msg::Assistant { text, .. } = hist.last().unwrap() else { panic!() };
        assert!(text.contains("quick result") && text.contains("stopped"), "{text}");
    }

    #[tokio::test]
    async fn delegating_to_an_unknown_agent_lists_the_available_ones() {
        let h = harness(|_| yes());
        let p = mock(vec![turn("", vec![call("d", "delegate", json!({"agent": "ghost", "task": "t"}))]), turn("ok", vec![])]);
        run(&h, p, Mode::Ask, "x", 1).await;
        let r = last_result(&h);
        assert!(r.contains("unknown agent `ghost`") && r.contains("explore") && r.contains("reviewer"), "{r}");
    }

    #[tokio::test]
    async fn turn_budget_is_shared_with_children() {
        let h = harness(|_| yes());
        let mut inp = TurnInput::new("x", Mode::Ask);
        inp.limits = Limits { turn_steps: 3, ..Limits::default() };
        run_turn(&h.s, delegating_provider(), inp, 1, &h.sink).await;
        // parent call 1 + two children x2 calls = 5 > 3
        assert!(events(&h).iter().any(|e| matches!(e, AgentEvent::Error { message, .. } if message.contains("budget")) || matches!(e, AgentEvent::SubDone { ok: false, summary, .. } if summary.contains("budget"))), "{:?}", events(&h).last());
    }

    #[tokio::test]
    async fn agent_command_runs_one_definition_directly() {
        let h = harness(|_| yes());
        let p = Arc::new(Provider::Scripted(Box::new(|_, history| turn(&format!("explored: {}", user_text(history)), vec![]))));
        let mut inp = TurnInput::new("find the parser", Mode::Ask);
        inp.run = RunSpec::Agent { name: "explore".into() };
        run_turn(&h.s, p, inp, 1, &h.sink).await;
        assert!(events(&h).iter().any(|e| matches!(e, AgentEvent::TextDelta { text, .. } if text == "explored: find the parser")));
        assert!(matches!(events(&h).last().unwrap(), AgentEvent::Done { .. }));
        let mut inp = TurnInput::new("t", Mode::Ask);
        inp.run = RunSpec::Agent { name: "nope".into() };
        run_turn(&h.s, mock(vec![]), inp, 2, &h.sink).await;
        assert!(matches!(events(&h).last().unwrap(), AgentEvent::Error { message, .. } if message.contains("unknown agent")));
    }

    // ── /loop ──

    fn loop_provider(reviews: Vec<&'static str>) -> Arc<Provider> {
        let round = Arc::new(AtomicU32::new(0));
        let reviews = Arc::new(reviews);
        Arc::new(Provider::Scripted(Box::new(move |system, history| {
            if is_parent(system) {
                // the n-th user message of the session decides the file text; one write per round
                let users = history.iter().filter(|m| matches!(m, Msg::User { .. })).count();
                let wrote_this_round = matches!(history.last(), Some(Msg::ToolResult { .. }));
                if wrote_this_round {
                    return turn("round done", vec![]);
                }
                turn("", vec![call(&format!("w{users}"), "write_file", json!({"path": "out.txt", "content": format!("version {users}")}))])
            } else {
                // reviewer
                let n = round.fetch_add(1, Ordering::Relaxed) as usize;
                turn(reviews[n.min(reviews.len() - 1)], vec![])
            }
        })))
    }

    #[tokio::test]
    async fn loop_stops_when_the_reviewer_approves() {
        let h = harness(|_| yes());
        let mut inp = TurnInput::new("write out.txt", Mode::AutoEdit);
        inp.run = RunSpec::Loop { max_rounds: Some(3) };
        run_turn(&h.s, loop_provider(vec!["CHANGES\nmake it version 2", "APPROVED"]), inp, 1, &h.sink).await;
        let rounds: Vec<_> = events(&h).iter().filter_map(|e| if let AgentEvent::LoopRound { round, approved, notes, .. } = e { Some((*round, *approved, notes.clone())) } else { None }).collect();
        assert_eq!(rounds.len(), 2, "{rounds:?}");
        assert_eq!((rounds[0].0, rounds[0].1), (1, false));
        assert!(rounds[0].2.contains("version 2"));
        assert_eq!((rounds[1].0, rounds[1].1), (2, true));
        assert!(matches!(events(&h).last().unwrap(), AgentEvent::Done { .. }));
        assert_eq!(std::fs::read_to_string(h.dir.path().join("out.txt")).unwrap(), "version 2"); // round 2 wrote after the fix prompt
        // the reviewer's notes became the next round's prompt
        let hist = h.s.history.lock().unwrap().clone();
        assert!(hist.iter().any(|m| matches!(m, Msg::User { text } if text.contains("asked for these fixes") && text.contains("make it version 2"))));
        // one checkpointed step: a single revert undoes the whole loop
        assert_eq!(h.s.checkpoints.lock().unwrap().revert_turn(1).unwrap(), vec!["out.txt".to_string()]);
        assert!(!h.dir.path().join("out.txt").exists());
    }

    #[tokio::test]
    async fn loop_stops_at_the_cap_without_approval() {
        let h = harness(|_| yes());
        let mut inp = TurnInput::new("write out.txt", Mode::AutoEdit);
        inp.run = RunSpec::Loop { max_rounds: Some(2) };
        run_turn(&h.s, loop_provider(vec!["CHANGES\nstill wrong"]), inp, 1, &h.sink).await;
        assert_eq!(count(&h, |e| matches!(e, AgentEvent::LoopRound { approved: false, .. })), 2);
        assert!(events(&h).iter().any(|e| matches!(e, AgentEvent::Notice { text, .. } if text.contains("cap of 2"))));
        assert!(matches!(events(&h).last().unwrap(), AgentEvent::Done { .. }));
    }

    #[tokio::test]
    async fn loop_needs_an_editing_mode_and_skips_review_when_nothing_changed() {
        let h = harness(|_| yes());
        let mut inp = TurnInput::new("x", Mode::Plan);
        inp.run = RunSpec::Loop { max_rounds: None };
        run_turn(&h.s, mock(vec![]), inp, 1, &h.sink).await;
        assert!(matches!(events(&h).last().unwrap(), AgentEvent::Error { message, .. } if message.contains("/loop edits files")));
        let h = harness(|_| yes());
        let mut inp = TurnInput::new("just look", Mode::AutoEdit);
        inp.run = RunSpec::Loop { max_rounds: None };
        run_turn(&h.s, mock(vec![turn("nothing to change", vec![])]), inp, 1, &h.sink).await;
        assert_eq!(count(&h, |e| matches!(e, AgentEvent::LoopRound { .. } | AgentEvent::SubStarted { .. })), 0);
        assert!(events(&h).iter().any(|e| matches!(e, AgentEvent::Notice { text, .. } if text.contains("no files"))));
    }

    #[test]
    fn review_parsing() {
        assert!(matches!(parse_review("APPROVED"), Review::Approved));
        assert!(matches!(parse_review("  approved.\nlooks good"), Review::Approved));
        assert!(matches!(parse_review("CHANGES\nfix x\nfix y"), Review::Changes(n) if n == "fix x\nfix y"));
        assert!(matches!(parse_review("CHANGES: rename"), Review::Changes(_)));
        assert!(matches!(parse_review("the code is wrong"), Review::Changes(n) if n == "the code is wrong"));
        assert!(matches!(parse_review(""), Review::Changes(_)));
    }

    // ── /btw, persistence ──

    #[tokio::test]
    async fn btw_answers_without_touching_the_conversation() {
        let h = harness(|_| yes());
        run(&h, mock(vec![turn("first answer", vec![])]), Mode::Ask, "first", 1).await;
        let before = h.s.history.lock().unwrap().len();
        let mut inp = TurnInput::new("quick side question", Mode::Ask);
        inp.run = RunSpec::Btw;
        let p = Arc::new(Provider::Scripted(Box::new(|_, history| turn(&format!("saw {} messages", history.len()), vec![]))));
        run_turn(&h.s, p, inp, 2, &h.sink).await;
        assert_eq!(h.s.history.lock().unwrap().len(), before); // nothing added
        assert_eq!(h.s.meta.lock().unwrap().turns.len(), 1); // and it is not a step
        assert!(events(&h).iter().any(|e| matches!(e, AgentEvent::TextDelta { text, .. } if text == "saw 3 messages")));
    }

    #[tokio::test]
    async fn sessions_persist_and_resume_across_restarts() {
        let data = tempfile::tempdir().unwrap();
        let h = harness(|_| yes());
        let ws = h.s.ws();
        let sdir = store::sessions_dir(data.path(), &ws.root);
        let s = Arc::new(Session::new("sess1".into(), ws.clone(), Default::default()).persistent(sdir.clone()));
        std::fs::write(h.dir.path().join("a.txt"), "one").unwrap();
        let p = mock(vec![turn("", vec![call("1", "write_file", json!({"path": "a.txt", "content": "two"}))]), turn("changed", vec![])]);
        run_turn(&s, p, TurnInput::new("change a", Mode::AutoEdit), 1, &h.sink).await;
        drop(s);
        // "restart": load from disk
        let f = store::load(&sdir, "sess1").unwrap();
        assert_eq!(f.title, "change a");
        assert_eq!(f.turns.len(), 1);
        let s2 = Session::from_file(f, ws, Default::default(), Some(sdir.clone()));
        assert_eq!(s2.history.lock().unwrap().len(), 4);
        // the checkpoint came back too: the old step can still be reverted
        assert_eq!(s2.revert_step(1).unwrap().0, vec!["a.txt".to_string()]);
        assert_eq!(std::fs::read_to_string(h.dir.path().join("a.txt")).unwrap(), "one");
        assert_eq!(s2.history.lock().unwrap().len(), 0);
        assert_eq!(store::list(&sdir).len(), 1);
    }

    #[tokio::test]
    async fn revert_step_rewinds_files_and_conversation_and_fork_branches() {
        let h = harness(|_| yes());
        let f = h.dir.path().join("a.txt");
        std::fs::write(&f, "v0").unwrap();
        for (i, text) in ["v1", "v2"].iter().enumerate() {
            let p = mock(vec![turn("", vec![call("1", "write_file", json!({"path": "a.txt", "content": text}))]), turn("ok", vec![])]);
            run(&h, p, Mode::AutoEdit, &format!("step {}", i + 1), i as u32 + 1).await;
        }
        assert_eq!(h.s.history.lock().unwrap().len(), 8);
        // fork after step 1: history up to the end of step 1, no checkpoints
        let fork = h.s.fork("fork1".into(), Some(1)).unwrap();
        assert_eq!((fork.history.len(), fork.turns.len()), (4, 1));
        assert!(fork.title.starts_with("Fork of"));
        // revert step 2: file back to v1, history back to 4 messages, one step left
        let (files, rewound) = h.s.revert_step(2).unwrap();
        assert_eq!((files, rewound), (vec!["a.txt".to_string()], true));
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "v1");
        assert_eq!(h.s.history.lock().unwrap().len(), 4);
        assert_eq!(h.s.meta.lock().unwrap().turns.len(), 1);
        // revert step 1 as well
        h.s.revert_step(1).unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "v0");
        assert!(h.s.revert_step(9).is_err());
    }

    #[tokio::test]
    async fn compact_command_summarises_older_turns_in_a_live_session() {
        let h = harness(|_| yes());
        run(&h, mock(vec![turn("a1", vec![])]), Mode::Ask, "first", 1).await;
        run(&h, mock(vec![turn("a2", vec![])]), Mode::Ask, "second", 2).await;
        let (folded, _, _) = h.s.compact(&mock(vec![turn("they discussed first", vec![])])).await.unwrap();
        assert_eq!(folded, 2);
        let hist = h.s.history.lock().unwrap().clone();
        assert_eq!(hist.len(), 3);
        assert!(matches!(&hist[0], Msg::User { text } if text.contains("they discussed first")));
        assert_eq!(h.s.meta.lock().unwrap().turns[1].hist_start, Some(1));
        assert_eq!(h.s.meta.lock().unwrap().turns[0].hist_start, None);
    }

    #[tokio::test]
    async fn usage_counts_calls_and_tools() {
        let h = harness(|_| yes());
        let p = mock(vec![turn("", vec![call("1", "list_dir", json!({"path": "."}))]), turn("done", vec![])]);
        run(&h, p, Mode::Ask, "x", 1).await;
        let u = h.s.meta.lock().unwrap().usage.clone();
        assert_eq!((u.model_calls, u.tool_calls), (2, 1));
        assert!(u.tokens_in > 0 && u.tokens_out > 0);
    }
}
