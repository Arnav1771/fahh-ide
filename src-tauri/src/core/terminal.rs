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

/// Which shell a terminal tab runs its commands in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shell {
    Cmd,
    Pwsh,
    Wsl,
    Sh,
}

/// The tab's choice ("cmd", "powershell", "wsl"/"bash"), or the platform default:
/// on Windows a folder inside WSL defaults to WSL, anything else to cmd.
pub fn pick_shell(requested: Option<&str>, cwd: &str, windows: bool) -> Shell {
    match requested.map(|s| s.to_ascii_lowercase()) {
        Some(s) if s == "powershell" || s == "pwsh" => Shell::Pwsh,
        Some(s) if s == "wsl" || s == "bash" => Shell::Wsl,
        Some(s) if s == "cmd" && windows => Shell::Cmd,
        _ if !windows => Shell::Sh,
        _ if crate::core::wsl::parse(cwd).is_some() => Shell::Wsl,
        _ => Shell::Cmd,
    }
}

/// Builds the process for one terminal command. Windows cannot start a process in a
/// UNC folder such as \\wsl.localhost\Ubuntu\..., so for those the process starts in
/// the user's home and the shell itself moves into the folder.
pub fn shell_command(command: &str, args: &[String], cwd: &str, shell: Option<&str>) -> std::process::Command {
    shell_command_for(command, args, cwd, shell, cfg!(target_os = "windows"))
}

fn shell_command_for(command: &str, args: &[String], cwd: &str, shell: Option<&str>, windows: bool) -> std::process::Command {
    use crate::core::{proc, wsl};
    let line = if args.is_empty() { command.to_string() } else { format!("{} {}", command, args.join(" ")) };
    let unc = cwd.starts_with(r"\\") || cwd.starts_with("//");
    let home = dirs::home_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    match pick_shell(shell, cwd, windows) {
        Shell::Wsl => {
            let (distro, dir) = match wsl::parse(cwd) {
                Some(p) => (Some(p.distro), p.linux),
                None => (None, wsl::windows_to_mnt(cwd).unwrap_or_else(|| "~".to_string())),
            };
            wsl::command(distro.as_deref(), &dir, &line)
        }
        Shell::Pwsh => {
            let mut c = proc::cmd("powershell.exe");
            let script = if unc {
                format!("Set-Location -LiteralPath '{}'; {}", cwd.replace('\'', "''"), line)
            } else {
                line
            };
            c.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", &script]);
            c.current_dir(if unc { home.as_str() } else { cwd });
            c
        }
        Shell::Cmd => {
            let mut c = proc::cmd("cmd");
            if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
                if let Ok(current_path) = std::env::var("PATH") {
                    c.env("PATH", format!("{}\\agy\\bin;{}", local_app_data, current_path));
                }
            }
            // pushd maps a UNC folder to a temporary drive letter for the length of the command.
            let script = if unc { format!("pushd \"{cwd}\" && {line}") } else { line };
            c.args(["/C", &script]);
            c.current_dir(if unc { home.as_str() } else { cwd });
            c
        }
        Shell::Sh => {
            let mut c = proc::cmd("sh");
            c.arg("-c").arg(line).current_dir(cwd);
            c
        }
    }
}

#[tauri::command]
pub async fn execute_command(
    app: AppHandle,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    shell: Option<String>,
) -> Result<CommandOutput, String> {
    let mut working_dir = cwd.unwrap_or_default();
    if working_dir.is_empty() || working_dir == "~" {
        working_dir = dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
    }

    let mut child = shell_command(&command, &args, &working_dir, shell.as_deref())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

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

        let mut cmd = crate::core::proc::cmd("cmd.exe");
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
            crate::core::proc::cmd("osascript")
                .args(["-e", &script])
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(not(target_os = "macos"))]
        {
            let terminals = ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"];
            let mut spawned = false;
            for term in terminals {
                if crate::core::proc::cmd(term)
                    .args([
                        "-e",
                        &format!("sh -c \"cd '{}' && {}; exec sh\"", working_dir, agy_cmd),
                    ])
                    .spawn()
                    .is_ok()
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


#[cfg(test)]
mod shell_tests {
    use super::*;

    const WSL_DIR: &str = r"\\wsl.localhost\Ubuntu\home\dell\proj";

    #[test]
    fn wsl_folders_default_to_wsl_on_windows() {
        assert_eq!(pick_shell(None, WSL_DIR, true), Shell::Wsl);
        assert_eq!(pick_shell(Some("auto"), WSL_DIR, true), Shell::Wsl);
        assert_eq!(pick_shell(None, r"C:\proj", true), Shell::Cmd);
        assert_eq!(pick_shell(None, "/home/x", false), Shell::Sh);
    }

    #[test]
    fn an_explicit_shell_wins() {
        assert_eq!(pick_shell(Some("PowerShell"), WSL_DIR, true), Shell::Pwsh);
        assert_eq!(pick_shell(Some("cmd"), WSL_DIR, true), Shell::Cmd);
        assert_eq!(pick_shell(Some("bash"), r"C:\proj", true), Shell::Wsl);
    }

    fn argv(c: &std::process::Command) -> Vec<String> {
        c.get_args().map(|a| a.to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn wsl_runs_in_the_linux_folder() {
        let c = shell_command_for("ls -la", &[], WSL_DIR, Some("wsl"), true);
        assert_eq!(c.get_program(), "wsl.exe");
        assert_eq!(argv(&c), ["-d", "Ubuntu", "--cd", "/home/dell/proj", "--", "bash", "-lc", "ls -la"]);
    }

    #[test]
    fn cmd_pushes_into_a_unc_folder_instead_of_starting_there() {
        let c = shell_command_for("dir", &[], WSL_DIR, Some("cmd"), true);
        assert_eq!(argv(&c), ["/C", &format!("pushd \"{WSL_DIR}\" && dir")]);
        assert_ne!(c.get_current_dir().map(|d| d.to_string_lossy().into_owned()), Some(WSL_DIR.to_string()));
    }

    #[test]
    fn powershell_sets_location_for_a_unc_folder() {
        let c = shell_command_for("Get-ChildItem", &[], WSL_DIR, Some("powershell"), true);
        let a = argv(&c);
        assert_eq!(a.last().unwrap(), &format!("Set-Location -LiteralPath '{WSL_DIR}'; Get-ChildItem"));
    }
}
