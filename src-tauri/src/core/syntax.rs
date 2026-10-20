//! Syntax errors for languages Monaco cannot lint by itself (Python, Rust).
//!
//! Without a language server, a broken `.py` or `.rs` file had no markers, so
//! it was never underlined and never fahhed. This is the fallback: Rust is
//! parsed in-process with `syn`; Python is compiled (never run) by the user's
//! own interpreter, so the verdict matches the Python they actually have.
//! Anything that cannot be checked yields no errors rather than a guess.

use std::io::Write;
use std::process::Stdio;

use serde::Serialize;
use tracing::debug;

use crate::core::{proc, runner};

/// One syntax error, 1-based lines and columns (Monaco's convention).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyntaxError {
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub message: String,
}

#[tauri::command]
pub async fn syntax_check(language: String, text: String) -> Result<Vec<SyntaxError>, String> {
    match language.as_str() {
        "rust" => Ok(rust_errors(&text)),
        "python" => tauri::async_runtime::spawn_blocking(move || python_errors(&text))
            .await
            .map_err(|e| e.to_string()),
        _ => Ok(Vec::new()),
    }
}

/// Every error `syn` reports for the file (it can report several at once).
pub fn rust_errors(text: &str) -> Vec<SyntaxError> {
    match syn::parse_file(text) {
        Ok(_) => Vec::new(),
        Err(err) => err
            .into_iter()
            .map(|e| {
                let (start, end) = (e.span().start(), e.span().end());
                let line = start.line.max(1) as u32;
                let column = start.column as u32 + 1;
                let (end_line, end_column) = if (end.line, end.column) > (start.line, start.column) {
                    (end.line as u32, end.column as u32 + 1)
                } else {
                    (line, column + 1)
                };
                SyntaxError { line, column, end_line, end_column, message: e.to_string() }
            })
            .collect(),
    }
}

// Compiles the source read from stdin without running it, and prints the first
// SyntaxError as JSON. `compile` also catches errors `ast.parse` misses, such as
// `return` outside a function.
const PY_CHECK: &str = "import sys, json\n\
src = sys.stdin.buffer.read()\n\
try:\n    compile(src, '<file>', 'exec', dont_inherit=True)\n\
except SyntaxError as e:\n    print(json.dumps([e.lineno, e.offset, getattr(e, 'end_lineno', None), getattr(e, 'end_offset', None), e.msg]))\n\
except (ValueError, OverflowError):\n    pass\n";

pub fn python_errors(text: &str) -> Vec<SyntaxError> {
    let spawned = proc::cmd(runner::resolve_python())
        .args(["-I", "-c", PY_CHECK])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => {
            debug!("python syntax check unavailable: {e}");
            return Vec::new();
        }
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(text.as_bytes());
    }
    let Ok(out) = child.wait_with_output() else { return Vec::new() };
    parse_python_report(&String::from_utf8_lossy(&out.stdout))
}

fn parse_python_report(stdout: &str) -> Vec<SyntaxError> {
    let Some(line) = stdout.lines().find(|l| l.starts_with('[')) else { return Vec::new() };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { return Vec::new() };
    let num = |i: usize| v.get(i).and_then(|x| x.as_u64()).map(|n| n as u32);
    let line_no = num(0).unwrap_or(1).max(1);
    let column = num(1).unwrap_or(1).max(1);
    let end_line = num(2).filter(|&l| l >= line_no).unwrap_or(line_no);
    let end_column = num(3)
        .filter(|&c| end_line > line_no || c > column)
        .unwrap_or(column + 1);
    let message = v.get(4).and_then(|m| m.as_str()).unwrap_or("invalid syntax").to_string();
    vec![SyntaxError { line: line_no, column, end_line, end_column, message }]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_rust_has_no_errors() {
        assert!(rust_errors("fn main() {\n    let x = 1;\n    println!(\"{x}\");\n}\n").is_empty());
    }

    #[test]
    fn broken_rust_reports_the_line() {
        let errs = rust_errors("fn main() {\n    let x = ;\n}\n");
        assert_eq!(errs.len(), 1);
        assert_eq!(errs[0].line, 2);
        assert!(errs[0].column >= 1);
        assert!(!errs[0].message.is_empty());
    }

    #[test]
    fn unclosed_rust_brace_is_an_error() {
        assert!(!rust_errors("fn main() {\n").is_empty());
    }

    #[test]
    fn python_report_is_parsed() {
        let errs = parse_python_report("[3, 5, 3, 9, \"invalid syntax\"]\n");
        assert_eq!(
            errs,
            vec![SyntaxError { line: 3, column: 5, end_line: 3, end_column: 9, message: "invalid syntax".into() }]
        );
    }

    #[test]
    fn python_report_without_end_gets_a_one_char_range() {
        let errs = parse_python_report("[2, 4, null, null, \"x\"]");
        assert_eq!((errs[0].end_line, errs[0].end_column), (2, 5));
    }

    #[test]
    fn no_report_means_no_errors() {
        assert!(parse_python_report("").is_empty());
        assert!(parse_python_report("garbage").is_empty());
    }

    #[cfg(not(windows))]
    #[test]
    fn real_python_finds_and_clears_errors() {
        if !runner::which_exists("python3") && !runner::which_exists("python") {
            return;
        }
        assert!(python_errors("def f(x):\n    return x + 1\n").is_empty());
        let errs = python_errors("def f(:\n    pass\n");
        assert_eq!(errs.len(), 1);
        assert_eq!(errs[0].line, 1);
        // compile() catches more than ast.parse does
        assert_eq!(python_errors("return 1\n").len(), 1);
    }
}
