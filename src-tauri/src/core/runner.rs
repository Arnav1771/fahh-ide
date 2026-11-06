use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tracing::{debug, info, warn};

#[cfg(not(target_os = "windows"))]
use libc;

/// Maps file extensions to language identifiers.
fn extension_to_language(ext: &str) -> Option<&'static str> {
    let map: &[(&str, &str)] = &[
        ("py", "python"),
        ("js", "javascript"),
        ("mjs", "javascript"),
        ("cjs", "javascript"),
        ("jsx", "javascript"),
        ("ts", "typescript"),
        ("tsx", "typescript"),
        ("mts", "typescript"),
        ("go", "go"),
        ("rs", "rust"),
        ("java", "java"),
        ("kt", "kotlin"),
        ("cpp", "cpp"),
        ("cc", "cpp"),
        ("cxx", "cpp"),
        ("c", "c"),
        ("h", "c"),
        ("hpp", "cpp"),
        ("rb", "ruby"),
        ("php", "php"),
        ("sh", "shell"),
        ("bash", "shell"),
        ("zsh", "shell"),
        ("lua", "lua"),
        ("pl", "perl"),
        ("r", "r"),
        ("swift", "swift"),
        ("cs", "csharp"),
        ("fs", "fsharp"),
        ("zig", "zig"),
        ("nim", "nim"),
        ("v", "vlang"),
        ("ex", "elixir"),
        ("exs", "elixir"),
        ("erl", "erlang"),
        ("hs", "haskell"),
        ("scala", "scala"),
        ("clj", "clojure"),
        ("dart", "dart"),
    ];
    map.iter().find(|(e, _)| *e == ext).map(|(_, lang)| *lang)
}

/// Configuration for a run request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunConfig {
    /// Absolute path to the file to run.
    pub path: String,
    /// Language override. If empty/None, detected from extension.
    pub language: Option<String>,
    /// Extra arguments passed to the program (not the runner).
    /// Optional: the frontend usually sends only `{ path, language }`.
    #[serde(default)]
    pub args: Vec<String>,
    /// Working directory; defaults to parent directory of the file.
    #[serde(default)]
    pub cwd: Option<String>,
    /// Python to use for `python` / `kernel` runs (from `python_interpreter`); PATH when absent.
    #[serde(default)]
    pub interpreter: Option<String>,
}

/// Result returned once a run completes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunResult {
    pub pid: u32,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub duration_ms: u64,
}

/// Payload emitted for each line of output during streaming.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct OutputLine {
    line: String,
    stream: String, // "stdout" | "stderr"
}

/// Wraps the command + args needed to invoke a language runner.
struct RunCommand {
    program: String,
    args: Vec<String>,
}

/// Determine the run command for a given language and file.
/// `wsl` builds the command for a Linux shell inside WSL (file_path is then a Linux path),
/// whatever the host OS is.
/// `interpreter` is the Python the frontend resolved (see `pick_python`); ignored inside WSL.
fn build_run_command(language: &str, file_path: &str, user_args: &[String], wsl: bool, interpreter: Option<&str>) -> Result<RunCommand, String> {
    let path = std::path::Path::new(file_path);
    let windows = cfg!(target_os = "windows") && !wsl;
    let file_str = file_path.to_string();
    // ponytail: a venv inside a WSL folder is not looked up yet; WSL runs use python3 from PATH.
    let python = || match interpreter {
        _ if wsl => "python3".to_string(),
        Some(p) if !p.trim().is_empty() => p.to_string(),
        _ => resolve_python(),
    };

    let cmd = match language {
        "python" => {
            let mut args = vec!["-u".to_string(), file_str];
            args.extend_from_slice(user_args);
            RunCommand { program: python(), args }
        }
        "kernel" => {
            if wsl {
                return Err("Running notebooks inside WSL is not supported yet. Open the folder from Windows or run it in a WSL terminal.".into());
            }
            RunCommand { program: python(), args: vec!["-u".into(), kernel_script()?, file_str] }
        }
        "javascript" => {
            let mut args = vec![file_str];
            args.extend_from_slice(user_args);
            RunCommand { program: "node".to_string(), args }
        }
        "typescript" => {
            // Prefer ts-node if available; otherwise use npx tsx.
            if !wsl && which_exists("ts-node") {
                let mut args = vec![file_str];
                args.extend_from_slice(user_args);
                RunCommand { program: "ts-node".to_string(), args }
            } else {
                let mut args = vec!["tsx".to_string(), file_str];
                args.extend_from_slice(user_args);
                RunCommand { program: "npx".to_string(), args }
            }
        }
        "go" => {
            let mut args = vec!["run".to_string(), file_str];
            args.extend_from_slice(user_args);
            RunCommand { program: "go".to_string(), args }
        }
        "rust" => {
            // `cargo run` requires the workspace root; just forward user args.
            let mut args = vec!["run".to_string(), "--".to_string()];
            args.extend_from_slice(user_args);
            RunCommand { program: "cargo".to_string(), args }
        }
        "java" => {
            // Compile then run. We produce a compound shell command string that
            // get split by the caller; here we embed the class name.
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .ok_or_else(|| "Cannot determine Java class name".to_string())?;
            let parent = path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            // We embed multiple commands via shell.
            let mut run_args = vec![stem.to_string()];
            run_args.extend_from_slice(user_args);
            // Use a shell wrapper: javac <file> && java -cp <dir> <class> [args]
            let joined_user = shell_quote_args(user_args);
            let shell_cmd = format!(
                "javac \"{file_path}\" && java -cp \"{parent}\" {stem} {joined_user}"
            );
            if windows {
                RunCommand {
                    program: "cmd".to_string(),
                    args: vec!["/C".to_string(), shell_cmd],
                }
            } else {
                RunCommand {
                    program: "sh".to_string(),
                    args: vec!["-c".to_string(), shell_cmd],
                }
            }
        }
        "cpp" | "c" => {
            // Compile with g++ (c uses gcc) then execute the output binary.
            let compiler = if language == "c" { "gcc" } else { "g++" };
            let out_bin = if windows {
                format!("{}.exe", file_path)
            } else {
                format!("{}.out", file_path)
            };
            let joined_user = shell_quote_args(user_args);
            let shell_cmd = format!(
                "{compiler} -o \"{out_bin}\" \"{file_path}\" && \"{out_bin}\" {joined_user}"
            );
            if windows {
                RunCommand {
                    program: "cmd".to_string(),
                    args: vec!["/C".to_string(), shell_cmd],
                }
            } else {
                RunCommand {
                    program: "sh".to_string(),
                    args: vec!["-c".to_string(), shell_cmd],
                }
            }
        }
        "ruby" => {
            let mut args = vec![file_str];
            args.extend_from_slice(user_args);
            RunCommand { program: "ruby".to_string(), args }
        }
        "php" => {
            let mut args = vec![file_str];
            args.extend_from_slice(user_args);
            RunCommand { program: "php".to_string(), args }
        }
        "shell" => {
            let mut args = vec![file_str];
            args.extend_from_slice(user_args);
            RunCommand { program: "sh".to_string(), args }
        }
        "lua" => {
            let mut args = vec![file_str];
            args.extend_from_slice(user_args);
            RunCommand { program: "lua".to_string(), args }
        }
        "perl" => {
            let mut args = vec![file_str];
            args.extend_from_slice(user_args);
            RunCommand { program: "perl".to_string(), args }
        }
        "r" => {
            let mut args = vec!["--no-save".to_string(), "--no-restore".to_string(), "<".to_string(), file_str];
            args.extend_from_slice(user_args);
            RunCommand { program: "Rscript".to_string(), args }
        }
        "dart" => {
            let mut args = vec!["run".to_string(), file_str];
            args.extend_from_slice(user_args);
            RunCommand { program: "dart".to_string(), args }
        }
        "kotlin" => {
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .ok_or_else(|| "Cannot determine Kotlin class name".to_string())?;
            let parent = path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let jar_path = format!("{}/{}.jar", parent, stem);
            let joined_user = shell_quote_args(user_args);
            let shell_cmd = format!(
                "kotlinc \"{file_path}\" -include-runtime -d \"{jar_path}\" && java -jar \"{jar_path}\" {joined_user}"
            );
            if windows {
                RunCommand {
                    program: "cmd".to_string(),
                    args: vec!["/C".to_string(), shell_cmd],
                }
            } else {
                RunCommand {
                    program: "sh".to_string(),
                    args: vec!["-c".to_string(), shell_cmd],
                }
            }
        }
        "elixir" => {
            let mut args = vec![file_str];
            args.extend_from_slice(user_args);
            RunCommand { program: "elixir".to_string(), args }
        }
        "haskell" => {
            let mut args = vec!["--make".to_string(), file_str];
            args.extend_from_slice(user_args);
            RunCommand { program: "runghc".to_string(), args }
        }
        "zig" => {
            let mut args = vec!["run".to_string(), file_str];
            args.extend_from_slice(user_args);
            RunCommand { program: "zig".to_string(), args }
        }
        other => {
            return Err(format!("Unsupported language: {other}"));
        }
    };
    Ok(cmd)
}

/// The notebook kernel runner (see assets/fahh_kernel.py), written next to the temp dir once per version.
fn kernel_script() -> Result<String, String> {
    const SCRIPT: &str = include_str!("../../assets/fahh_kernel.py");
    let path = std::env::temp_dir().join(format!("fahh_kernel_{}.py", env!("CARGO_PKG_VERSION")));
    if std::fs::read_to_string(&path).ok().as_deref() != Some(SCRIPT) {
        std::fs::write(&path, SCRIPT).map_err(|e| format!("Could not write the notebook runner to {}: {e}", path.display()))?;
    }
    Ok(path.to_string_lossy().into_owned())
}

lazy_static::lazy_static! {
    /// stdin of `kernel` runs, by pid: the notebook sends its commands there.
    static ref KERNEL_STDIN: Mutex<HashMap<u32, std::process::ChildStdin>> = Mutex::new(HashMap::new());
}

/// Send one line to a running notebook kernel (see assets/fahh_kernel.py for the commands).
#[tauri::command]
pub fn run_stdin(pid: u32, line: String) -> Result<(), String> {
    use std::io::Write;
    let mut map = KERNEL_STDIN.lock().map_err(|e| e.to_string())?;
    let stdin = map.get_mut(&pid).ok_or("The notebook kernel is not running.")?;
    writeln!(stdin, "{}", line.trim_end()).and_then(|_| stdin.flush()).map_err(|e| format!("The notebook kernel stopped: {e}"))
}

/// The Python a run, a debug session or a notebook uses, and its short label for the UI.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PythonInterpreter {
    pub program: String,
    /// "setting", ".venv", "venv", or the PATH program name.
    pub label: String,
}

/// VS Code's order: the user's setting, then `<root>/.venv` or `<root>/venv`
/// (`Scripts\python.exe` on Windows, `bin/python` elsewhere), then Python on PATH.
/// Pure: the file check and the PATH lookup are passed in, so both layouts are tested anywhere.
pub(crate) fn pick_python(
    setting: &str,
    root: Option<&str>,
    windows: bool,
    exists: impl Fn(&str) -> bool,
    on_path: impl FnOnce() -> String,
) -> PythonInterpreter {
    let setting = setting.trim();
    if !setting.is_empty() {
        return PythonInterpreter { program: setting.to_string(), label: "setting".into() };
    }
    if let Some(root) = root.map(|r| r.trim_end_matches(['/', '\\'])).filter(|r| !r.is_empty()) {
        for venv in [".venv", "venv"] {
            let p = if windows { format!("{root}\\{venv}\\Scripts\\python.exe") } else { format!("{root}/{venv}/bin/python") };
            if exists(&p) {
                return PythonInterpreter { program: p, label: venv.into() };
            }
        }
    }
    let program = on_path();
    PythonInterpreter { label: program.clone(), program }
}

/// The workspace's Python (see `pick_python`).
#[tauri::command]
pub fn python_interpreter(root: Option<String>, setting: Option<String>) -> PythonInterpreter {
    pick_python(
        setting.as_deref().unwrap_or(""),
        root.as_deref(),
        cfg!(target_os = "windows"),
        |p| std::path::Path::new(p).is_file(),
        resolve_python,
    )
}

/// One Python environment for the notebook kernel picker.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PythonEnv {
    pub program: String,
    /// "Python 3.11 · .venv (workspace)"
    pub label: String,
    /// "workspace", "conda" or "global"; the picker groups by it.
    pub group: String,
    pub version: String,
    /// Without ipykernel the notebook offers the pip command instead of running.
    pub ipykernel: bool,
}

/// Interpreter paths from `py -0p` (Windows launcher): ` -V:3.12 *   C:\Python312\python.exe`.
fn parse_py_list(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|l| l.find(":\\").map(|i| l[i.saturating_sub(1)..].trim().to_string()))
        .filter(|p| p.to_ascii_lowercase().ends_with(".exe"))
        .collect()
}

/// (python, env name) for each env of `conda env list --json`; the root prefix is "base".
fn parse_conda_envs(json: &str, windows: bool) -> Vec<(String, String)> {
    let envs = serde_json::from_str::<serde_json::Value>(json).ok().and_then(|v| v["envs"].as_array().cloned()).unwrap_or_default();
    envs.iter()
        .filter_map(|e| e.as_str())
        .map(|prefix| {
            let parts: Vec<&str> = prefix.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
            let name = match parts.as_slice() {
                [.., "envs", n] => n.to_string(),
                _ => "base".to_string(),
            };
            let sep = if windows { "\\" } else { "/" };
            let py = if windows { format!("{prefix}{sep}python.exe") } else { format!("{prefix}{sep}bin{sep}python") };
            (py, name)
        })
        .collect()
}

/// What the probe script prints: sys.executable, the version, and whether ipykernel imports.
fn parse_probe(out: &str) -> Option<(String, String, bool)> {
    let mut l = out.lines().map(str::trim);
    Some((l.next()?.to_string(), l.next()?.to_string(), l.next()? == "True"))
}

fn env_label(version: &str, name: &str, group: &str) -> String {
    let minor: String = version.split('.').take(2).collect::<Vec<_>>().join(".");
    format!("Python {minor} · {name} ({group})")
}

const PROBE: &str = "import sys,importlib.util as u;print(sys.executable);print('%d.%d.%d'%sys.version_info[:3]);print(u.find_spec('ipykernel') is not None)";

fn output_of(program: &str, args: &[&str]) -> Option<String> {
    let out = crate::core::proc::cmd(program).args(args).stdin(Stdio::null()).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Python environments for the notebook kernel picker: the folder's .venv / venv, conda envs,
/// then `py -0p` and python / python3 on PATH. Each is probed once (version, ipykernel), in parallel.
#[tauri::command]
pub async fn python_kernels(root: Option<String>) -> Vec<PythonEnv> {
    tauri::async_runtime::spawn_blocking(move || {
        let windows = cfg!(target_os = "windows");
        let mut cands: Vec<(String, String, &'static str)> = Vec::new();
        for venv in [".venv", "venv"] {
            let ws = pick_python("", root.as_deref(), windows, |p| p.contains(venv) && std::path::Path::new(p).is_file(), String::new);
            if ws.label == venv {
                cands.push((ws.program, venv.into(), "workspace"));
            }
        }
        if which_exists("conda") {
            for (py, name) in parse_conda_envs(&output_of("conda", &["env", "list", "--json"]).unwrap_or_default(), windows) {
                cands.push((py, name, "conda"));
            }
        }
        if windows {
            for py in parse_py_list(&output_of("py", &["-0p"]).unwrap_or_default()) {
                let name = std::path::Path::new(&py).parent().and_then(|d| d.file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "py".into());
                cands.push((py, name, "global"));
            }
        }
        for name in ["python", "python3"] {
            if let Ok(p) = which::which(name) {
                if !p.to_string_lossy().contains("WindowsApps") {
                    cands.push((p.to_string_lossy().into_owned(), name.into(), "global"));
                }
            }
        }
        // ponytail: no per-probe timeout; a hung interpreter stalls only the picker's list.
        let probes: Vec<_> = cands
            .into_iter()
            .map(|(py, name, group)| std::thread::spawn(move || (output_of(&py, &["-c", PROBE]).as_deref().and_then(parse_probe), py, name, group)))
            .collect();
        let mut seen = std::collections::HashSet::new();
        probes
            .into_iter()
            .filter_map(|h| h.join().ok())
            .filter_map(|(probe, py, name, group)| {
                let (exe, version, ipykernel) = probe?;
                seen.insert(exe.to_lowercase()).then(|| PythonEnv { label: env_label(&version, &name, group), program: py, group: group.into(), version, ipykernel })
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// Resolves the real Python executable, avoiding dummy WindowsApps stubs on Windows.
pub(crate) fn resolve_python() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(p) = which::which("python") {
            let s = p.to_string_lossy();
            if !s.contains("WindowsApps") {
                return "python".to_string();
            }
        }
        if let Ok(p) = which::which("py") {
            let s = p.to_string_lossy();
            if !s.contains("WindowsApps") {
                return "py".to_string();
            }
        }
        "python".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        if which_exists("python3") {
            "python3".to_string()
        } else {
            "python".to_string()
        }
    }
}

/// Returns true if a given program name exists on PATH.
pub(crate) fn which_exists(name: &str) -> bool {
    which::which(name).is_ok()
}

/// Joins args with spaces, adding double-quotes around each.
/// The bash script for a command built with `wsl: true`: `sh -c <script>` passes its
/// script through, anything else is quoted word by word.
fn wsl_script(run_cmd: &RunCommand) -> String {
    if run_cmd.program == "sh" && run_cmd.args.first().map(String::as_str) == Some("-c") {
        return run_cmd.args.get(1).cloned().unwrap_or_default();
    }
    std::iter::once(&run_cmd.program)
        .chain(run_cmd.args.iter())
        .map(|a| crate::core::wsl::sh_quote(a))
        .collect::<Vec<_>>()
        .join(" ")
}

fn shell_quote_args(args: &[String]) -> String {
    args.iter()
        .map(|a| format!("\"{}\"", a.replace('"', "\\\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

/// State holding PIDs of currently-running child processes so they can be killed.
#[derive(Default)]
pub struct RunnerState {
    /// Maps a process PID to a flag indicating whether stop was requested.
    pub running: Mutex<HashMap<u32, bool>>,
}

/// Run a file and stream output back to the frontend.
#[tauri::command]
pub async fn run_file(app: AppHandle, config: RunConfig) -> Result<RunResult, String> {
    let path = std::path::Path::new(&config.path);

    // Detect language from extension if not explicitly provided.
    let language = match &config.language {
        Some(lang) if !lang.is_empty() => lang.clone(),
        _ => {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");
            extension_to_language(ext)
                .ok_or_else(|| format!("Cannot detect language for extension: {ext}"))?
                .to_string()
        }
    };

    // Resolve working directory.
    let cwd = match &config.cwd {
        Some(c) if !c.is_empty() => c.clone(),
        _ => path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string()),
    };

    info!("run_file: language={language}, file={}, cwd={cwd}", config.path);

    // A file inside WSL (\\wsl.localhost\<distro>\...) cannot run with a UNC working
    // directory on Windows (os error 267): run it inside the distro instead.
    let wsl_target = if cfg!(target_os = "windows") { crate::core::wsl::parse(&config.path) } else { None };
    let (mut command, program) = match &wsl_target {
        Some(wp) => {
            let linux_cwd = crate::core::wsl::parse(&cwd)
                .filter(|c| c.distro == wp.distro)
                .map(|c| c.linux)
                .unwrap_or_else(|| wp.linux.rsplit_once('/').map(|(d, _)| if d.is_empty() { "/".to_string() } else { d.to_string() }).unwrap_or_else(|| "/".to_string()));
            let run_cmd = build_run_command(&language, &wp.linux, &config.args, true, None)?;
            let script = wsl_script(&run_cmd);
            debug!("Executing in WSL {}: {script}", wp.distro);
            (crate::core::wsl::command(Some(&wp.distro), &linux_cwd, &script), format!("{} (WSL {})", run_cmd.program, wp.distro))
        }
        None => {
            let run_cmd = build_run_command(&language, &config.path, &config.args, false, config.interpreter.as_deref())?;
            debug!("Executing: {} {:?}", run_cmd.program, run_cmd.args);
            let mut c = crate::core::proc::cmd(&run_cmd.program);
            c.args(&run_cmd.args).current_dir(&cwd);
            (c, run_cmd.program)
        }
    };

    let mut child = command
        .stdin(if language == "kernel" { Stdio::piped() } else { Stdio::inherit() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn process `{program}`: {e}"))?;

    let pid = child.id();
    if let Some(stdin) = child.stdin.take() {
        KERNEL_STDIN.lock().map_err(|e| e.to_string())?.insert(pid, stdin);
    }
    info!("Spawned child PID={pid}");

    let start = Instant::now();

    // Collect stdout lines, emitting each to the frontend.
    let stdout_pipe = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture stdout".to_string())?;
    let stderr_pipe = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture stderr".to_string())?;

    let app_stdout = app.clone();
    let app_stderr = app.clone();

    let stdout_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stdout_pipe);
        let mut collected = String::new();
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    collected.push_str(&l);
                    collected.push('\n');
                    let _ = app_stdout.emit(
                        "runner://output",
                        serde_json::json!({ "line": l, "stream": "stdout", "pid": pid }),
                    );
                }
                Err(e) => {
                    warn!("stdout read error: {e}");
                    break;
                }
            }
        }
        collected
    });

    let stderr_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stderr_pipe);
        let mut collected = String::new();
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    collected.push_str(&l);
                    collected.push('\n');
                    let _ = app_stderr.emit(
                        "runner://output",
                        serde_json::json!({ "line": l, "stream": "stderr", "pid": pid }),
                    );
                }
                Err(e) => {
                    warn!("stderr read error: {e}");
                    break;
                }
            }
        }
        collected
    });

    let app_exit = app.clone();
    std::thread::spawn(move || {
        let _stdout = stdout_handle.join().unwrap_or_default();
        let _stderr = stderr_handle.join().unwrap_or_default();
        if let Ok(mut map) = KERNEL_STDIN.lock() {
            map.remove(&pid);
        }
        
        let status = child.wait().expect("Failed to wait on child");
        let duration_ms = start.elapsed().as_millis() as u64;
        let exit_code = status.code().unwrap_or(-1);

        info!("run_file: PID={pid} exited with code={exit_code}, duration={duration_ms}ms");

        let _ = app_exit.emit(
            "runner://exit",
            serde_json::json!({
                "pid": pid,
                "exit_code": exit_code,
                "duration_ms": duration_ms
            })
        );
    });

    Ok(RunResult {
        pid,
        stdout: String::new(),
        stderr: String::new(),
        exit_code: 0,
        duration_ms: 0,
    })
}

/// Kill a running process by its PID.
#[tauri::command]
pub fn stop_run(pid: u32) -> Result<(), String> {
    info!("stop_run: killing PID={pid}");
    kill_pid(pid)
}

/// Platform-specific process termination.
fn kill_pid(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let status = crate::core::proc::cmd("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .status()
            .map_err(|e| format!("taskkill failed: {e}"))?;
        if !status.success() {
            return Err(format!("taskkill exited with: {:?}", status.code()));
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        // SIGTERM first; if the process doesn't heed it the user can call again.
        let result = unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
        if result != 0 {
            return Err(format!("kill({pid}, SIGTERM) failed: errno={}", std::io::Error::last_os_error()));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_maps_to_language() {
        assert_eq!(extension_to_language("py"), Some("python"));
        assert_eq!(extension_to_language("rs"), Some("rust"));
        assert_eq!(extension_to_language("tsx"), Some("typescript"));
        assert_eq!(extension_to_language("nope"), None);
    }

    #[test]
    fn run_config_deserializes_frontend_payload() {
        // The RunPanel sends only { path, language }. args/cwd must default.
        let cfg: RunConfig =
            serde_json::from_str(r#"{"path":"/tmp/x.py","language":"python"}"#).unwrap();
        assert_eq!(cfg.path, "/tmp/x.py");
        assert_eq!(cfg.language.as_deref(), Some("python"));
        assert!(cfg.args.is_empty());
        assert!(cfg.cwd.is_none());
    }

    fn pick(setting: &str, root: Option<&str>, windows: bool, present: &[&str]) -> PythonInterpreter {
        pick_python(setting, root, windows, |p| present.contains(&p), || "python3".to_string())
    }

    #[test]
    fn python_prefers_setting_then_venv_then_path() {
        let all = ["/w/.venv/bin/python", "/w/venv/bin/python"];
        assert_eq!(pick("/opt/py/bin/python", Some("/w"), false, &all), PythonInterpreter { program: "/opt/py/bin/python".into(), label: "setting".into() });
        assert_eq!(pick("  ", Some("/w"), false, &all), PythonInterpreter { program: "/w/.venv/bin/python".into(), label: ".venv".into() });
        assert_eq!(pick("", Some("/w/"), false, &all[1..]), PythonInterpreter { program: "/w/venv/bin/python".into(), label: "venv".into() });
        assert_eq!(pick("", Some("/w"), false, &[]), PythonInterpreter { program: "python3".into(), label: "python3".into() });
        assert_eq!(pick("", None, false, &all).label, "python3");
    }

    #[test]
    fn python_venv_uses_windows_layout() {
        let win = [r"C:\proj\.venv\Scripts\python.exe"];
        assert_eq!(pick("", Some(r"C:\proj\"), true, &win).program, win[0]);
        // A Unix-layout venv does not count on Windows, and vice versa.
        assert_eq!(pick("", Some(r"C:\proj"), true, &["C:\\proj/.venv/bin/python"]).label, "python3");
        assert_eq!(pick("", Some("/w"), false, &[r"/w\.venv\Scripts\python.exe"]).label, "python3");
    }

    #[test]
    fn python_runs_use_the_resolved_interpreter() {
        let venv = "/w/.venv/bin/python";
        let cmd = build_run_command("python", "/w/a.py", &[], false, Some(venv)).unwrap();
        assert_eq!((cmd.program.as_str(), cmd.args), (venv, vec!["-u".to_string(), "/w/a.py".into()]));
        // Inside WSL the Windows-side pick does not apply.
        assert_eq!(build_run_command("python", "/w/a.py", &[], true, Some(venv)).unwrap().program, "python3");
    }

    #[test]
    fn kernel_runs_the_bundled_runner_with_the_interpreter() {
        let cmd = build_run_command("kernel", "/w/n.ipynb", &[], false, Some("/w/.venv/bin/python")).unwrap();
        assert_eq!(cmd.program, "/w/.venv/bin/python");
        assert_eq!(cmd.args[0], "-u");
        assert!(std::fs::read_to_string(&cmd.args[1]).unwrap().contains("jupyter_client"));
        assert_eq!(cmd.args[2], "/w/n.ipynb");
        assert!(build_run_command("kernel", "/w/n.ipynb", &[], true, None).is_err());
    }

    #[test]
    fn parses_py_launcher_list() {
        let text = " -V:3.12 *        C:\\Python312\\python.exe\r\n -V:3.11          C:\\Users\\A B\\AppData\\Local\\Programs\\Python\\Python311\\python.exe\r\n -3.9-64          D:\\py39\\python.exe\r\n";
        assert_eq!(parse_py_list(text), vec![
            r"C:\Python312\python.exe".to_string(),
            r"C:\Users\A B\AppData\Local\Programs\Python\Python311\python.exe".into(),
            r"D:\py39\python.exe".into(),
        ]);
        assert!(parse_py_list("No installed Pythons found!").is_empty());
    }

    #[test]
    fn parses_conda_envs_for_both_layouts() {
        let unix = r#"{"envs": ["/opt/conda", "/opt/conda/envs/ds"]}"#;
        assert_eq!(parse_conda_envs(unix, false), vec![
            ("/opt/conda/bin/python".to_string(), "base".to_string()),
            ("/opt/conda/envs/ds/bin/python".into(), "ds".into()),
        ]);
        let win = r#"{"envs": ["C:\\miniconda3\\envs\\ml"]}"#;
        assert_eq!(parse_conda_envs(win, true), vec![(r"C:\miniconda3\envs\ml\python.exe".to_string(), "ml".to_string())]);
        assert!(parse_conda_envs("not json", true).is_empty());
    }

    #[test]
    fn probe_output_and_labels() {
        assert_eq!(parse_probe("/w/.venv/bin/python\n3.11.4\nFalse\n"), Some(("/w/.venv/bin/python".into(), "3.11.4".into(), false)));
        assert!(parse_probe("C:\\p\\python.exe\r\n3.12.1\r\nTrue\r\n").unwrap().2);
        assert_eq!(parse_probe("garbage"), None);
        assert_eq!(env_label("3.11.4", ".venv", "workspace"), "Python 3.11 · .venv (workspace)");
    }

    #[test]
    fn run_config_ignores_unknown_env_field() {
        let cfg: RunConfig =
            serde_json::from_str(r#"{"path":"/a","language":"go","env":{"K":"V"}}"#).unwrap();
        assert_eq!(cfg.path, "/a");
    }
}
