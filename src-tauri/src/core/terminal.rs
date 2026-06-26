use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::{Child, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct TerminalState {
    pub processes: Mutex<HashMap<u32, Child>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandOutput {
    pub id: u32,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

#[tauri::command]
pub async fn execute_command(
    app: AppHandle,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<CommandOutput, String> {
    let working_dir = cwd.unwrap_or_else(|| {
        dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default()
    });

    let output = if cfg!(target_os = "windows") {
        std::process::Command::new("cmd")
            .args(["/C", &command])
            .args(&args)
            .current_dir(&working_dir)
            .output()
            .map_err(|e| e.to_string())?
    } else {
        std::process::Command::new("sh")
            .arg("-c")
            .arg(format!("{} {}", command, args.join(" ")))
            .current_dir(&working_dir)
            .output()
            .map_err(|e| e.to_string())?
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code();

    let result = CommandOutput {
        id: 0,
        stdout: stdout.clone(),
        stderr: stderr.clone(),
        exit_code,
    };

    let _ = app.emit("terminal://output", serde_json::json!({
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": exit_code,
    }));

    Ok(result)
}

#[tauri::command]
pub async fn write_stdin(_pid: u32, _data: String) -> Result<(), String> {
    Ok(())
}
