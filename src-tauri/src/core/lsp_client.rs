use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, State};
use tracing::{debug, error, info, warn};

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

/// A running LSP server process together with its stdin handle.
pub struct LspServer {
    pub language: String,
    pub process: Child,
    pub stdin: ChildStdin,
}

/// All active LSP server instances, keyed by language identifier.
#[derive(Default)]
pub struct LspManager {
    pub servers: HashMap<String, LspServer>,
}

/// Tauri-managed state wrapping the LSP manager behind a mutex.
#[derive(Default)]
pub struct LspState {
    pub manager: Mutex<LspManager>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Choose the binary and startup arguments for a given language's LSP server.
fn server_command(language: &str, workspace: &str) -> Result<(String, Vec<String>), String> {
    match language {
        "rust" => Ok(("rust-analyzer".to_string(), vec![])),
        "typescript" | "javascript" => {
            // typescript-language-server is the most widely available option.
            Ok((
                "typescript-language-server".to_string(),
                vec!["--stdio".to_string()],
            ))
        }
        "python" => {
            // Prefer pyright if available; fall back to pylsp.
            if which::which("pyright-langserver").is_ok() {
                Ok(("pyright-langserver".to_string(), vec!["--stdio".to_string()]))
            } else if which::which("pylsp").is_ok() {
                Ok(("pylsp".to_string(), vec![]))
            } else if which::which("pyright").is_ok() {
                Ok(("pyright".to_string(), vec!["--stdio".to_string()]))
            } else {
                Err("No Python LSP found. Install pylsp or pyright.".to_string())
            }
        }
        "go" => Ok(("gopls".to_string(), vec![])),
        "cpp" | "c" => Ok(("clangd".to_string(), vec![])),
        "java" => {
            // jdtls requires pointing at its launcher jar; fall back to a simple
            // invocation that works when jdtls is already on PATH.
            Ok(("jdtls".to_string(), vec![
                "-data".to_string(),
                workspace.to_string(),
            ]))
        }
        "lua" => Ok(("lua-language-server".to_string(), vec![])),
        "ruby" => Ok(("solargraph".to_string(), vec!["stdio".to_string()])),
        "html" => Ok(("vscode-html-language-server".to_string(), vec!["--stdio".to_string()])),
        "css" | "scss" | "less" => Ok((
            "vscode-css-language-server".to_string(),
            vec!["--stdio".to_string()],
        )),
        "json" => Ok((
            "vscode-json-language-server".to_string(),
            vec!["--stdio".to_string()],
        )),
        "yaml" => Ok(("yaml-language-server".to_string(), vec!["--stdio".to_string()])),
        "csharp" => Ok(("OmniSharp".to_string(), vec!["-lsp".to_string()])),
        "dart" => Ok(("dart".to_string(), vec!["language-server".to_string(), "--protocol=lsp".to_string()])),
        "kotlin" => Ok(("kotlin-language-server".to_string(), vec![])),
        "bash" | "shell" => Ok(("bash-language-server".to_string(), vec!["start".to_string()])),
        other => Err(format!("No LSP server configured for language: {other}")),
    }
}

/// Encode a JSON-RPC message with the standard `Content-Length` header.
fn encode_message(json: &str) -> Vec<u8> {
    let header = format!("Content-Length: {}\r\n\r\n", json.len());
    let mut buf = header.into_bytes();
    buf.extend_from_slice(json.as_bytes());
    buf
}

/// Read one JSON-RPC message from a `BufReader`. Returns the JSON body string.
fn read_one_message<R: Read>(reader: &mut BufReader<R>) -> std::io::Result<String> {
    // Read headers until the blank line.
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line)?;
        if n == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "LSP stream closed",
            ));
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            // End of headers.
            break;
        }
        if let Some(rest) = trimmed.strip_prefix("Content-Length:") {
            content_length = rest.trim().parse().ok();
        }
    }

    let length = content_length.ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "Missing Content-Length header")
    })?;

    let mut body = vec![0u8; length];
    reader.read_exact(&mut body)?;
    Ok(String::from_utf8_lossy(&body).to_string())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Start an LSP server for the given language and workspace root.
/// Forwards all server messages to the frontend via the `lsp://message` event.
#[tauri::command]
pub async fn lsp_start(
    app: AppHandle,
    language: String,
    workspace: String,
    state: State<'_, LspState>,
) -> Result<(), String> {
    // Check if a server for this language is already running.
    {
        let manager = state.manager.lock().map_err(|e| e.to_string())?;
        if manager.servers.contains_key(&language) {
            info!("lsp_start: server for '{language}' is already running, skipping");
            return Ok(());
        }
    }

    let (binary, args) = server_command(&language, &workspace)?;

    info!("lsp_start: spawning '{binary}' for language '{language}' in workspace '{workspace}'");

    // Verify the binary exists before attempting to spawn.
    if which::which(&binary).is_err() {
        return Err(format!(
            "LSP binary '{binary}' not found on PATH. Install it to enable {language} support."
        ));
    }

    let mut child = Command::new(&binary)
        .args(&args)
        .current_dir(&workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn LSP server '{binary}': {e}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to capture LSP stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture LSP stdout".to_string())?;

    // Spawn a reader thread that forwards server → frontend.
    let lang_clone = language.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_one_message(&mut reader) {
                Ok(msg) => {
                    debug!("lsp[{lang_clone}] → frontend: {}", &msg[..msg.len().min(200)]);
                    let _ = app.emit(
                        "lsp://message",
                        serde_json::json!({ "language": lang_clone, "message": msg }),
                    );
                }
                Err(e) => {
                    if e.kind() != std::io::ErrorKind::UnexpectedEof {
                        error!("lsp[{lang_clone}] reader error: {e}");
                    } else {
                        info!("lsp[{lang_clone}] server closed its stdout");
                    }
                    break;
                }
            }
        }
    });

    let server = LspServer {
        language: language.clone(),
        process: child,
        stdin,
    };

    state
        .manager
        .lock()
        .map_err(|e| e.to_string())?
        .servers
        .insert(language.clone(), server);

    info!("lsp_start: '{language}' server is ready");
    Ok(())
}

/// Send a raw JSON-RPC message string to the LSP server for the given language.
#[tauri::command]
pub async fn lsp_send(
    language: String,
    message: String,
    state: State<'_, LspState>,
) -> Result<(), String> {
    let mut manager = state.manager.lock().map_err(|e| e.to_string())?;
    let server = manager
        .servers
        .get_mut(&language)
        .ok_or_else(|| format!("No LSP server running for language: {language}"))?;

    let encoded = encode_message(&message);
    debug!("lsp_send[{language}]: {} bytes", encoded.len());

    server
        .stdin
        .write_all(&encoded)
        .map_err(|e| format!("Failed to write to LSP stdin for {language}: {e}"))?;

    server
        .stdin
        .flush()
        .map_err(|e| format!("Failed to flush LSP stdin for {language}: {e}"))?;

    Ok(())
}

/// Stop the LSP server for the given language.
#[tauri::command]
pub fn lsp_stop(language: String, state: State<'_, LspState>) -> Result<(), String> {
    let mut manager = state.manager.lock().map_err(|e| e.to_string())?;

    let mut server = manager
        .servers
        .remove(&language)
        .ok_or_else(|| format!("No LSP server running for language: {language}"))?;

    // Best-effort kill; if already dead that's fine.
    if let Err(e) = server.process.kill() {
        warn!("lsp_stop[{language}]: kill() error (possibly already dead): {e}");
    }

    // Reap the process to avoid zombies.
    let _ = server.process.wait();

    info!("lsp_stop: '{language}' server stopped");
    Ok(())
}
