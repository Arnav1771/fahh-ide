//! Debug Adapter Protocol transport.
//!
//! Rust only starts the adapter (debugpy, Delve, lldb-dap) as a DAP server on a
//! free port, connects to it, and moves raw DAP messages both ways:
//! `debug_request` writes one request, and every message the adapter sends is
//! emitted to the frontend as `dap://event` `{ session_id, message }`.
//! The protocol itself (initialize, launch, breakpoints, stack, variables)
//! lives in `src/lib/dap.ts`, where it is unit-tested.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::process::{Child, Stdio};
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Mutex,
};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tracing::{debug, error, info, warn};

static NEXT_SESSION_ID: AtomicU32 = AtomicU32::new(1);

fn next_session_id() -> u32 {
    NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed)
}

/// What the frontend sends to start an adapter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DapConfig {
    /// debugpy / python, go / dlv-dap / delve, lldb / codelldb / lldb-dap.
    pub adapter: String,
    /// The file or binary being debugged; only used to pick the working directory.
    #[serde(default)]
    pub program: String,
    /// Working directory. If empty, falls back to the program's parent dir.
    #[serde(default)]
    pub cwd: String,
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

/// An active DAP session.
pub struct DapSession {
    pub id: u32,
    pub process: Option<Child>,
    pub stream: Option<TcpStream>,
    /// Monotonically increasing request sequence counter.
    pub seq: u32,
}

impl DapSession {
    /// Send a DAP request over the socket. Returns its `seq`, which the response's
    /// `request_seq` echoes.
    fn send_request(&mut self, command: &str, arguments: serde_json::Value) -> Result<u32, String> {
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
        Ok(self.seq)
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
        "python" | "debugpy" => "Is debugpy installed? Install it with: python -m pip install debugpy",
        "go" | "dlv-dap" | "delve" => "Is Delve installed? Install it with: go install github.com/go-delve/delve/cmd/dlv@latest",
        _ => "Is lldb-dap (LLVM 18 or newer) installed and on PATH?",
    }
}

/// The program and arguments that start `adapter` as a DAP server on `port`.
fn adapter_command(adapter: &str, port: u16) -> Result<(String, Vec<String>), String> {
    let addr = format!("127.0.0.1:{port}");
    match adapter {
        "python" | "debugpy" => {
            // The runner's pick: never the Microsoft Store alias in WindowsApps, which does not run Python.
            Ok((
                crate::core::runner::resolve_python(),
                vec!["-m".into(), "debugpy.adapter".into(), "--host".into(), "127.0.0.1".into(), "--port".into(), port.to_string()],
            ))
        }
        "go" | "dlv-dap" | "delve" => Ok(("dlv".into(), vec!["dap".into(), format!("--listen={addr}")])),
        "lldb" | "codelldb" | "lldb-dap" => Ok(("lldb-dap".into(), vec!["--connection".into(), format!("listen://{addr}")])),
        "node" | "js-debug" | "pwa-node" => Err(
            "JavaScript and TypeScript debugging needs Microsoft's js-debug adapter, which Fahh does not ship yet. \
             Use Run Active File (Ctrl+F5) for now."
                .into(),
        ),
        other => Err(format!("Unsupported debug adapter: {other}")),
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

/// Emitted when the adapter's socket closes, so the UI ends the session even if the
/// adapter died without saying `terminated`.
const SYNTHETIC_TERMINATED: &str = r#"{"seq":0,"type":"event","event":"terminated","body":{}}"#;

/// Forward every DAP message from the adapter to the frontend as `dap://event`.
fn spawn_dap_reader(session_id: u32, stream: TcpStream, app: AppHandle) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        let emit = |message: &str| {
            let _ = app.emit("dap://event", serde_json::json!({ "session_id": session_id, "message": message }));
        };
        loop {
            let mut content_length: Option<usize> = None;
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => {
                        info!("DAP reader[{session_id}]: stream closed");
                        emit(SYNTHETIC_TERMINATED);
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

            let Some(length) = content_length else {
                warn!("DAP reader[{session_id}]: missing Content-Length, skipping");
                continue;
            };

            let mut body = vec![0u8; length];
            if let Err(e) = std::io::Read::read_exact(&mut reader, &mut body) {
                error!("DAP reader[{session_id}]: read error: {e}");
                emit(SYNTHETIC_TERMINATED);
                return;
            }
            let json_str = String::from_utf8_lossy(&body).to_string();
            debug!("DAP[{session_id}] ← adapter: {}", &json_str[..json_str.len().min(300)]);
            emit(&json_str);
        }
    });
}

/// Start a debug adapter and connect to it. Returns the session id; the frontend
/// then drives the protocol through `debug_request`.
#[tauri::command]
pub async fn debug_start(app: AppHandle, config: DapConfig) -> Result<u32, String> {
    if crate::core::wsl::parse(&config.program).is_some() || crate::core::wsl::parse(&config.cwd).is_some() {
        return Err("Debugging files inside WSL is not supported yet. Open the folder from Windows, or use Run Active File (Ctrl+F5).".into());
    }
    let session_id = next_session_id();
    info!("debug_start: session={session_id}, adapter={}, program={}", config.adapter, config.program);

    let port = free_port()?;
    let (program, args) = adapter_command(&config.adapter, port)?;
    let child = crate::core::proc::cmd(&program)
        .args(&args)
        .current_dir(config.working_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start {program}: {e}. {}", install_hint(&config.adapter)))?;
    let mut child = Some(child);

    // Wait for the adapter to open its port (up to 10 seconds), failing fast
    // if it exits first (e.g. `python -m debugpy.adapter` without debugpy installed).
    wait_for_adapter(&mut child, &config.adapter, port, 10_000)?;

    let stream = TcpStream::connect(format!("127.0.0.1:{port}"))
        .map_err(|e| format!("Failed to connect to debug adapter on port {port}: {e}"))?;
    let reader_stream = stream.try_clone().map_err(|e| format!("Failed to clone TCP stream: {e}"))?;

    spawn_dap_reader(session_id, reader_stream, app);
    DEBUGGER_STATE
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(session_id, DapSession { id: session_id, process: child, stream: Some(stream), seq: 0 });

    info!("debug_start: session {session_id} connected");
    Ok(session_id)
}

/// Send one DAP request. Returns its `seq`; the response arrives as a `dap://event`.
#[tauri::command]
pub async fn debug_request(session_id: u32, command: String, arguments: serde_json::Value) -> Result<u32, String> {
    let mut sessions = DEBUGGER_STATE.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("No debug session with id {session_id}"))?;
    session.send_request(&command, arguments)
}

/// Terminate a debug session and its adapter.
#[tauri::command]
pub async fn debug_stop(session_id: u32) -> Result<(), String> {
    let mut sessions = DEBUGGER_STATE.sessions.lock().map_err(|e| e.to_string())?;
    let Some(mut session) = sessions.remove(&session_id) else {
        return Ok(()); // already gone (the adapter exited on its own)
    };

    // Best-effort disconnect request.
    let _ = session.send_request("disconnect", serde_json::json!({ "restart": false, "terminateDebuggee": true }));
    drop(session.stream.take());

    if let Some(mut child) = session.process.take() {
        if let Err(e) = child.kill() {
            warn!("debug_stop: kill() error for session {session_id}: {e}");
        }
        let _ = child.wait();
    }

    info!("debug_stop: session {session_id} terminated");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_port_is_actually_free() {
        // free_port() releases the port before returning, so a test running in parallel (or
        // any other process) can take the same ephemeral port before we rebind it. That race
        // is inherent and made this test flaky; a few attempts tell it apart from a real bug.
        let ok = (0..5).any(|_| {
            let port = free_port().unwrap();
            port > 0 && std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
        });
        assert!(ok, "free_port() never returned a port we could bind");
    }

    #[test]
    fn an_adapter_that_exits_early_is_an_error_with_a_hint() {
        let mut child = Some(crate::core::proc::cmd("sh").args(["-c", "exit 1"]).spawn().unwrap());
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
        let mut child = Some(crate::core::proc::cmd("sleep").arg("5").spawn().unwrap());
        assert!(wait_for_adapter(&mut child, "debugpy", port, 3_000).is_ok());
        let _ = child.as_mut().unwrap().kill();
    }

    #[test]
    fn a_silent_adapter_times_out_and_is_killed() {
        let mut child = Some(crate::core::proc::cmd("sleep").arg("30").spawn().unwrap());
        let port = free_port().unwrap();
        let err = wait_for_adapter(&mut child, "lldb-dap", port, 600).unwrap_err();
        assert!(err.contains("did not open port"), "{err}");
        assert!(child.as_mut().unwrap().try_wait().unwrap().is_some(), "the adapter was killed");
    }

    #[test]
    fn adapters_start_as_dap_servers_on_the_port() {
        let (_, args) = adapter_command("debugpy", 4242).unwrap();
        assert_eq!(args[..2], ["-m".to_string(), "debugpy.adapter".to_string()]);
        assert!(args.contains(&"4242".to_string()));
        let (prog, args) = adapter_command("dlv-dap", 4242).unwrap();
        assert_eq!((prog.as_str(), args), ("dlv", vec!["dap".to_string(), "--listen=127.0.0.1:4242".to_string()]));
        let (prog, args) = adapter_command("lldb", 4242).unwrap();
        assert_eq!(prog, "lldb-dap");
        assert_eq!(args[1], "listen://127.0.0.1:4242");
    }

    #[test]
    fn node_says_why_it_is_not_supported() {
        let err = adapter_command("js-debug", 1).unwrap_err();
        assert!(err.contains("js-debug"), "{err}");
        assert!(adapter_command("cobol", 1).unwrap_err().contains("Unsupported"));
    }

    #[test]
    fn dap_config_deserializes_frontend_payload() {
        let cfg: DapConfig = serde_json::from_str(r#"{"adapter":"debugpy","program":"/tmp/x.py"}"#).unwrap();
        assert_eq!(cfg.adapter, "debugpy");
        assert_eq!(cfg.program, "/tmp/x.py");
        assert_eq!(cfg.cwd, "");
    }

    #[test]
    fn working_dir_falls_back_to_program_parent() {
        let cfg: DapConfig = serde_json::from_str(r#"{"adapter":"debugpy","program":"/home/u/app/main.py"}"#).unwrap();
        assert_eq!(cfg.working_dir(), std::path::PathBuf::from("/home/u/app"));
    }

    #[test]
    fn working_dir_uses_explicit_cwd() {
        let cfg: DapConfig = serde_json::from_str(r#"{"adapter":"dlv-dap","program":"/a/b.go","cwd":"/work"}"#).unwrap();
        assert_eq!(cfg.working_dir(), std::path::PathBuf::from("/work"));
    }
}
