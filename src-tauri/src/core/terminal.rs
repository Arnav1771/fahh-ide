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

#[tauri::command]
pub async fn launch_agy_terminal(
    cwd: Option<String>,
    args: Option<Vec<String>>,
) -> Result<String, String> {
    let mut working_dir = cwd.unwrap_or_default();
    if working_dir.is_empty() || working_dir == "~" {
        working_dir = dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

        let extra_args = args.unwrap_or_default().join(" ");
        let agy_exe = if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let candidate = std::path::PathBuf::from(&local_app_data)
                .join("agy")
                .join("bin")
                .join("agy.exe");
            if candidate.exists() {
                candidate.to_string_lossy().to_string()
            } else {
                "agy.exe".to_string()
            }
        } else {
            "agy.exe".to_string()
        };

        let cmd_payload = if extra_args.is_empty() {
            format!("chcp 65001 >nul && \"{}\"", agy_exe)
        } else {
            format!("chcp 65001 >nul && \"{}\" {}", agy_exe, extra_args)
        };

        let mut cmd = std::process::Command::new("cmd.exe");
        cmd.creation_flags(CREATE_NEW_CONSOLE);
        cmd.args(["/k", &cmd_payload]);
        if !working_dir.is_empty() {
            cmd.current_dir(&working_dir);
        }
        cmd.spawn()
            .map_err(|e| format!("Failed to spawn Antigravity CLI console: {}", e))?;
        Ok("Antigravity CLI console launched successfully.".to_string())
    }

    #[cfg(not(windows))]
    {
        let extra_args = args.unwrap_or_default().join(" ");
        let agy_cmd = if extra_args.is_empty() {
            "agy".to_string()
        } else {
            format!("agy {}", extra_args)
        };

        #[cfg(target_os = "macos")]
        {
            let script = format!(
                "tell application \"Terminal\" to do script \"cd '{}' && {}\"",
                working_dir, agy_cmd
            );
            std::process::Command::new("osascript")
                .args(["-e", &script])
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(not(target_os = "macos"))]
        {
            let terminals = ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"];
            let mut spawned = false;
            for term in terminals {
                if let Ok(_) = std::process::Command::new(term)
                    .args([
                        "-e",
                        &format!("sh -c \"cd '{}' && {}; exec sh\"", working_dir, agy_cmd),
                    ])
                    .spawn()
                {
                    spawned = true;
                    break;
                }
            }
            if !spawned {
                return Err("No supported terminal emulator found".into());
            }
        }
        Ok("Antigravity CLI terminal spawned.".to_string())
    }
}

