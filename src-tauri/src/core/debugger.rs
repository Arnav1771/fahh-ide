use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Mutex,
};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tracing::{debug, error, info, warn};

// ---------------------------------------------------------------------------
// Session ID generator
// ---------------------------------------------------------------------------

static NEXT_SESSION_ID: AtomicU32 = AtomicU32::new(1);

fn next_session_id() -> u32 {
    NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed)
}

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

/// Identifies which debug adapter to use.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AdapterKind {
    Python,
    Node,
    Go,
    Lldb,
}

/// User-facing configuration for starting a debug session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DapConfig {
    pub adapter: String,
    pub program: String,
    /// Optional: the frontend typically sends only adapter/program/stop_on_entry.
    #[serde(default)]
    pub args: Vec<String>,
    /// Working directory. If empty, falls back to the program's parent dir.
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub stop_on_entry: bool,
}

impl DapConfig {
    /// Resolve the working directory, falling back to the program's parent
    /// directory (or the current dir) when the frontend omits `cwd`.
    fn working_dir(&self) -> std::path::PathBuf {
        if !self.cwd.trim().is_empty() {
            return std::path::PathBuf::from(&self.cwd);
        }
        std::path::Path::new(&self.program)
            .parent()
            .map(|p| p.to_path_buf())
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| std::path::PathBuf::from("."))
    }
}

/// Internal representation of an active DAP session.
pub struct DapSession {
    pub id: u32,
    pub adapter: String,
    pub process: Option<Child>,
    pub stream: Option<TcpStream>,
    /// Monotonically increasing request sequence counter.
    pub seq: u32,
}

impl DapSession {
    /// Send a DAP request over the TCP socket.
    fn send_request(&mut self, command: &str, arguments: serde_json::Value) -> Result<(), String> {
        self.seq += 1;
        let msg = serde_json::json!({
            "seq": self.seq,
            "type": "request",
            "command": command,
            "arguments": arguments,
        });
        let body = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        let header = format!("Content-Length: {}\r\n\r\n", body.len());

        let stream = self
            .stream
            .as_mut()
            .ok_or_else(|| format!("Session {} has no active stream", self.id))?;

        stream
            .write_all(header.as_bytes())
            .and_then(|_| stream.write_all(body.as_bytes()))
            .and_then(|_| stream.flush())
            .map_err(|e| format!("DAP write error: {e}"))?;

        debug!("DAP[{}] → adapter: {command}", self.id);
        Ok(())
    }
}

/// Global registry of active debug sessions.
#[derive(Default)]
pub struct DebuggerState {
    pub sessions: Mutex<HashMap<u32, DapSession>>,
}

lazy_static::lazy_static! {
    pub static ref DEBUGGER_STATE: DebuggerState = DebuggerState::default();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Wait up to `timeout_ms` for a TCP port to be open.
/// A port nothing is listening on. Adapters used to get fixed ports (debugpy
/// 5678, node 9229, dlv 2345, lldb-dap 4711), and 5678 is also n8n's default:
/// with n8n running, `debug_start` connected to n8n's web server and reported
/// a debug session that did not exist.
fn free_port() -> Result<u16, String> {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .map_err(|e| format!("Could not find a free port for the debug adapter: {e}"))
}

/// What to tell the user when an adapter exits before it is ready.
fn install_hint(adapter: &str) -> &'static str {
    match adapter {
        "python" | "debugpy" => "Is debugpy installed? Install it with: python3 -m pip install debugpy",
        "node" | "js-debug" => "Is Node.js installed and on PATH?",
        "go" | "dlv-dap" | "delve" => "Is Delve installed? Install it with: go install github.com/go-delve/delve/cmd/dlv@latest",
        _ => "Is lldb-dap installed and on PATH?",
    }
}

/// Wait until the adapter listens on `port`, or fail as soon as it exits.
/// On failure the adapter process is killed, so nothing is left running.
fn wait_for_adapter(child: &mut Option<Child>, adapter: &str, port: u16, timeout_ms: u64) -> Result<(), String> {
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
    let addr: std::net::SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .map_err(|e| format!("Bad debug adapter address: {e}"))?;
    while std::time::Instant::now() < deadline {
        if let Some(c) = child.as_mut() {
            if let Ok(Some(status)) = c.try_wait() {
                return Err(format!(
                    "The {adapter} debug adapter exited before it was ready ({status}). {}",
                    install_hint(adapter)
                ));
            }
        }
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    if let Some(c) = child.as_mut() {
        let _ = c.kill();
        let _ = c.wait();
    }
    Err(format!(
        "The {adapter} debug adapter did not open port {port} within {} seconds. {}",
        timeout_ms / 1000,
        install_hint(adapter)
    ))
}

/// Spawn a reader thread that forwards DAP messages from the adapter to the
/// frontend via the `dap://event` Tauri event.
fn spawn_dap_reader(session_id: u32, stream: TcpStream, app: AppHandle) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        loop {
            // Read headers.
            let mut content_length: Option<usize> = None;
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => {
                        info!("DAP reader[{session_id}]: stream closed");
                        return;
                    }
                    Ok(_) => {}
                }
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    break;
                }
                if let Some(rest) = trimmed.strip_prefix("Content-Length:") {
                    content_length = rest.trim().parse().ok();
                }
            }

            let length = match content_length {
                Some(l) => l,
                None => {
                    warn!("DAP reader[{session_id}]: missing Content-Length, skipping");
                    continue;
                }
            };

            let mut body = vec![0u8; length];
            if let Err(e) = std::io::Read::read_exact(&mut reader, &mut body) {
                error!("DAP reader[{session_id}]: read error: {e}");
                return;
            }

            let json_str = String::from_utf8_lossy(&body).to_string();
            debug!("DAP[{session_id}] ← adapter: {}", &json_str[..json_str.len().min(300)]);

            let _ = app.emit(
                "dap://event",
                serde_json::json!({ "session_id": session_id, "message": json_str }),
            );
        }
    });
}

/// DAP `initialize` handshake sent after connecting.
fn dap_initialize(session: &mut DapSession) -> Result<(), String> {
    session.send_request(
        "initialize",
        serde_json::json!({
            "clientID": "fahh-editor",
            "clientName": "Fahh Editor",
            "adapterID": session.adapter,
            "linesStartAt1": true,
            "columnsStartAt1": true,
            "pathFormat": "path",
            "supportsVariableType": true,
            "supportsVariablePaging": false,
            "supportsRunInTerminalRequest": false,
            "supportsMemoryReferences": false,
        }),
    )
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Start a debug session. Returns the session ID.
#[tauri::command]
pub async fn debug_start(app: AppHandle, config: DapConfig) -> Result<u32, String> {
    let session_id = next_session_id();
    info!(
        "debug_start: session={session_id}, adapter={}, program={}",
        config.adapter, config.program
    );

    let port = free_port()?;
    let (mut child, port): (Option<Child>, u16) = match config.adapter.as_str() {
        "python" | "debugpy" => {
            // debugpy: python -m debugpy --listen 5678 --wait-for-client <file>
            let mut cmd_args = vec![
                "-m".to_string(),
                "debugpy".to_string(),
                "--listen".to_string(),
                format!("127.0.0.1:{port}"),
                "--wait-for-client".to_string(),
            ];
            if config.stop_on_entry {
                cmd_args.push("--configure-subProcess".to_string());
                cmd_args.push("True".to_string());
            }
            cmd_args.push(config.program.clone());
            cmd_args.extend(config.args.clone());

            let python = if which::which("python3").is_ok() { "python3" } else { "python" };
            let child = Command::new(python)
                .args(&cmd_args)
                .current_dir(config.working_dir())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Failed to spawn debugpy: {e}"))?;

            (Some(child), port)
        }
        "node" | "js-debug" => {
            // Node.js --inspect-brk opens a V8 inspector on port 9229.
            // We connect via raw TCP and translate CDP ↔ DAP in the reader thread.
            let mut cmd_args = vec![format!("--inspect-brk=127.0.0.1:{port}"), config.program.clone()];
            cmd_args.extend(config.args.clone());

            let child = Command::new("node")
                .args(&cmd_args)
                .current_dir(config.working_dir())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Failed to spawn node: {e}"))?;

            (Some(child), port)
        }
        "go" | "dlv-dap" | "delve" => {
            // Delve debug adapter — dlv dap --listen :2345
            let child = Command::new("dlv")
                .args([
                    "dap",
                    &format!("--listen=127.0.0.1:{port}"),
                    "--headless",
                    "exec",
                    &config.program,
                ])
                .args(if !config.args.is_empty() {
                    std::iter::once("--".to_string())
                        .chain(config.args.clone())
                        .collect::<Vec<_>>()
                } else {
                    vec![]
                })
                .current_dir(config.working_dir())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Failed to spawn dlv: {e}"))?;

            (Some(child), port)
        }
        "lldb" | "codelldb" | "lldb-dap" => {
            // lldb-dap (formerly lldb-vscode) listens on a port when passed --port.
            let child = Command::new("lldb-dap")
                .args(["--port", &port.to_string()])
                .current_dir(config.working_dir())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Failed to spawn lldb-dap: {e}"))?;

            (Some(child), port)
        }
        other => {
            return Err(format!("Unsupported debug adapter: {other}"));
        }
    };

    // Wait for the adapter to open its port (up to 10 seconds), failing fast
    // if it exits first (e.g. `python3 -m debugpy` without debugpy installed).
    wait_for_adapter(&mut child, &config.adapter, port, 10_000)?;

    let stream = TcpStream::connect(format!("127.0.0.1:{port}"))
        .map_err(|e| format!("Failed to connect to debug adapter on port {port}: {e}"))?;

    // Clone the stream for the reader thread.
    let reader_stream = stream
        .try_clone()
        .map_err(|e| format!("Failed to clone TCP stream: {e}"))?;

    let mut session = DapSession {
        id: session_id,
        adapter: config.adapter.clone(),
        process: child,
        stream: Some(stream),
        seq: 0,
    };

    // Send initialize handshake immediately.
    dap_initialize(&mut session)?;

    // Send `launch` request.
    session.send_request(
        "launch",
        serde_json::json!({
            "program": config.program,
            "args": config.args,
            "cwd": config.cwd,
            "stopOnEntry": config.stop_on_entry,
            "noDebug": false,
        }),
    )?;

    // Spawn the reader thread before storing the session.
    spawn_dap_reader(session_id, reader_stream, app);

    DEBUGGER_STATE
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(session_id, session);

    info!("debug_start: session {session_id} active");
    Ok(session_id)
}

/// Send a DAP `continue` request.
#[tauri::command]
pub async fn debug_continue(session_id: u32) -> Result<(), String> {
    let mut sessions = DEBUGGER_STATE.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("No debug session with id {session_id}"))?;
    session.send_request("continue", serde_json::json!({ "threadId": 1 }))
}

/// Send a DAP `next` (step over) request.
#[tauri::command]
pub async fn debug_step_over(session_id: u32) -> Result<(), String> {
    let mut sessions = DEBUGGER_STATE.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("No debug session with id {session_id}"))?;
    session.send_request(
        "next",
        serde_json::json!({ "threadId": 1, "granularity": "statement" }),
    )
}

/// Send a DAP `stepIn` request.
#[tauri::command]
pub async fn debug_step_in(session_id: u32) -> Result<(), String> {
    let mut sessions = DEBUGGER_STATE.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("No debug session with id {session_id}"))?;
    session.send_request(
        "stepIn",
        serde_json::json!({ "threadId": 1, "granularity": "statement" }),
    )
}

/// Terminate a debug session.
#[tauri::command]
pub async fn debug_stop(session_id: u32) -> Result<(), String> {
    let mut sessions = DEBUGGER_STATE.sessions.lock().map_err(|e| e.to_string())?;
    let mut session = sessions
        .remove(&session_id)
        .ok_or_else(|| format!("No debug session with id {session_id}"))?;

    // Best-effort disconnect request.
    let _ = session.send_request(
        "disconnect",
        serde_json::json!({ "restart": false, "terminateDebuggee": true }),
    );

    // Close the TCP stream.
    drop(session.stream.take());

    // Kill the adapter process.
    if let Some(mut child) = session.process.take() {
        if let Err(e) = child.kill() {
            warn!("debug_stop: kill() error for session {session_id}: {e}");
        }
        let _ = child.wait();
    }

    info!("debug_stop: session {session_id} terminated");
    Ok(())
}

/// Set breakpoints for a file. Replaces any existing breakpoints for that file.
#[tauri::command]
pub async fn debug_set_breakpoints(
    session_id: u32,
    file: String,
    lines: Vec<u32>,
) -> Result<(), String> {
    let mut sessions = DEBUGGER_STATE.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("No debug session with id {session_id}"))?;

    let breakpoints: Vec<serde_json::Value> = lines
        .iter()
        .map(|&line| serde_json::json!({ "line": line }))
        .collect();

    session.send_request(
        "setBreakpoints",
        serde_json::json!({
            "source": { "path": file },
            "breakpoints": breakpoints,
            "lines": lines,
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_port_is_actually_free() {
        let port = free_port().unwrap();
        assert!(port > 0);
        // Nothing is listening there, so we can take it ourselves.
        assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_ok());
    }

    #[test]
    fn an_adapter_that_exits_early_is_an_error_with_a_hint() {
        let mut child = Some(Command::new("sh").args(["-c", "exit 1"]).spawn().unwrap());
        let port = free_port().unwrap();
        let t0 = std::time::Instant::now();
        let err = wait_for_adapter(&mut child, "debugpy", port, 10_000).unwrap_err();
        assert!(t0.elapsed() < Duration::from_secs(5), "fails fast instead of waiting 10 s");
        assert!(err.contains("exited before it was ready"), "{err}");
        assert!(err.contains("pip install debugpy"), "{err}");
    }

    #[test]
    fn a_listening_adapter_is_ready() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let mut child = Some(Command::new("sleep").arg("5").spawn().unwrap());
        assert!(wait_for_adapter(&mut child, "debugpy", port, 3_000).is_ok());
        let _ = child.as_mut().unwrap().kill();
    }

    #[test]
    fn a_silent_adapter_times_out_and_is_killed() {
        let mut child = Some(Command::new("sleep").arg("30").spawn().unwrap());
        let port = free_port().unwrap();
        let err = wait_for_adapter(&mut child, "lldb-dap", port, 600).unwrap_err();
        assert!(err.contains("did not open port"), "{err}");
        assert!(child.as_mut().unwrap().try_wait().unwrap().is_some(), "the adapter was killed");
    }

    #[test]
    fn dap_config_deserializes_frontend_payload() {
        // DebugPanel sends only { adapter, language, program, stop_on_entry }.
        let cfg: DapConfig = serde_json::from_str(
            r#"{"adapter":"debugpy","language":"python","program":"/tmp/x.py","stop_on_entry":true}"#,
        )
        .unwrap();
        assert_eq!(cfg.adapter, "debugpy");
        assert_eq!(cfg.program, "/tmp/x.py");
        assert!(cfg.args.is_empty());
        assert_eq!(cfg.cwd, "");
        assert!(cfg.stop_on_entry);
    }

    #[test]
    fn working_dir_falls_back_to_program_parent() {
        let cfg: DapConfig = serde_json::from_str(
            r#"{"adapter":"js-debug","language":"javascript","program":"/home/u/app/main.js"}"#,
        )
        .unwrap();
        assert_eq!(cfg.working_dir(), std::path::PathBuf::from("/home/u/app"));
    }

    #[test]
    fn working_dir_uses_explicit_cwd() {
        let cfg: DapConfig = serde_json::from_str(
            r#"{"adapter":"dlv-dap","program":"/a/b.go","cwd":"/work"}"#,
        )
        .unwrap();
        assert_eq!(cfg.working_dir(), std::path::PathBuf::from("/work"));
    }
}
