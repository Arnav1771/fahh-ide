//! `fahh-agent`: Fahh Local from a terminal, no window. Same core as the
//! editor panel (provider, tools, permission engine, checkpoints, sessions,
//! subagents); this file only parses arguments and talks to the terminal.
//!
//!   fahh-agent [--cwd DIR] [--provider P] [--model M] [--permission-mode MODE]
//!              [-c | -r ID] [-p PROMPT | --prompt-file F] [--export PATH] ["prompt"]
//!   fahh-agent models list [--provider P]
//!   fahh-agent sessions ls [--cwd DIR]
//!
//! No prompt starts a REPL with the same slash commands as the panel (/help).
//! API keys come from environment variables only (GROQ_API_KEY, GEMINI_API_KEY,
//! NVIDIA_API_KEY, OPENROUTER_API_KEY, ANTHROPIC_API_KEY) and are never printed.

use super::perm::{Mode, Workspace};
use super::provider::{ModelTurn, Provider, ProviderConfig, ProviderKind};
use super::runner::{run_turn, Limits, TurnInput};
use super::slash::{self, Slash};
use super::{agents, context, store, AgentEvent, Decision, RunSpec, Session, Sink};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

pub const USAGE: &str = "usage: fahh-agent [--cwd DIR] [--provider groq|gemini|nvidia|openrouter|ollama|anthropic] [--model M]\n\
  [--permission-mode normal|accept-edits|smart|plan|bypass] [-c | -r ID] [-p PROMPT | --prompt-file F]\n\
  [--fast-model M] [--judge-model M] [--config FILE] [--export PATH] [\"prompt\"]\n\
  fahh-agent models list [--provider P]     what your key can use right now\n\
  fahh-agent sessions ls [--cwd DIR]        saved sessions for the workspace\n\
no prompt: interactive (/help lists the slash commands). Keys come from GROQ_API_KEY, GEMINI_API_KEY,\n\
NVIDIA_API_KEY, OPENROUTER_API_KEY, ANTHROPIC_API_KEY.";

#[derive(Debug, PartialEq, Default)]
pub struct Cli {
    pub cwd: String,
    pub provider: String,
    pub model: Option<String>,
    pub mode: Mode,
    pub prompt: Option<String>,
    /// `-p`: run the prompt, print only the answer on stdout, exit.
    pub print: bool,
    pub continue_latest: bool,
    pub resume: Option<String>,
    pub prompt_file: Option<String>,
    pub config: Option<String>,
    pub export: Option<String>,
    pub fast_model: Option<String>,
    pub judge_model: Option<String>,
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
    let mut cli = Cli { cwd: ".".into(), provider: "groq".into(), ..Default::default() };
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
            "--mode" | "--permission-mode" => {
                let m = val(a)?;
                cli.mode = Mode::parse(&m).ok_or(format!("unknown mode `{m}` (normal, accept-edits, smart, plan, bypass)"))?;
            }
            "-p" | "--print" => {
                cli.prompt = Some(val("-p")?);
                cli.print = true;
            }
            "-c" | "--continue" => cli.continue_latest = true,
            "-r" | "--resume" => cli.resume = Some(val("--resume")?),
            "--prompt-file" => cli.prompt_file = Some(val("--prompt-file")?),
            "--config" => cli.config = Some(val("--config")?),
            "--export" => cli.export = Some(val("--export")?),
            "--fast-model" => cli.fast_model = Some(val("--fast-model")?),
            "--judge-model" => cli.judge_model = Some(val("--judge-model")?),
            "-h" | "--help" => return Err(String::new()),
            s if s.starts_with('-') && s.len() > 1 => return Err(format!("unknown option {s}")),
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

/// `--config FILE`: JSON with optional provider, model, mode, fast_model, judge_model.
/// Flags already given on the command line win.
pub fn apply_config(cli: &mut Cli, defaults: &Cli, text: &str) -> Result<(), String> {
    let v: serde_json::Value = serde_json::from_str(text).map_err(|e| format!("bad config: {e}"))?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
    if cli.provider == defaults.provider {
        if let Some(p) = s("provider") {
            if p != "mock" && preset(&p).is_none() {
                return Err(format!("config: unknown provider `{p}`"));
            }
            cli.provider = p;
        }
    }
    cli.model = cli.model.take().or_else(|| s("model"));
    cli.fast_model = cli.fast_model.take().or_else(|| s("fast_model"));
    cli.judge_model = cli.judge_model.take().or_else(|| s("judge_model"));
    if cli.mode == defaults.mode {
        if let Some(m) = s("mode") {
            cli.mode = Mode::parse(&m).ok_or(format!("config: unknown mode `{m}`"))?;
        }
    }
    Ok(())
}

fn http_config(cli: &Cli, get_env: &impl Fn(&str) -> Option<String>, model: Option<String>) -> Result<ProviderConfig, String> {
    let p = preset(&cli.provider).ok_or("unknown provider")?;
    let api_key = if p.key_env.is_empty() { None } else { get_env(p.key_env).filter(|k| !k.trim().is_empty()) };
    if !p.key_env.is_empty() && api_key.is_none() {
        return Err(format!("{} is not set (export it, or pick another --provider)", p.key_env));
    }
    let model = model
        .or_else(|| get_env("FAHH_AGENT_MODEL"))
        .ok_or(format!("no model: pass --model (see `fahh-agent models list --provider {}`)", cli.provider))?;
    Ok(ProviderConfig { kind: p.kind, base_url: p.base_url.into(), model, api_key })
}

fn mock_from(path: &str) -> Result<Provider, String> {
    let turns: Vec<ModelTurn> = serde_json::from_str(&std::fs::read_to_string(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(Provider::mock(turns))
}

/// `get_env` is injected so tests need no real environment.
pub fn build_provider(cli: &Cli, get_env: impl Fn(&str) -> Option<String>) -> Result<Provider, String> {
    if cli.provider == "mock" {
        // scripted turns for tests and demos: a JSON array of {text, calls}
        let path = get_env("FAHH_AGENT_MOCK_SCRIPT").ok_or("FAHH_AGENT_MOCK_SCRIPT is not set")?;
        return mock_from(&path);
    }
    Ok(Provider::Http(http_config(cli, &get_env, cli.model.clone())?))
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

fn answer(ev: &AgentEvent, tag: &str) -> Decision {
    let AgentEvent::ApprovalRequest { summary, command, old_text, new_text, tool, .. } = ev else { return Decision { allow: false, always: false, command: None } };
    eprintln!("\n? {tag}{summary}");
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

/// What a turn ended in, for the exit code, the plan hand-off and /copy.
#[derive(Default)]
struct Outcome {
    ok: bool,
    plan: Option<String>,
    text: String,
}

/// One line per event. Subagent events are indented and prefixed with the agent's name.
fn show(ev: &AgentEvent, indent: &str, tag: &str, quiet: bool, out: &mut Outcome) {
    // in -p mode only the answer goes to stdout; everything else to stderr
    macro_rules! line {
        ($($a:tt)*) => { if quiet { eprintln!($($a)*) } else { println!($($a)*) } };
    }
    match ev {
        AgentEvent::TextDelta { text, .. } => {
            if indent.is_empty() {
                out.text.push_str(text);
                print!("{text}");
                let _ = std::io::stdout().flush();
            } else {
                // a child's prose is its own business: the parent gets the summary
            }
        }
        AgentEvent::ToolCall { name, args, .. } => line!("\n{indent}  > {tag}{name} {}", one_line(&args.to_string(), 100)),
        AgentEvent::ToolResult { ok, output, .. } => line!("{indent}    {} {}", if *ok { "ok" } else { "failed:" }, if *ok { String::new() } else { one_line(output, 120) }),
        AgentEvent::FileChanged { path, .. } => line!("{indent}    changed {path}"),
        AgentEvent::PlanWritten { path, .. } => {
            line!("\n  plan written to {path}");
            out.plan = Some(path.clone());
        }
        AgentEvent::Judge { command, safe, reason, .. } => line!("{indent}  judge: {} {} ({})", if *safe { "SAFE" } else { "UNSAFE" }, one_line(command, 60), one_line(reason, 80)),
        AgentEvent::SubStarted { name, task, mode, .. } => line!("\n{indent}  [{name}] started ({}): {}", mode.label(), one_line(task, 80)),
        AgentEvent::SubDone { name, ok, steps, summary, .. } => line!("{indent}  [{name}] {} in {steps} step(s): {}", if *ok { "done" } else { "failed" }, one_line(summary, 100)),
        AgentEvent::Sub { name, event, .. } => show(event, &format!("{indent}    "), &format!("[{name}] "), quiet, out),
        AgentEvent::LoopRound { round, max, approved, notes, .. } => {
            line!("\n  loop round {round}/{max}: {}", if *approved { "reviewer approved".to_string() } else { format!("changes requested: {}", one_line(notes, 100)) })
        }
        AgentEvent::Notice { text, .. } => line!("\n  note: {text}"),
        AgentEvent::Compacted { before, after, .. } => line!("\n  compacted context: ~{before} -> ~{after} tokens"),
        AgentEvent::Done { steps, files, .. } => {
            line!("\n[done in {steps} step(s); changed: {}]", if files.is_empty() { "nothing".into() } else { files.join(", ") });
            out.ok = true;
        }
        AgentEvent::Error { message, .. } => eprintln!("\nerror: {message}"),
        AgentEvent::TurnStarted { .. } | AgentEvent::ApprovalRequest { .. } => {}
    }
}

fn approval(ev: &AgentEvent) -> Option<(&str, String)> {
    match ev {
        AgentEvent::ApprovalRequest { id, .. } => Some((id, String::new())),
        AgentEvent::Sub { name, event, .. } => approval(event).map(|(id, _)| (id, format!("[{name}] "))),
        _ => None,
    }
}

fn inner_request(ev: &AgentEvent) -> &AgentEvent {
    match ev {
        AgentEvent::Sub { event, .. } => inner_request(event),
        e => e,
    }
}

fn make_sink(s: Arc<Session>, out: Arc<Mutex<Outcome>>, quiet: bool) -> Sink {
    Arc::new(move |ev| {
        if let Some((id, tag)) = approval(&ev) {
            let d = answer(inner_request(&ev), &tag);
            s.resolve(id, d);
            return;
        }
        show(&ev, "", "", quiet, &mut out.lock().unwrap());
    })
}

// ─── the REPL ─────────────────────────────────────────────────────────────────

enum Flow {
    Continue,
    Exit,
}

struct Repl {
    cli: Cli,
    ws_root: PathBuf,
    session: Arc<Session>,
    provider: Arc<Provider>,
    judge: Option<Arc<Provider>>,
    fast: Option<Arc<Provider>>,
    using_fast: bool,
    mode: Mode,
    extra_dirs: Vec<PathBuf>,
    dir: PathBuf,
    last: String,
    code: i32,
}

fn model_of(p: &Provider) -> String {
    p.model_name().unwrap_or("(scripted)").to_string()
}

impl Repl {
    fn active(&self) -> Arc<Provider> {
        if self.using_fast { self.fast.clone().unwrap_or_else(|| self.provider.clone()) } else { self.provider.clone() }
    }

    fn new_session(&mut self) {
        let ws = Workspace::new(&self.cli.cwd).expect("workspace checked at startup");
        self.session = Arc::new(Session::new(store::new_id(), self.with_dirs(ws), Default::default()).persistent(self.dir.clone()));
    }

    fn with_dirs(&self, mut ws: Workspace) -> Workspace {
        ws.extra = self.extra_dirs.clone();
        ws
    }

    async fn run_once(&mut self, prompt: String, mode: Mode, run: RunSpec, provider: Option<Arc<Provider>>, quiet: bool) -> (bool, Option<String>) {
        let ws = self.with_dirs(self.session.ws());
        *self.session.ws.lock().unwrap() = ws;
        let out = Arc::new(Mutex::new(Outcome::default()));
        let sink = make_sink(self.session.clone(), out.clone(), quiet);
        let turn = self.session.next_turn.fetch_add(1, Ordering::Relaxed);
        let mut input = TurnInput::new(&prompt, mode);
        input.run = run;
        input.judge = self.judge.clone();
        input.limits = Limits::default();
        input.user_agents_dir = agents::user_dir();
        let p = provider.unwrap_or_else(|| self.active());
        run_turn(&self.session, p, input, turn, &sink).await;
        let o = out.lock().unwrap();
        if !o.text.is_empty() {
            self.last = o.text.clone();
        }
        (o.ok, o.plan.clone())
    }

    /// A normal prompt, then the plan hand-off in plan mode. Sets the exit code.
    async fn prompt(&mut self, text: String, mode: Mode, run: RunSpec, quiet: bool) {
        let (ok, plan) = self.run_once(text, mode, run, None, quiet).await;
        self.code = if ok { 0 } else { 1 };
        if let (true, Some(path)) = (ok, plan) {
            if matches!(prompt_user(&format!("Implement {path}? [y/N] > ")).as_deref(), Some("y" | "Y" | "yes")) {
                let (ok2, _) = self.run_once(format!("Implement the approved plan in {path}, step by step."), Mode::Ask, RunSpec::Turn, None, quiet).await;
                self.code = if ok2 { 0 } else { 1 };
            }
        }
    }

    fn set_mode(&mut self, m: Mode) {
        self.mode = m;
        println!("mode: {}", m.label());
        if m == Mode::Bypass {
            println!("WARNING: bypass auto-approves every prompt. Deny rules in .fahh/permissions.json and the built-in blocks still apply.");
        }
    }

    fn use_args_or_usage(&self, sl: &Slash, usage: &str) -> Option<String> {
        if sl.arg.is_empty() {
            println!("usage: {usage}");
            None
        } else {
            Some(sl.arg.clone())
        }
    }

    fn list_sessions(&self) -> Vec<store::SessionInfo> {
        let l = store::list(&self.dir);
        if l.is_empty() {
            println!("no saved sessions for this workspace yet");
        }
        for (i, s) in l.iter().enumerate() {
            let cur = if s.id == self.session.id { " (current)" } else { "" };
            println!("  {:>2}. {}  {} step(s)  {}{cur}", i + 1, s.id, s.steps, s.title);
        }
        l
    }

    fn load(&mut self, id: &str) {
        let ws = self.with_dirs(Workspace::new(&self.cli.cwd).expect("workspace"));
        match store::load(&self.dir, id) {
            Ok(f) => {
                let n = f.turns.len();
                self.session = Arc::new(Session::from_file(f, ws, Default::default(), Some(self.dir.clone())));
                println!("resumed {} ({} step(s)): {}", self.session.id, n, self.session.meta.lock().unwrap().title);
            }
            Err(e) => println!("{e}"),
        }
    }

    async fn slash(&mut self, sl: Slash) -> Flow {
        let arg = sl.arg.clone();
        match sl.name.as_str() {
            "exit" => return Flow::Exit,
            "help" => print!("{}", slash::help_text()),
            "shortcuts" => println!("Enter sends. Ctrl-D or /exit leaves. Ctrl-C stops a running turn. y/N/a/e answers an approval. /help lists commands."),
            "config" => println!(
                "provider: {}\nmodel: {}\nfast model: {}\nmode: {}\nworkspace: {}\nextra folders: {}\nsessions: {}",
                self.cli.provider,
                model_of(&self.provider),
                self.fast.as_ref().map(|p| model_of(p)).unwrap_or_else(|| "(none: --fast-model)".into()),
                self.mode.label(),
                self.ws_root.display(),
                if self.extra_dirs.is_empty() { "(none)".into() } else { self.extra_dirs.iter().map(|d| d.display().to_string()).collect::<Vec<_>>().join(", ") },
                self.dir.display()
            ),
            "model" => {
                if arg.is_empty() {
                    println!("model: {}{}", model_of(&self.active()), if self.using_fast { " (fast)" } else { "" });
                } else if let Some(p) = self.provider.with_model(&arg) {
                    self.provider = Arc::new(p);
                    self.using_fast = false;
                    println!("model: {arg}");
                } else {
                    println!("this provider cannot switch models");
                }
            }
            "mode" => match (arg.is_empty(), Mode::parse(&arg)) {
                (true, _) => println!("mode: {}", self.mode.label()),
                (false, Some(m)) => self.set_mode(m),
                _ => println!("unknown mode `{arg}` (normal, accept-edits, smart, plan, bypass)"),
            },
            "normal" => self.set_mode(Mode::Ask),
            "accept-edits" => self.set_mode(Mode::AutoEdit),
            "code" | "smart" | "plan" | "bypass" => {
                let m = Mode::parse(&sl.name).unwrap();
                self.set_mode(m);
                if !arg.is_empty() {
                    self.prompt(arg, m, RunSpec::Turn, false).await;
                }
            }
            "ask" => {
                if let Some(q) = self.use_args_or_usage(&sl, "/ask <question>") {
                    self.prompt(q, Mode::Qa, RunSpec::Turn, false).await;
                }
            }
            "fast" => match self.fast.clone() {
                None => println!("no fast model configured: pass --fast-model (or set it in --config)"),
                Some(f) if arg.is_empty() => {
                    self.using_fast = !self.using_fast;
                    println!("model: {}{}", model_of(&f), if self.using_fast { " (fast)" } else { " (back to the main model)" });
                }
                Some(f) => {
                    let (ok, _) = self.run_once(arg, self.mode, RunSpec::Turn, Some(f), false).await;
                    self.code = if ok { 0 } else { 1 };
                }
            },
            "loop" => {
                if let Some(p) = self.use_args_or_usage(&sl, "/loop <prompt>") {
                    self.prompt(p, self.mode, RunSpec::Loop { max_rounds: None }, false).await;
                }
            }
            "btw" => {
                if let Some(p) = self.use_args_or_usage(&sl, "/btw <prompt>") {
                    self.run_once(p, self.mode, RunSpec::Btw, None, false).await;
                }
            }
            "compact" => match self.session.compact(&self.active()).await {
                Ok((n, before, after)) => println!("compacted {n} messages: ~{before} -> ~{after} tokens"),
                Err(e) => println!("{e}"),
            },
            "context" => {
                let h = self.session.history.lock().unwrap().clone();
                let c = context::context_info(&h, 1_500, &model_of(&self.active()));
                println!("context: ~{} of ~{} tokens ({}%), {} messages (estimated; the window size is a guess by model name)", c.used, c.window, c.percent, c.messages);
            }
            "usage" => {
                let u = self.session.meta.lock().unwrap().usage.clone();
                println!("model calls: {}\ntool calls: {}\ntokens in: ~{}\ntokens out: ~{} (estimated)", u.model_calls, u.tool_calls, u.tokens_in, u.tokens_out);
            }
            "clear" => {
                self.new_session();
                println!("new session {}", self.session.id);
            }
            "ls" => {
                self.list_sessions();
            }
            "continue" | "resume" => {
                let id = if !arg.is_empty() {
                    Some(arg)
                } else if sl.name == "continue" {
                    store::latest(&self.dir)
                } else {
                    let l = self.list_sessions();
                    prompt_user("pick a number > ").and_then(|n| n.parse::<usize>().ok()).and_then(|n| l.get(n.wrapping_sub(1)).map(|s| s.id.clone()))
                };
                match id {
                    Some(id) => self.load(&id),
                    None => println!("nothing to resume"),
                }
            }
            "title" => {
                if let Some(t) = self.use_args_or_usage(&sl, "/title <title>") {
                    self.session.meta.lock().unwrap().title = t.chars().take(80).collect();
                    self.session.save();
                    println!("renamed");
                }
            }
            "rm-session" => {
                if let Some(id) = self.use_args_or_usage(&sl, "/rm-session <id>") {
                    match store::remove(&self.dir, &id) {
                        Ok(()) => println!("removed {id}"),
                        Err(e) => println!("{e}"),
                    }
                }
            }
            "steps" => {
                let m = self.session.meta.lock().unwrap();
                if m.turns.is_empty() {
                    println!("no steps yet");
                }
                for t in &m.turns {
                    println!("  {}. [{}] {}", t.id, t.mode.label(), one_line(&t.prompt, 90));
                }
            }
            "fork" => {
                let step = if arg.is_empty() { None } else { arg.parse::<u32>().ok() };
                if !arg.is_empty() && step.is_none() {
                    println!("usage: /fork [step]");
                } else {
                    match self.session.fork(store::new_id(), step) {
                        Ok(f) => {
                            let _ = store::save(&self.dir, &f);
                            let ws = self.with_dirs(Workspace::new(&self.cli.cwd).expect("workspace"));
                            self.session = Arc::new(Session::from_file(f, ws, Default::default(), Some(self.dir.clone())));
                            println!("forked into {}", self.session.id);
                        }
                        Err(e) => println!("{e}"),
                    }
                }
            }
            "revert" => match arg.parse::<u32>() {
                Ok(n) => match self.session.revert_step(n) {
                    Ok((files, rewound)) => println!("reverted {} file(s){}{}", files.len(), if files.is_empty() { "" } else { ": " }, files.join(", ") + if rewound { "; conversation rewound" } else { "; the conversation could not be rewound (folded by /compact)" }),
                    Err(e) => println!("{e}"),
                },
                Err(_) => println!("usage: /revert <step>   (/steps lists them)"),
            },
            "export" => {
                let md = context::export_markdown(&self.session.snapshot());
                if arg.is_empty() {
                    println!("{md}");
                } else {
                    match self.session.ws().resolve(&arg, true) {
                        Ok((abs, rel)) => match std::fs::write(&abs, md) {
                            Ok(()) => println!("wrote {rel}"),
                            Err(e) => println!("{e}"),
                        },
                        Err(e) => println!("{e}"),
                    }
                }
            }
            "copy" => println!("(no clipboard in a terminal; the last reply was:)\n{}", self.last),
            "workspace" => {
                println!("{}", self.ws_root.display());
                self.extra_dirs.iter().for_each(|d| println!("+ {}", d.display()));
            }
            "add-dir" => {
                if let Some(p) = self.use_args_or_usage(&sl, "/add-dir <path>") {
                    match std::fs::canonicalize(&p).ok().filter(|c| c.is_dir()) {
                        Some(c) if !self.extra_dirs.contains(&c) && c != self.ws_root => {
                            self.extra_dirs.push(c.clone());
                            println!("added {}", c.display());
                        }
                        Some(_) => println!("already included"),
                        None => println!("not a folder: {p}"),
                    }
                }
            }
            "remove-dir" => {
                if let Some(p) = self.use_args_or_usage(&sl, "/remove-dir <path>") {
                    let c = std::fs::canonicalize(&p).unwrap_or_else(|_| PathBuf::from(&p));
                    let before = self.extra_dirs.len();
                    self.extra_dirs.retain(|d| *d != c);
                    println!("{}", if self.extra_dirs.len() < before { "removed" } else { "that folder was not added" });
                }
            }
            "agents" => {
                let r = super::agents_report(&self.ws_root, agents::user_dir().as_deref());
                for a in &r.agents {
                    println!("  {:<10} [{}] {} ({}, max {} steps{})", a.name, a.source, a.description, a.mode.label(), a.max_steps, a.model.as_ref().map(|m| format!(", model {m}")).unwrap_or_default());
                }
                for p in &r.problems {
                    println!("  skipped: {p}");
                }
            }
            "agent" => match arg.split_once(char::is_whitespace) {
                Some((name, task)) if !task.trim().is_empty() => {
                    let (ok, _) = self.run_once(task.trim().to_string(), self.mode, RunSpec::Agent { name: name.to_string() }, None, false).await;
                    self.code = if ok { 0 } else { 1 };
                }
                _ => println!("usage: /agent <name> <task>   (/agents lists them)"),
            },
            other => println!("/{other} is not available in the terminal"),
        }
        Flow::Continue
    }
}

// ─── entry points ─────────────────────────────────────────────────────────────

fn fail(msg: &str) -> i32 {
    eprintln!("fahh-agent: {msg}");
    1
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

fn sessions_ls(args: &[String]) -> i32 {
    let cli = match parse_args(args) {
        Ok(c) => c,
        Err(e) => return fail(&e),
    };
    let ws = match Workspace::new(&cli.cwd) {
        Ok(w) => w,
        Err(e) => return fail(&e),
    };
    let l = store::list(&store::sessions_dir(&store::data_dir(), &ws.root));
    if l.is_empty() {
        println!("no saved sessions for {}", ws.root.display());
    }
    for s in l {
        println!("{}  {} step(s)  {}", s.id, s.steps, s.title);
    }
    0
}

/// Run the CLI; returns the process exit code.
pub async fn main_cli(args: Vec<String>, provider_override: Option<Provider>) -> i32 {
    match (args.first().map(String::as_str), args.get(1).map(String::as_str)) {
        (Some("models"), Some("list")) => return models_list(&args[2..]).await,
        (Some("models"), _) => return fail("usage: fahh-agent models list [--provider P]"),
        (Some("sessions"), Some("ls")) => return sessions_ls(&args[2..]),
        (Some("sessions"), _) => return fail("usage: fahh-agent sessions ls [--cwd DIR]"),
        _ => {}
    }
    let mut cli = match parse_args(&args) {
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
    if let Some(path) = cli.config.clone() {
        let defaults = parse_args(&[]).unwrap();
        if let Err(e) = std::fs::read_to_string(&path).map_err(|e| e.to_string()).and_then(|t| apply_config(&mut cli, &defaults, &t)) {
            return fail(&e);
        }
    }
    if let Some(f) = cli.prompt_file.clone() {
        match std::fs::read_to_string(&f) {
            Ok(t) => cli.prompt = Some(t.trim().to_string()).filter(|t| !t.is_empty()),
            Err(e) => return fail(&format!("--prompt-file: {e}")),
        }
    }
    let ws = match Workspace::new(&cli.cwd) {
        Ok(w) => w,
        Err(e) => return fail(&e),
    };
    let env = |k: &str| std::env::var(k).ok();
    let provider = match provider_override.map(Ok).unwrap_or_else(|| build_provider(&cli, env)) {
        Ok(p) => Arc::new(p),
        Err(e) => return fail(&e),
    };
    // the fast model (also the Smart-mode judge unless --judge-model says otherwise)
    let derive = |model: &Option<String>| -> Option<Arc<Provider>> {
        match model {
            Some(m) => provider.with_model(m).map(Arc::new),
            None => None,
        }
    };
    let mut fast = derive(&cli.fast_model).or_else(|| derive(&env("FAHH_AGENT_FAST_MODEL")));
    let mut judge = derive(&cli.judge_model).or_else(|| fast.clone());
    if cli.provider == "mock" {
        if let Some(p) = env("FAHH_AGENT_MOCK_JUDGE") {
            judge = mock_from(&p).ok().map(Arc::new);
        }
    }

    let dir = store::sessions_dir(&store::data_dir(), &ws.root);
    let session = if cli.continue_latest || cli.resume.is_some() {
        let id = match cli.resume.clone().or_else(|| store::latest(&dir)) {
            Some(i) => i,
            None => return fail("no saved session to continue in this workspace"),
        };
        match store::load(&dir, &id) {
            Ok(f) => Arc::new(Session::from_file(f, ws.clone(), Default::default(), Some(dir.clone()))),
            Err(e) => return fail(&e),
        }
    } else {
        Arc::new(Session::new(store::new_id(), ws.clone(), Default::default()).persistent(dir.clone()))
    };
    let mut repl = Repl { mode: cli.mode, ws_root: ws.root.clone(), session, provider, judge, fast, using_fast: false, extra_dirs: vec![], dir, last: String::new(), code: 0, cli };
    if repl.mode == Mode::Bypass {
        repl.set_mode(Mode::Bypass);
    }

    if let Some(p) = repl.cli.prompt.clone() {
        // one shot: a slash command is run as a command, anything else as a prompt
        let quiet = repl.cli.print;
        match slash::parse(&p) {
            Some(Ok(sl)) => {
                repl.slash(sl).await;
            }
            Some(Err(e)) => return fail(&e),
            None => repl.prompt(p, repl.mode, RunSpec::Turn, quiet).await,
        }
    } else {
        while let Some(line) = prompt_user("\nfahh> ") {
            if matches!(line.as_str(), "" | "exit" | "quit") {
                break;
            }
            match slash::parse(&line) {
                Some(Ok(sl)) => {
                    if matches!(repl.slash(sl).await, Flow::Exit) {
                        break;
                    }
                }
                Some(Err(e)) => println!("{e}"),
                None => repl.prompt(line, repl.mode, RunSpec::Turn, false).await,
            }
        }
    }
    if let Some(path) = repl.cli.export.clone() {
        let md = context::export_markdown(&repl.session.snapshot());
        if path == "-" {
            println!("{md}");
        } else if let Err(e) = std::fs::write(&path, md) {
            return fail(&format!("--export: {e}"));
        }
    }
    repl.code
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
        assert_eq!((c.cwd.as_str(), c.provider.as_str(), c.model.as_deref(), c.mode, c.prompt.as_deref()), ("/x", "gemini", Some("m"), Mode::Plan, Some("fix the bug")));
        let d = parse_args(&[]).unwrap();
        assert_eq!((d.provider.as_str(), d.mode, d.prompt, d.print), ("groq", Mode::Ask, None, false));
    }

    #[test]
    fn permission_mode_names_and_aliases() {
        for (name, mode) in [("normal", Mode::Ask), ("accept-edits", Mode::AutoEdit), ("smart", Mode::Smart), ("bypass", Mode::Bypass), ("plan", Mode::Plan)] {
            assert_eq!(parse_args(&a(&["--permission-mode", name])).unwrap().mode, mode, "{name}");
        }
        assert_eq!(parse_args(&a(&["--permission-mode", "yolo"])).unwrap().mode, Mode::Bypass);
    }

    #[test]
    fn session_and_prompt_flags() {
        let c = parse_args(&a(&["-c", "-p", "do it", "--export", "out.md", "--prompt-file", "p.txt", "--fast-model", "f", "--judge-model", "j", "--config", "c.json"])).unwrap();
        assert!(c.continue_latest && c.print);
        assert_eq!((c.prompt.as_deref(), c.export.as_deref(), c.prompt_file.as_deref(), c.fast_model.as_deref(), c.judge_model.as_deref(), c.config.as_deref()), (Some("do it"), Some("out.md"), Some("p.txt"), Some("f"), Some("j"), Some("c.json")));
        assert_eq!(parse_args(&a(&["-r", "s1"])).unwrap().resume.as_deref(), Some("s1"));
        assert_eq!(parse_args(&a(&["--resume", "s2"])).unwrap().resume.as_deref(), Some("s2"));
        assert_eq!(parse_args(&a(&["--print", "x"])).unwrap().prompt.as_deref(), Some("x"));
    }

    #[test]
    fn rejects_bad_input() {
        assert!(parse_args(&a(&["--mode", "yolo2"])).is_err());
        assert!(parse_args(&a(&["--provider", "nope"])).is_err());
        assert!(parse_args(&a(&["--model"])).is_err());
        assert!(parse_args(&a(&["-p"])).is_err());
        assert!(parse_args(&a(&["--wat"])).is_err());
        assert_eq!(parse_args(&a(&["--help"])), Err(String::new()));
    }

    #[test]
    fn config_file_fills_gaps_but_flags_win() {
        let defaults = parse_args(&[]).unwrap();
        let mut c = parse_args(&a(&["--model", "from-flag"])).unwrap();
        apply_config(&mut c, &defaults, r#"{"provider":"ollama","model":"from-config","mode":"smart","fast_model":"quick"}"#).unwrap();
        assert_eq!((c.provider.as_str(), c.model.as_deref(), c.mode, c.fast_model.as_deref()), ("ollama", Some("from-flag"), Mode::Smart, Some("quick")));
        let mut c = parse_args(&a(&["--mode", "plan"])).unwrap();
        apply_config(&mut c, &defaults, r#"{"mode":"bypass"}"#).unwrap();
        assert_eq!(c.mode, Mode::Plan);
        assert!(apply_config(&mut c, &defaults, "{nope").is_err());
        assert!(apply_config(&mut c, &defaults, r#"{"provider":"zzz"}"#).is_err());
    }

    #[test]
    fn provider_keys_come_from_the_environment_only() {
        let cli = parse_args(&a(&["--provider", "groq", "hi"])).unwrap();
        assert!(build_provider(&cli, |_| None).unwrap_err().contains("GROQ_API_KEY"));
        let env = |k: &str| (k == "GROQ_API_KEY").then(|| "sk-test".to_string());
        // no hardcoded default model: it must be named
        assert!(build_provider(&cli, env).unwrap_err().contains("no model"));
        let cli = parse_args(&a(&["--provider", "groq", "--model", "m1", "hi"])).unwrap();
        match build_provider(&cli, env).unwrap() {
            Provider::Http(c) => {
                assert_eq!(c.model, "m1");
                assert!(!format!("{c:?}").contains("sk-test"));
            }
            _ => panic!("expected http provider"),
        }
        let ollama = parse_args(&a(&["--provider", "ollama"])).unwrap();
        assert!(build_provider(&ollama, |k| (k == "FAHH_AGENT_MODEL").then(|| "x".to_string())).is_ok()); // no key needed
    }

    #[test]
    fn child_events_are_indented_and_prefixed() {
        let mut out = Outcome::default();
        let inner = AgentEvent::TextDelta { turn: 1, text: "hidden child prose".into() };
        show(&AgentEvent::Sub { turn: 1, child: "c1".into(), name: "explore".into(), event: Box::new(inner) }, "", "", true, &mut out);
        assert!(out.text.is_empty()); // a child's prose does not become the parent's answer
        let ap = AgentEvent::Sub {
            turn: 1,
            child: "c1".into(),
            name: "explore".into(),
            event: Box::new(AgentEvent::ApprovalRequest { turn: 1, id: "appr-3".into(), tool: "run_command".into(), kind: super::super::perm::Kind::Run, summary: "s".into(), command: None, path: None, old_text: None, new_text: None }),
        };
        let (id, tag) = approval(&ap).unwrap();
        assert_eq!((id, tag.as_str()), ("appr-3", "[explore] "));
    }
}
