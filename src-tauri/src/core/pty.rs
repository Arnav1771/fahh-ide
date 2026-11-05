//! Real terminals: each terminal tab is a shell on a pseudo-terminal (ConPTY on Windows),
//! drawn by xterm.js. Output is pushed as `pty://data` `{ id, data }`, the end as
//! `pty://exit` `{ id, code }`. Profiles are the shells found on this machine.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Mutex};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, PtySize};
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

/// Work for a session's own I/O thread. Writes and resizes on a ConPTY block while conhost is
/// busy (a TUI streaming output), so they never run under the `PTYS` lock or on the UI thread:
/// one stuck session used to freeze every other terminal, including spawning new ones.
enum Cmd {
    Write(Vec<u8>),
    Resize(PtySize),
}

struct Pty {
    /// Label of the window whose tab owns this shell.
    owner: String,
    tx: mpsc::Sender<Cmd>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    tree: Tree,
}

/// The shell and everything it started. Killing only the shell left `claude.exe`, `npm run dev`
/// and the like running after their tab closed. Windows: a job object the shell (and so every
/// child) belongs to, closed with the app as well. Unix: the shell's process group.
#[cfg(windows)]
struct Tree(windows_sys::Win32::Foundation::HANDLE);
// SAFETY: a job handle is a kernel object handle, usable from any thread.
#[cfg(windows)]
unsafe impl Send for Tree {}
#[cfg(windows)]
unsafe impl Sync for Tree {}

#[cfg(windows)]
impl Tree {
    fn of(pid: Option<u32>) -> Tree {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::JobObjects::*;
        use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};
        // SAFETY: plain Win32 calls on handles created here; failures leave a null/unused job.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Tree(job);
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            // Fahh exiting (even crashing) closes the job and ends every terminal's processes.
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if let Some(pid) = pid {
                let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
                if !process.is_null() {
                    AssignProcessToJobObject(job, process);
                    CloseHandle(process);
                }
            }
            Tree(job)
        }
    }

    fn kill(&self) {
        if !self.0.is_null() {
            // SAFETY: our own job handle.
            unsafe { windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0, 1) };
        }
    }

    /// The shell exited by itself: leave what it started on purpose (`start notepad`) running.
    fn release(&self) {
        use windows_sys::Win32::System::JobObjects::*;
        if self.0.is_null() {
            return;
        }
        // SAFETY: our own job handle; clearing its limits.
        unsafe {
            let info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            SetInformationJobObject(
                self.0,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
        }
    }
}

#[cfg(windows)]
impl Drop for Tree {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: our own job handle, closed once.
            unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
        }
    }
}

#[cfg(unix)]
struct Tree(Option<u32>);

#[cfg(unix)]
impl Tree {
    fn of(pid: Option<u32>) -> Tree {
        Tree(pid)
    }

    fn kill(&self) {
        // The shell leads its own session and process group (setsid): signal the whole group.
        if let Some(pid) = self.0 {
            // SAFETY: kill(2) on a process group id.
            unsafe { libc::kill(-(pid as i32), libc::SIGKILL) };
        }
    }

    fn release(&self) {}
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
    windows_profiles(which::which("pwsh.exe").is_ok(), git_bash(), which::which("wsl.exe").is_ok())
}

/// The Windows profiles, given what is installed (pure, so every platform tests it).
fn windows_profiles(has_pwsh: bool, git_bash: Option<String>, has_wsl: bool) -> Vec<TerminalProfile> {
    // Windows PowerShell 5.1 and cmd read the pseudo-console in the OEM code page, so typed
    // "é" arrived as "Ã©": switch their console to UTF-8 first (pwsh is UTF-8 already).
    let mut out = vec![if has_pwsh {
        profile("pwsh", "PowerShell", "pwsh.exe", &["-NoLogo"])
    } else {
        profile(
            "powershell",
            "PowerShell",
            "powershell.exe",
            &["-NoLogo", "-NoExit", "-Command", "[Console]::InputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)"],
        )
    }];
    out.push(profile("cmd", "Command Prompt", "cmd.exe", &["/K", "chcp 65001 >nul"]));
    if let Some(bash) = git_bash {
        out.push(TerminalProfile { id: "gitbash".into(), name: "Git Bash".into(), program: bash, args: vec!["--login".into(), "-i".into()] });
    }
    if has_wsl {
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
///
/// `remote_signed`: PowerShell gets `-ExecutionPolicy RemoteSigned` for this process only, so
/// the user's profile script and `.venv\Scripts\Activate.ps1` load on a machine left at the
/// Windows default (Restricted). Machine and user policy are untouched; Group Policy still wins.
fn plan(profile: &TerminalProfile, cwd: &str, home: &str, remote_signed: bool) -> (String, Vec<String>, String) {
    let mut args = profile.args.clone();
    if remote_signed && (profile.id == "pwsh" || profile.id == "powershell") {
        // before any -Command: everything after it is the command
        args.splice(0..0, ["-ExecutionPolicy".to_string(), "RemoteSigned".to_string()]);
    }
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
#[allow(clippy::too_many_arguments)]
fn spawn_raw(
    owner: &str,
    profile: &TerminalProfile,
    cwd: &str,
    cols: u16,
    rows: u16,
    remote_signed: bool,
    on_data: impl Fn(u32, String) + Send + 'static,
    on_exit: impl FnOnce(u32, Option<u32>) + Send + 'static,
) -> Result<u32, String> {
    let home = dirs::home_dir().map(|h| h.to_string_lossy().into_owned()).unwrap_or_else(|| ".".into());
    let (program, args, dir) = plan(profile, cwd, &home, remote_signed);
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
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let master = pair.master;
    let killer = child.clone_killer();
    let tree = Tree::of(child.process_id());
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel::<Cmd>();
    // This session's writes and resizes, in order. Ends when the session leaves `PTYS` (its
    // sender is dropped); dropping `master` here, off the lock, closes the pseudo-console.
    std::thread::spawn(move || {
        for cmd in rx {
            match cmd {
                Cmd::Write(bytes) => {
                    let _ = writer.write_all(&bytes).and_then(|_| writer.flush());
                }
                Cmd::Resize(size) => {
                    let _ = master.resize(size);
                }
            }
        }
    });
    PTYS.lock().map_err(|e| e.to_string())?.insert(id, Pty { owner: owner.to_string(), tx, killer, tree });

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
        let gone = PTYS.lock().ok().and_then(|mut map| map.remove(&id));
        if let Some(pty) = &gone {
            pty.tree.release();
        }
        drop(gone); // outside the lock
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
/// `ps_remote_signed` (default true): see `plan`; false leaves PowerShell on the system policy.
#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    window: tauri::WebviewWindow,
    profile: String,
    cwd: String,
    cols: u16,
    rows: u16,
    ps_remote_signed: Option<bool>,
) -> Result<u32, String> {
    let profiles = detect_profiles();
    let chosen = profiles
        .iter()
        .find(|p| p.id == profile)
        .or_else(|| profiles.first())
        .ok_or("No shell was found on this machine")?
        .clone();
    let data_app = app.clone();
    let owner = window.label().to_string();
    let to = owner.clone();
    let exit_to = owner.clone();
    // Opening a ConPTY and starting the shell block: keep them off the async workers.
    tauri::async_runtime::spawn_blocking(move || {
        spawn_raw(
            &owner,
            &chosen,
            &cwd,
            cols,
            rows,
            ps_remote_signed.unwrap_or(true),
            move |id, data| {
                let _ = data_app.emit_to(to.as_str(), "pty://data", serde_json::json!({ "id": id, "data": data }));
            },
            move |id, code| {
                let _ = app.emit_to(exit_to.as_str(), "pty://exit", serde_json::json!({ "id": id, "code": code }));
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Queue work for a session's I/O thread; never blocks.
fn send(id: u32, cmd: Cmd) -> Result<(), String> {
    let map = PTYS.lock().map_err(|e| e.to_string())?;
    let pty = map.get(&id).ok_or("This terminal has exited")?;
    pty.tx.send(cmd).map_err(|_| "This terminal has exited".to_string())
}

/// Keystrokes (or pasted text) for the shell.
#[tauri::command]
pub fn pty_write(id: u32, data: String) -> Result<(), String> {
    send(id, Cmd::Write(data.into_bytes()))
}

#[tauri::command]
pub fn pty_resize(id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let _ = send(id, Cmd::Resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 }));
    Ok(())
}

/// Kill every shell a window owns: it closed, or reloaded and lost its tabs (they used to keep
/// running, unseen, until Fahh exited).
pub fn kill_window(label: &str) {
    let gone: Vec<Pty> = match PTYS.lock() {
        Ok(mut map) => {
            let ids: Vec<u32> = map.iter().filter(|(_, p)| p.owner == label).map(|(id, _)| *id).collect();
            ids.into_iter().filter_map(|id| map.remove(&id)).collect()
        }
        Err(_) => return,
    };
    for mut pty in gone {
        pty.tree.kill();
        let _ = pty.killer.kill();
    }
}

/// A window starting up (first load or reload) drops the shells of its previous page.
#[tauri::command]
pub fn pty_reset(window: tauri::WebviewWindow) {
    kill_window(window.label());
}

/// Kill the shell (closing its tab). Its exit still arrives as `pty://exit`.
#[tauri::command]
pub fn pty_kill(id: u32) -> Result<(), String> {
    let pty = PTYS.lock().map_err(|e| e.to_string())?.remove(&id);
    if let Some(mut pty) = pty {
        pty.tree.kill(); // the shell and all it started (claude.exe, dev servers)
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
        let (_, args, dir) = plan(&p("wsl"), r"\\wsl.localhost\Ubuntu\home\me\proj", "C:\\Users\\me", true);
        assert_eq!(args, ["-i", "-d", "Ubuntu", "--cd", "/home/me/proj"]);
        assert_eq!(dir, "C:\\Users\\me");
        let (_, args, dir) = plan(&p("cmd"), r"\\wsl.localhost\Ubuntu\home\me\proj", "C:\\Users\\me", true);
        assert_eq!(args, ["-i"]);
        assert_eq!(dir, "C:\\Users\\me");
    }

    #[test]
    fn a_missing_folder_falls_back_to_home() {
        let (_, _, dir) = plan(&p("bash"), "/definitely/not/here", "/home/me", true);
        assert_eq!(dir, "/home/me");
        let tmp = std::env::temp_dir();
        let (_, _, dir) = plan(&p("bash"), tmp.to_str().unwrap(), "/home/me", true);
        assert_eq!(dir, tmp.to_str().unwrap());
    }

    #[test]
    fn powershell_gets_remote_signed_for_its_own_process_only_when_asked() {
        let ps = profile("powershell", "PowerShell", "powershell.exe", &["-NoLogo", "-NoExit", "-Command", "x"]);
        let (_, args, _) = plan(&ps, "", "/home/me", true);
        assert_eq!(args, ["-ExecutionPolicy", "RemoteSigned", "-NoLogo", "-NoExit", "-Command", "x"]);
        let pwsh = profile("pwsh", "PowerShell", "pwsh.exe", &["-NoLogo"]);
        let (_, args, _) = plan(&pwsh, "", "/home/me", true);
        assert_eq!(args, ["-ExecutionPolicy", "RemoteSigned", "-NoLogo"]);
        // "System default": untouched
        let (_, args, _) = plan(&pwsh, "", "/home/me", false);
        assert_eq!(args, ["-NoLogo"]);
        // never Bypass, and other shells never get the flag
        for id in ["cmd", "gitbash", "wsl", "bash"] {
            let (_, args, _) = plan(&p(id), "", "/home/me", true);
            assert_eq!(args, ["-i"], "{id}");
        }
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
        let id = spawn_raw("test", &sh, "", 80, 24, true, move |_, d| { let _ = tx.send(d); }, move |_, c| { let _ = etx.send(c); }).unwrap();
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

    /// A shell that never reads its input (a TUI busy streaming) used to block `pty_write`
    /// while it held the lock over every session, so no new terminal could start.
    #[cfg(unix)]
    #[test]
    fn a_stuck_session_does_not_block_input_or_new_terminals() {
        let busy = profile("sh", "sh", "/bin/sh", &["-c", "stty raw -echo; sleep 30"]);
        let stuck = spawn_raw("test", &busy, "", 80, 24, true, |_, _| {}, |_, _| {}).unwrap();
        std::thread::sleep(Duration::from_millis(300)); // let stty run
        let (done_tx, done_rx) = mpsc::channel::<()>();
        std::thread::spawn(move || {
            // far more than the tty input buffer holds: the session's writer blocks on it
            for _ in 0..64 {
                let _ = pty_write(stuck, "x".repeat(16 * 1024));
            }
            let _ = pty_resize(stuck, 100, 30);
            let _ = done_tx.send(());
        });
        done_rx.recv_timeout(Duration::from_secs(5)).expect("pty_write/pty_resize blocked on a stuck shell");

        let sh = profile("sh", "sh", "/bin/sh", &[]);
        let (tx, rx) = mpsc::channel::<String>();
        let (stx, srx) = mpsc::channel();
        std::thread::spawn(move || {
            let id = spawn_raw("test", &sh, "", 80, 24, true, move |_, d| { let _ = tx.send(d); }, |_, _| {}).unwrap();
            pty_write(id, "echo second-$((1+1))\n".into()).unwrap();
            let _ = stx.send(id);
        });
        let second = srx.recv_timeout(Duration::from_secs(5)).expect("spawning waited on the stuck session");
        let mut seen = String::new();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while !seen.contains("second-2") && std::time::Instant::now() < deadline {
            if let Ok(d) = rx.recv_timeout(Duration::from_millis(200)) {
                seen.push_str(&d);
            }
        }
        assert!(seen.contains("second-2"), "output was: {seen:?}");
        pty_kill(second).unwrap();
        pty_kill(stuck).unwrap();
    }

    #[test]
    fn every_windows_profile_builds_its_command_line() {
        let all = windows_profiles(false, Some(r"C:\Git\bin\bash.exe".into()), true);
        let ids: Vec<&str> = all.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["powershell", "cmd", "gitbash", "wsl"]);
        let line = |id: &str, cwd: &str| {
            let p = all.iter().find(|p| p.id == id).unwrap();
            let (prog, args, dir) = plan(p, cwd, r"C:\Users\me", true);
            (prog, args.join(" "), dir)
        };
        let (prog, args, _) = line("powershell", "");
        assert_eq!(prog, "powershell.exe");
        assert!(args.starts_with("-ExecutionPolicy RemoteSigned -NoLogo -NoExit -Command [Console]::InputEncoding"), "{args}");
        assert_eq!(line("cmd", "").1, "/K chcp 65001 >nul");
        let (prog, args, _) = line("gitbash", "");
        assert_eq!((prog.as_str(), args.as_str()), (r"C:\Git\bin\bash.exe", "--login -i"));
        assert_eq!(line("wsl", "").1, "");
        assert_eq!(line("wsl", r"\\wsl.localhost\Ubuntu\home\me\p").1, "-d Ubuntu --cd /home/me/p");
        // pwsh replaces Windows PowerShell when installed, and is UTF-8 already
        let pwsh = &windows_profiles(true, None, false)[0];
        assert_eq!((pwsh.id.as_str(), pwsh.program.as_str()), ("pwsh", "pwsh.exe"));
        assert_eq!(plan(pwsh, "", "h", true).1.join(" "), "-ExecutionPolicy RemoteSigned -NoLogo");
    }

    /// A shell on a real pty; output collected for `expect`.
    #[cfg(unix)]
    struct Shell {
        id: u32,
        out: mpsc::Receiver<String>,
        exit: mpsc::Receiver<Option<u32>>,
        seen: String,
    }

    #[cfg(unix)]
    impl Shell {
        fn start(args: &[&str], cols: u16, rows: u16) -> Shell {
            let sh = profile("sh", "sh", "/bin/sh", args);
            let (tx, out) = mpsc::channel::<String>();
            let (etx, exit) = mpsc::channel::<Option<u32>>();
            let id = spawn_raw("test", &sh, "", cols, rows, true, move |_, d| { let _ = tx.send(d); }, move |_, c| { let _ = etx.send(c); }).unwrap();
            Shell { id, out, exit, seen: String::new() }
        }
        fn send(&self, s: &str) {
            pty_write(self.id, s.into()).unwrap();
        }
        /// Wait for `needle` in the output, consuming up to it; returns how long it took.
        fn expect(&mut self, needle: &str) -> Duration {
            self.until(needle).1
        }
        /// Same, also returning the output before `needle`.
        fn until(&mut self, needle: &str) -> (String, Duration) {
            let t0 = std::time::Instant::now();
            while !self.seen.contains(needle) && t0.elapsed() < Duration::from_secs(10) {
                if let Ok(d) = self.out.recv_timeout(Duration::from_millis(100)) {
                    self.seen.push_str(&d);
                }
            }
            let tail: String = self.seen.chars().rev().take(300).collect::<Vec<_>>().into_iter().rev().collect();
            assert!(self.seen.contains(needle), "no {needle:?} in ...{tail:?}");
            let at = self.seen.find(needle).unwrap();
            let before = self.seen[..at].to_string();
            self.seen.drain(..at + needle.len());
            (before, t0.elapsed())
        }
    }

    #[cfg(unix)]
    #[test]
    fn the_shell_gets_the_requested_size_and_every_resize() {
        let mut sh = Shell::start(&[], 100, 30);
        sh.send("echo size=$(stty size)\n");
        sh.expect("size=30 100");
        pty_resize(sh.id, 120, 40).unwrap();
        sh.send("echo size=$(stty size)\n");
        sh.expect("size=40 120");
        pty_kill(sh.id).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn input_ctrl_c_unicode_paste_and_ctrl_d() {
        let mut sh = Shell::start(&[], 80, 24);
        sh.send("echo in-$((2*21))\n");
        sh.expect("in-42");
        sh.send("sleep 30\n");
        std::thread::sleep(Duration::from_millis(300));
        sh.send("\x03"); // Ctrl+C interrupts the foreground program, not the shell
        sh.send("echo after-int\n");
        assert!(sh.expect("after-int\r\n") < Duration::from_secs(5));
        sh.send("echo 'héllo ✓ 日本'\n");
        sh.expect("héllo ✓ 日本\r\n");
        sh.send("echo paste-1\necho paste-2\n"); // a multi-line paste runs each line
        sh.expect("paste-1\r\n");
        sh.expect("paste-2\r\n");
        sh.send("\x04"); // Ctrl+D at an empty prompt ends the shell
        assert_eq!(sh.exit.recv_timeout(Duration::from_secs(10)).unwrap(), Some(0));
    }

    #[cfg(unix)]
    #[test]
    fn ten_thousand_lines_and_a_long_line_arrive_whole() {
        let mut sh = Shell::start(&[], 80, 24);
        sh.send("seq 1 10000; echo seq-done\n");
        assert!(sh.expect("\r\n10000\r\nseq-done") < Duration::from_secs(5));
        sh.send("printf 'x%.0s' $(seq 1 5000); echo ' long-done'\n");
        sh.expect(&"x".repeat(5000)); // one 5000-column line, unbroken (xterm wraps it)
        sh.expect(" long-done");
        pty_kill(sh.id).unwrap();
    }

    /// Output nobody drains (the view's reader is stuck) must not stop other terminals starting.
    #[cfg(unix)]
    #[test]
    fn spawning_while_another_terminal_floods_is_fast() {
        let flood = profile("sh", "sh", "/bin/sh", &["-c", "yes flood"]);
        let (block_tx, block_rx) = mpsc::channel::<()>();
        let block_rx = Mutex::new(block_rx);
        let flooding = spawn_raw("test", &flood, "", 80, 24, true, move |_, _| { let _ = block_rx.lock().unwrap().recv(); }, |_, _| {}).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        let t0 = std::time::Instant::now();
        let mut sh = Shell::start(&[], 80, 24);
        sh.send("echo second\n");
        sh.expect("second");
        assert!(t0.elapsed() < Duration::from_secs(3), "took {:?}", t0.elapsed());
        pty_kill(sh.id).unwrap();
        pty_kill(flooding).unwrap();
        drop(block_tx);
    }

    #[cfg(unix)]
    fn alive(pid: i32) -> bool {
        std::fs::read_to_string(format!("/proc/{pid}/stat"))
            .map(|s| !s.rsplit(')').next().unwrap_or("").trim_start().starts_with('Z'))
            .unwrap_or(false)
    }

    /// Kill ends what the shell started too (claude.exe under PowerShell, on Windows).
    #[cfg(unix)]
    #[test]
    fn kill_ends_the_whole_process_tree() {
        // the child ignores SIGHUP, as a detached dev server or TUI may: only a real kill ends it
        let mut sh = Shell::start(&["-c", "trap '' HUP; sleep 271 & echo pid=$!.; wait"], 80, 24);
        sh.expect("pid=");
        let kids = vec![sh.until(".").0.parse::<i32>().unwrap()];
        assert!(alive(kids[0]), "the child did not start");
        pty_kill(sh.id).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while kids.iter().any(|p| alive(*p)) && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(!kids.iter().any(|p| alive(*p)), "children outlived the kill: {kids:?}");
        assert!(sh.exit.recv_timeout(Duration::from_secs(5)).is_ok(), "exit reported");
    }

    #[cfg(unix)]
    #[test]
    fn a_window_closing_ends_its_terminals_only() {
        let sh = profile("sh", "sh", "/bin/sh", &[]);
        let (etx, erx) = mpsc::channel::<u32>();
        let e2 = etx.clone();
        let a = spawn_raw("win-a", &sh, "", 80, 24, true, |_, _| {}, move |id, _| { let _ = etx.send(id); }).unwrap();
        let b = spawn_raw("win-b", &sh, "", 80, 24, true, |_, _| {}, move |id, _| { let _ = e2.send(id); }).unwrap();
        kill_window("win-a");
        assert_eq!(erx.recv_timeout(Duration::from_secs(5)).unwrap(), a);
        assert!(pty_write(b, "\n".into()).is_ok(), "the other window's terminal still runs");
        pty_kill(b).unwrap();
    }
}
