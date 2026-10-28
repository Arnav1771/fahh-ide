//! Real terminals: each terminal tab is a shell on a pseudo-terminal (ConPTY on Windows),
//! drawn by xterm.js. Output is pushed as `pty://data` `{ id, data }`, the end as
//! `pty://exit` `{ id, code }`. Profiles are the shells found on this machine.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// A shell the terminal can start, like VS Code's terminal profiles.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TerminalProfile {
    pub id: String,
    pub name: String,
    pub program: String,
    pub args: Vec<String>,
}

struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

lazy_static::lazy_static! {
    static ref PTYS: Mutex<HashMap<u32, Pty>> = Mutex::new(HashMap::new());
}
static NEXT_ID: AtomicU32 = AtomicU32::new(1);

fn profile(id: &str, name: &str, program: &str, args: &[&str]) -> TerminalProfile {
    TerminalProfile {
        id: id.into(),
        name: name.into(),
        program: program.into(),
        args: args.iter().map(|a| a.to_string()).collect(),
    }
}

#[cfg(windows)]
fn detect_profiles() -> Vec<TerminalProfile> {
    let mut out = vec![if which::which("pwsh.exe").is_ok() {
        profile("pwsh", "PowerShell", "pwsh.exe", &["-NoLogo"])
    } else {
        profile("powershell", "PowerShell", "powershell.exe", &["-NoLogo"])
    }];
    out.push(profile("cmd", "Command Prompt", "cmd.exe", &[]));
    if let Some(bash) = git_bash() {
        out.push(TerminalProfile { id: "gitbash".into(), name: "Git Bash".into(), program: bash, args: vec!["--login".into(), "-i".into()] });
    }
    if which::which("wsl.exe").is_ok() {
        out.push(profile("wsl", "WSL", "wsl.exe", &[]));
    }
    out
}

/// Git for Windows' bash: next to git.exe, or in the usual install folders.
#[cfg(windows)]
fn git_bash() -> Option<String> {
    use std::path::{Path, PathBuf};
    let mut candidates: Vec<PathBuf> = vec![];
    if let Ok(git) = which::which("git.exe") {
        // ...\Git\cmd\git.exe → ...\Git\bin\bash.exe
        if let Some(root) = git.parent().and_then(Path::parent) {
            candidates.push(root.join("bin").join("bash.exe"));
        }
    }
    let bases = [
        std::env::var("ProgramFiles").ok(),
        std::env::var("ProgramFiles(x86)").ok(),
        std::env::var("LOCALAPPDATA").ok().map(|l| format!("{l}\\Programs")),
    ];
    for base in bases.into_iter().flatten() {
        candidates.push(Path::new(&base).join("Git").join("bin").join("bash.exe"));
    }
    candidates.into_iter().find(|p| p.is_file()).map(|p| p.to_string_lossy().into_owned())
}

#[cfg(not(windows))]
fn detect_profiles() -> Vec<TerminalProfile> {
    let mut paths: Vec<String> = std::env::var("SHELL").ok().into_iter().collect();
    paths.extend(["/bin/bash", "/usr/bin/zsh", "/bin/zsh", "/usr/bin/fish", "/bin/sh"].map(String::from));
    let mut out: Vec<TerminalProfile> = vec![];
    for path in paths {
        if !std::path::Path::new(&path).is_file() {
            continue;
        }
        let name = path.rsplit('/').next().unwrap_or(&path).to_string();
        if !out.iter().any(|p| p.id == name) {
            out.push(TerminalProfile { id: name.clone(), name, program: path, args: vec![] });
        }
    }
    out
}

/// Program, arguments and working directory for `profile` opened in `cwd`.
/// cmd and PowerShell cannot start in a `\\wsl.localhost\...` folder, so they start at home;
/// the WSL profile opens the same folder inside the distro instead.
fn plan(profile: &TerminalProfile, cwd: &str, home: &str) -> (String, Vec<String>, String) {
    let mut args = profile.args.clone();
    if let Some(w) = crate::core::wsl::parse(cwd) {
        if profile.id == "wsl" {
            args.extend(["-d".to_string(), w.distro, "--cd".to_string(), w.linux]);
        }
        return (profile.program.clone(), args, home.to_string());
    }
    let dir = if !cwd.trim().is_empty() && std::path::Path::new(cwd).is_dir() { cwd } else { home };
    (profile.program.clone(), args, dir.to_string())
}

/// Windows: "ignore Ctrl+C" is a per-process flag that children inherit. Launched from a
/// shell or tool that set it, Fahh would pass it to every terminal: Ctrl+C would not stop
/// `npm run dev` or a Python script. Clear it for this process (and so for the shells).
#[cfg(windows)]
fn allow_ctrl_c() {
    // SAFETY: with a null handler this only sets the process' Ctrl+C attribute.
    unsafe {
        windows_sys::Win32::System::Console::SetConsoleCtrlHandler(None, 0);
    }
}
#[cfg(not(windows))]
fn allow_ctrl_c() {}

/// Decode as much of `pending` as is valid UTF-8, keeping a character cut at the end of a read
/// for the next one (a read can split "é" or an emoji).
fn take_utf8(pending: &mut Vec<u8>) -> String {
    match std::str::from_utf8(pending) {
        Ok(s) => {
            let s = s.to_owned();
            pending.clear();
            s
        }
        Err(e) if e.error_len().is_none() => {
            let valid = e.valid_up_to();
            let s = String::from_utf8_lossy(&pending[..valid]).into_owned();
            pending.drain(..valid);
            s
        }
        Err(_) => {
            let s = String::from_utf8_lossy(pending).into_owned();
            pending.clear();
            s
        }
    }
}

/// Start `profile` on a new pseudo-terminal. `on_data` gets output as it arrives; `on_exit`
/// runs once with the exit code when the shell ends (or is killed).
fn spawn_raw(
    profile: &TerminalProfile,
    cwd: &str,
    cols: u16,
    rows: u16,
    on_data: impl Fn(u32, String) + Send + 'static,
    on_exit: impl FnOnce(u32, Option<u32>) + Send + 'static,
) -> Result<u32, String> {
    let home = dirs::home_dir().map(|h| h.to_string_lossy().into_owned()).unwrap_or_else(|| ".".into());
    let (program, args, dir) = plan(profile, cwd, &home);
    let pair = native_pty_system()
        .openpty(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("Could not open a terminal: {e}"))?;
    let mut cmd = CommandBuilder::new(&program);
    cmd.args(&args);
    cmd.cwd(&dir);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "fahh");
    allow_ctrl_c();
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| format!("Could not start {program}: {e}"))?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    PTYS.lock().map_err(|e| e.to_string())?.insert(id, Pty { master: pair.master, writer, killer });

    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        let mut pending = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let text = take_utf8(&mut pending);
                    if !text.is_empty() {
                        on_data(id, text);
                    }
                }
            }
        }
    });
    // On Windows a ConPTY's output pipe stays open after the shell exits, until the pseudo-
    // console is closed: wait for the shell here, then drop the PTY so the reader ends too.
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|s| s.exit_code());
        if let Ok(mut map) = PTYS.lock() {
            map.remove(&id);
        }
        on_exit(id, code);
    });
    Ok(id)
}

/// The shells this machine has, the default first.
#[tauri::command]
pub fn terminal_profiles() -> Vec<TerminalProfile> {
    detect_profiles()
}

/// Start a shell for a terminal tab. `profile` is a profile id ("" or unknown: the first one).
#[tauri::command]
pub async fn pty_spawn(app: AppHandle, profile: String, cwd: String, cols: u16, rows: u16) -> Result<u32, String> {
    let profiles = detect_profiles();
    let chosen = profiles
        .iter()
        .find(|p| p.id == profile)
        .or_else(|| profiles.first())
        .ok_or("No shell was found on this machine")?
        .clone();
    let data_app = app.clone();
    spawn_raw(
        &chosen,
        &cwd,
        cols,
        rows,
        move |id, data| {
            let _ = data_app.emit("pty://data", serde_json::json!({ "id": id, "data": data }));
        },
        move |id, code| {
            let _ = app.emit("pty://exit", serde_json::json!({ "id": id, "code": code }));
        },
    )
}

/// Keystrokes (or pasted text) for the shell.
#[tauri::command]
pub fn pty_write(id: u32, data: String) -> Result<(), String> {
    let mut map = PTYS.lock().map_err(|e| e.to_string())?;
    let pty = map.get_mut(&id).ok_or("This terminal has exited")?;
    pty.writer.write_all(data.as_bytes()).and_then(|_| pty.writer.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let map = PTYS.lock().map_err(|e| e.to_string())?;
    let Some(pty) = map.get(&id) else { return Ok(()) };
    pty.master
        .resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

/// Kill the shell (closing its tab). Its exit still arrives as `pty://exit`.
#[tauri::command]
pub fn pty_kill(id: u32) -> Result<(), String> {
    let pty = PTYS.lock().map_err(|e| e.to_string())?.remove(&id);
    if let Some(mut pty) = pty {
        let _ = pty.killer.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn p(id: &str) -> TerminalProfile {
        profile(id, id, "/bin/sh", &["-i"])
    }

    #[test]
    fn a_folder_inside_wsl_opens_there_only_in_the_wsl_profile() {
        let (_, args, dir) = plan(&p("wsl"), r"\\wsl.localhost\Ubuntu\home\me\proj", "C:\\Users\\me");
        assert_eq!(args, ["-i", "-d", "Ubuntu", "--cd", "/home/me/proj"]);
        assert_eq!(dir, "C:\\Users\\me");
        let (_, args, dir) = plan(&p("cmd"), r"\\wsl.localhost\Ubuntu\home\me\proj", "C:\\Users\\me");
        assert_eq!(args, ["-i"]);
        assert_eq!(dir, "C:\\Users\\me");
    }

    #[test]
    fn a_missing_folder_falls_back_to_home() {
        let (_, _, dir) = plan(&p("bash"), "/definitely/not/here", "/home/me");
        assert_eq!(dir, "/home/me");
        let tmp = std::env::temp_dir();
        let (_, _, dir) = plan(&p("bash"), tmp.to_str().unwrap(), "/home/me");
        assert_eq!(dir, tmp.to_str().unwrap());
    }

    #[test]
    fn utf8_split_across_reads_is_kept_whole() {
        let bytes = "héllo ✓".as_bytes();
        let cut = 2; // inside "é"
        let mut pending = bytes[..cut].to_vec();
        assert_eq!(take_utf8(&mut pending), "h");
        pending.extend_from_slice(&bytes[cut..]);
        assert_eq!(take_utf8(&mut pending), "éllo ✓");
        assert!(pending.is_empty());
        let mut bad = vec![b'a', 0xff, b'b'];
        assert_eq!(take_utf8(&mut bad), "a\u{fffd}b");
    }

    #[cfg(unix)]
    #[test]
    fn finds_a_shell() {
        assert!(!detect_profiles().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn a_shell_runs_input_and_reports_its_exit() {
        let sh = profile("sh", "sh", "/bin/sh", &[]);
        let (tx, rx) = mpsc::channel::<String>();
        let (etx, erx) = mpsc::channel::<Option<u32>>();
        let id = spawn_raw(&sh, "", 80, 24, move |_, d| { let _ = tx.send(d); }, move |_, c| { let _ = etx.send(c); }).unwrap();
        pty_write(id, "echo fahh-$((40+2))\nexit 3\n".into()).unwrap();
        let mut seen = String::new();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while !seen.contains("fahh-42") && std::time::Instant::now() < deadline {
            if let Ok(d) = rx.recv_timeout(Duration::from_millis(200)) {
                seen.push_str(&d);
            }
        }
        assert!(seen.contains("fahh-42"), "output was: {seen:?}");
        assert_eq!(erx.recv_timeout(Duration::from_secs(10)).unwrap(), Some(3));
        assert!(pty_write(id, "x".into()).is_err(), "an exited terminal refuses input");
    }
}
