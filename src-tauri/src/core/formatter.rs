use std::io::Write;
use std::process::{Command, Stdio};

use tracing::{debug, info, warn};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/// Run a formatter that reads from stdin and writes formatted output to stdout.
/// `program` and `args` describe the formatter invocation.
/// `input` is the file content to format.
/// Returns the formatted string, or an error if the formatter failed or produced
/// a non-zero exit code.
fn run_formatter_stdin(
    program: &str,
    args: &[&str],
    input: &str,
) -> Result<String, String> {
    debug!("formatter: running '{program}' {:?}", args);

    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn formatter '{program}': {e}"))?;

    // Write input to stdin.
    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "Failed to open formatter stdin".to_string())?;
        stdin
            .write_all(input.as_bytes())
            .map_err(|e| format!("Failed to write to formatter stdin: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Formatter '{program}' failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Formatter '{program}' exited with {:?}: {stderr}",
            output.status.code()
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Run a formatter that operates on a file path (not stdin) and returns
/// formatted output to stdout.
fn run_formatter_file(program: &str, args: &[&str]) -> Result<String, String> {
    debug!("formatter: running '{program}' {:?}", args);

    let output = Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to spawn formatter '{program}': {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Formatter '{program}' exited with {:?}: {stderr}",
            output.status.code()
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Check if a binary exists on PATH.
fn exists(name: &str) -> bool {
    which::which(name).is_ok()
}

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

/// Format the file at `path` using the appropriate formatter for `language`.
/// Returns the formatted content as a string. Falls back to the original file
/// content if no formatter is installed or the language is not supported.
#[tauri::command]
pub async fn format_file(path: String, language: String) -> Result<String, String> {
    info!("format_file: path={path}, language={language}");

    // Read the original content so we can fall back if needed.
    let original = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file '{path}': {e}"))?;

    match language.as_str() {
        // ------------------------------------------------------------------ Python
        "python" => {
            if exists("black") {
                // black --quiet - reads from stdin, writes to stdout.
                return run_formatter_stdin("black", &["--quiet", "-"], &original);
            }
            if exists("autopep8") {
                return run_formatter_stdin("autopep8", &["-"], &original);
            }
            if exists("yapf") {
                return run_formatter_stdin("yapf", &[], &original);
            }
            warn!("format_file: no Python formatter found (black/autopep8/yapf); returning original");
            Ok(original)
        }

        // ------------------------------------------------- JavaScript / TypeScript
        "javascript" | "typescript" | "jsx" | "tsx" => {
            // npx prettier --stdin-filepath <path> reads from stdin.
            if exists("prettier") {
                return run_formatter_stdin(
                    "prettier",
                    &["--stdin-filepath", &path],
                    &original,
                );
            }
            if exists("npx") {
                return run_formatter_stdin(
                    "npx",
                    &["--yes", "prettier", "--stdin-filepath", &path],
                    &original,
                );
            }
            warn!("format_file: no JS/TS formatter found (prettier); returning original");
            Ok(original)
        }

        // -------------------------------------------------------------------- JSON
        "json" => {
            // Prefer prettier; fall back to Python's json.tool.
            if exists("prettier") {
                return run_formatter_stdin(
                    "prettier",
                    &["--stdin-filepath", &path, "--parser", "json"],
                    &original,
                );
            }
            if exists("npx") {
                return run_formatter_stdin(
                    "npx",
                    &["--yes", "prettier", "--stdin-filepath", &path, "--parser", "json"],
                    &original,
                );
            }
            // Python's json.tool as a universal fallback.
            let python = if exists("python3") { "python3" } else { "python" };
            if exists(python) {
                return run_formatter_stdin(python, &["-m", "json.tool"], &original);
            }
            // Pure-Rust fallback: round-trip via serde_json.
            match serde_json::from_str::<serde_json::Value>(&original) {
                Ok(v) => serde_json::to_string_pretty(&v).map_err(|e| e.to_string()),
                Err(_) => Ok(original),
            }
        }

        // ---------------------------------------------------------------------- Go
        "go" => {
            if exists("gofmt") {
                return run_formatter_stdin("gofmt", &[], &original);
            }
            if exists("goimports") {
                return run_formatter_stdin("goimports", &[], &original);
            }
            warn!("format_file: no Go formatter found (gofmt/goimports); returning original");
            Ok(original)
        }

        // -------------------------------------------------------------------- Rust
        "rust" => {
            if exists("rustfmt") {
                // rustfmt --edition 2021 reads from stdin.
                return run_formatter_stdin(
                    "rustfmt",
                    &["--edition", "2021"],
                    &original,
                );
            }
            warn!("format_file: rustfmt not found; returning original");
            Ok(original)
        }

        // ------------------------------------------------------------------ C / C++
        "c" | "cpp" | "cxx" | "cc" => {
            if exists("clang-format") {
                // clang-format reads from stdin when given --assume-filename.
                return run_formatter_stdin(
                    "clang-format",
                    &["--assume-filename", &path],
                    &original,
                );
            }
            warn!("format_file: clang-format not found; returning original");
            Ok(original)
        }

        // -------------------------------------------------------------------- HTML
        "html" | "htm" => {
            if exists("prettier") {
                return run_formatter_stdin(
                    "prettier",
                    &["--stdin-filepath", &path, "--parser", "html"],
                    &original,
                );
            }
            if exists("npx") {
                return run_formatter_stdin(
                    "npx",
                    &["--yes", "prettier", "--stdin-filepath", &path, "--parser", "html"],
                    &original,
                );
            }
            warn!("format_file: no HTML formatter found; returning original");
            Ok(original)
        }

        // ----------------------------------------------------------------- CSS/SCSS
        "css" | "scss" | "less" => {
            if exists("prettier") {
                return run_formatter_stdin(
                    "prettier",
                    &["--stdin-filepath", &path],
                    &original,
                );
            }
            if exists("npx") {
                return run_formatter_stdin(
                    "npx",
                    &["--yes", "prettier", "--stdin-filepath", &path],
                    &original,
                );
            }
            warn!("format_file: no CSS formatter found; returning original");
            Ok(original)
        }

        // ------------------------------------------------------------------ Markdown
        "markdown" | "md" => {
            if exists("prettier") {
                return run_formatter_stdin(
                    "prettier",
                    &["--stdin-filepath", &path, "--parser", "markdown"],
                    &original,
                );
            }
            if exists("npx") {
                return run_formatter_stdin(
                    "npx",
                    &["--yes", "prettier", "--stdin-filepath", &path, "--parser", "markdown"],
                    &original,
                );
            }
            warn!("format_file: no Markdown formatter found; returning original");
            Ok(original)
        }

        // ------------------------------------------------------------------- YAML
        "yaml" | "yml" => {
            if exists("prettier") {
                return run_formatter_stdin(
                    "prettier",
                    &["--stdin-filepath", &path, "--parser", "yaml"],
                    &original,
                );
            }
            if exists("npx") {
                return run_formatter_stdin(
                    "npx",
                    &["--yes", "prettier", "--stdin-filepath", &path, "--parser", "yaml"],
                    &original,
                );
            }
            warn!("format_file: no YAML formatter found; returning original");
            Ok(original)
        }

        // -------------------------------------------------------------------- Ruby
        "ruby" => {
            if exists("rubocop") {
                return run_formatter_stdin(
                    "rubocop",
                    &["--auto-correct-all", "--stdin", &path, "--format", "quiet"],
                    &original,
                );
            }
            warn!("format_file: rubocop not found; returning original");
            Ok(original)
        }

        // ----------------------------------------------------------------- Kotlin
        "kotlin" | "kt" => {
            if exists("ktfmt") {
                return run_formatter_stdin("ktfmt", &["-"], &original);
            }
            if exists("ktlint") {
                // ktlint can format from stdin with --stdin flag.
                return run_formatter_stdin("ktlint", &["--stdin", "--format"], &original);
            }
            warn!("format_file: no Kotlin formatter found; returning original");
            Ok(original)
        }

        // ------------------------------------------------------------------- Java
        "java" => {
            if exists("google-java-format") {
                return run_formatter_stdin("google-java-format", &["-"], &original);
            }
            warn!("format_file: google-java-format not found; returning original");
            Ok(original)
        }

        // ------------------------------------------------------------------- Swift
        "swift" => {
            if exists("swift-format") {
                return run_formatter_stdin("swift-format", &[], &original);
            }
            warn!("format_file: swift-format not found; returning original");
            Ok(original)
        }

        // ------------------------------------------------------------------ Shell
        "shell" | "sh" | "bash" => {
            if exists("shfmt") {
                return run_formatter_stdin("shfmt", &["-i", "2", "-"], &original);
            }
            warn!("format_file: shfmt not found; returning original");
            Ok(original)
        }

        // ------------------------------------------------------------------- Lua
        "lua" => {
            if exists("stylua") {
                return run_formatter_stdin("stylua", &["-"], &original);
            }
            warn!("format_file: stylua not found; returning original");
            Ok(original)
        }

        // ------------------------------------------------------------------- Zig
        "zig" => {
            if exists("zig") {
                // `zig fmt` formats a file in-place and does not support stdin,
                // so we write to a temp file, format, and read back.
                let tmp_dir = std::env::temp_dir();
                let tmp_path = tmp_dir.join(format!(
                    "fahh_fmt_{}.zig",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_nanos())
                        .unwrap_or(0)
                ));
                std::fs::write(&tmp_path, &original)
                    .map_err(|e| format!("Failed to write temp file: {e}"))?;
                let status = Command::new("zig")
                    .args(["fmt", &tmp_path.to_string_lossy()])
                    .status()
                    .map_err(|e| format!("zig fmt failed: {e}"))?;
                let result = std::fs::read_to_string(&tmp_path)
                    .map_err(|e| format!("Failed to read formatted temp file: {e}"))?;
                let _ = std::fs::remove_file(&tmp_path);
                if !status.success() {
                    return Err(format!("zig fmt exited with: {:?}", status.code()));
                }
                return Ok(result);
            }
            warn!("format_file: zig not found; returning original");
            Ok(original)
        }

        // --- Unknown / unsupported language: return original unchanged.
        other => {
            warn!("format_file: no formatter configured for language '{other}'; returning original");
            Ok(original)
        }
    }
}
