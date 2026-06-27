use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
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
    pub file_path: String,
    /// Language override. If empty/None, detected from extension.
    pub language: Option<String>,
    /// Extra arguments passed to the program (not the runner).
    pub args: Vec<String>,
    /// Working directory; defaults to parent directory of the file.
    pub cwd: Option<String>,
}

/// Result returned once a run completes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunResult {
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
fn build_run_command(language: &str, file_path: &str, user_args: &[String]) -> Result<RunCommand, String> {
    let path = std::path::Path::new(file_path);
    let file_str = file_path.to_string();

    let mut cmd = match language {
        "python" => {
            // Prefer python3 if available, fall back to python.
            let python = if which_exists("python3") { "python3" } else { "python" };
            let mut args = vec![file_str];
            args.extend_from_slice(user_args);
            RunCommand { program: python.to_string(), args }
        }
        "javascript" => {
            let mut args = vec![file_str];
            args.extend_from_slice(user_args);
            RunCommand { program: "node".to_string(), args }
        }
        "typescript" => {
            // Prefer ts-node if available; otherwise use npx tsx.
            if which_exists("ts-node") {
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
            if cfg!(target_os = "windows") {
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
            let out_bin = if cfg!(target_os = "windows") {
                format!("{}.exe", file_path)
            } else {
                format!("{}.out", file_path)
            };
            let joined_user = shell_quote_args(user_args);
            let shell_cmd = format!(
                "{compiler} -o \"{out_bin}\" \"{file_path}\" && \"{out_bin}\" {joined_user}"
            );
            if cfg!(target_os = "windows") {
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
            if cfg!(target_os = "windows") {
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

/// Returns true if a given program name exists on PATH.
fn which_exists(name: &str) -> bool {
    which::which(name).is_ok()
}

/// Joins args with spaces, adding double-quotes around each.
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
    let path = std::path::Path::new(&config.file_path);

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

    info!("run_file: language={language}, file={}, cwd={cwd}", config.file_path);

    let run_cmd = build_run_command(&language, &config.file_path, &config.args)?;

    debug!("Executing: {} {:?}", run_cmd.program, run_cmd.args);

    let mut child = Command::new(&run_cmd.program)
        .args(&run_cmd.args)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn process `{}`: {e}", run_cmd.program))?;

    let pid = child.id();
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
                        serde_json::json!({ "line": l, "stream": "stdout" }),
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
                        serde_json::json!({ "line": l, "stream": "stderr" }),
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

    let status = child.wait().map_err(|e| format!("Failed to wait on child: {e}"))?;
    let duration_ms = start.elapsed().as_millis() as u64;

    let stdout = stdout_handle.join().unwrap_or_default();
    let stderr = stderr_handle.join().unwrap_or_default();
    let exit_code = status.code().unwrap_or(-1);

    info!("run_file: PID={pid} exited with code={exit_code}, duration={duration_ms}ms");

    Ok(RunResult {
        stdout,
        stderr,
        exit_code,
        duration_ms,
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
        let status = Command::new("taskkill")
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
