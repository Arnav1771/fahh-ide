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
    let mut working_dir = cwd.unwrap_or_default();
    if working_dir.is_empty() || working_dir == "~" {
        working_dir = dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
    }

    let mut child = if cfg!(target_os = "windows") {
        let mut cmd_builder = crate::core::proc::cmd("cmd");
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let agy_bin = format!("{}\\agy\\bin", local_app_data);
            if let Ok(current_path) = std::env::var("PATH") {
                cmd_builder.env("PATH", format!("{};{}", agy_bin, current_path));
            }
        }
        cmd_builder
            .args(["/C", &command])
            .args(&args)
            .current_dir(&working_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?
    } else {
        crate::core::proc::cmd("sh")
            .arg("-c")
            .arg(format!("{} {}", command, args.join(" ")))
            .current_dir(&working_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?
    };

    let stdout_pipe = child.stdout.take().unwrap();
    let stderr_pipe = child.stderr.take().unwrap();

    let app_stdout = app.clone();
    let app_stderr = app.clone();

    let stdout_handle = std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(stdout_pipe);
        for l in reader.lines().map_while(Result::ok) {
            let _ = app_stdout.emit("terminal://output", serde_json::json!({
                "stdout": l,
                "stderr": "",
                "exit_code": null,
            }));
        }
    });

    let stderr_handle = std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(stderr_pipe);
        for l in reader.lines().map_while(Result::ok) {
            let _ = app_stderr.emit("terminal://output", serde_json::json!({
                "stdout": "",
                "stderr": l,
                "exit_code": null,
            }));
        }
    });

    let status = child.wait().map_err(|e| e.to_string())?;
    
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    let exit_code = status.code();

    let result = CommandOutput {
        id: 0,
        stdout: String::new(),
        stderr: String::new(),
        exit_code,
    };

    Ok(result)
}

#[tauri::command]
pub async fn write_stdin(_pid: u32, _data: String) -> Result<(), String> {
    Ok(())
}
