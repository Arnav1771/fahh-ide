//! Opt-in tests against real providers, through the `fahh-agent` binary.
//! CI never runs them (all `#[ignore]`). Locally:
//!
//!   set -a; . ~/.config/ai-keys.env; set +a
//!   FAHH_LIVE_GROQ_MODEL=openai/gpt-oss-120b cargo test --test live -- --ignored live_ --nocapture
//!
//! Keys come from the environment of the test process only and are never printed.
use std::io::Write;
use std::process::{Command, Stdio};

fn run(provider: &str, model: &str, mode: &str, prompt: &str, stdin: &str) -> Option<(i32, String, std::path::PathBuf, tempfile::TempDir)> {
    let var = format!("{}_API_KEY", provider.to_uppercase());
    if std::env::var(&var).map(|k| k.is_empty()).unwrap_or(true) {
        eprintln!("SKIP {provider}: {var} not set");
        return None;
    }
    let dir = tempfile::tempdir().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_fahh-agent"))
        .args(["--provider", provider, "--model", model, "--mode", mode, "--cwd"])
        .arg(dir.path())
        .arg(prompt)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(stdin.as_bytes()).unwrap();
    let o = child.wait_with_output().unwrap();
    let text = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
    let p = dir.path().to_path_buf();
    Some((o.status.code().unwrap_or(-1), text, p, dir))
}

fn model(provider: &str) -> Option<String> {
    std::env::var(format!("FAHH_LIVE_{}_MODEL", provider.to_uppercase())).ok()
}

fn auto_edit(provider: &str) {
    let Some(m) = model(provider) else { return eprintln!("SKIP {provider}: set FAHH_LIVE_{}_MODEL", provider.to_uppercase()) };
    let t = std::time::Instant::now();
    let Some((code, out, dir, _keep)) = run(provider, &m, "auto-edit", "Create hello.txt whose entire content is the text: hi from fahh (no trailing period). Then read it back and tell me its contents.", "") else { return };
    eprintln!("{provider} {m}: exit {code} in {:?}\n{out}", t.elapsed());
    assert_eq!(code, 0, "{out}");
    assert_eq!(std::fs::read_to_string(dir.join("hello.txt")).unwrap().trim(), "hi from fahh");
    assert!(out.contains("> write_file") || out.contains("> edit_file"), "{out}");
    assert!(out.contains("> read_file"), "{out}");
}

fn ask_mode(provider: &str) {
    let Some(m) = model(provider) else { return };
    let Some((_, out, dir, _keep)) = run(provider, &m, "ask", "You must call the run_command tool with command: echo hi > ran.txt. Never reply with text instead of the tool call; the tool itself asks me for approval.", "n\n") else { return };
    assert!(out.contains("allow?"), "no approval was requested: {out}");
    assert!(!dir.join("ran.txt").exists(), "command ran without approval");
}

#[test]
#[ignore]
fn live_groq_auto_edit() {
    auto_edit("groq")
}
#[test]
#[ignore]
fn live_groq_ask_mode_needs_approval() {
    ask_mode("groq")
}
#[test]
#[ignore]
fn live_gemini_auto_edit() {
    auto_edit("gemini")
}
#[test]
#[ignore]
fn live_gemini_ask_mode_needs_approval() {
    ask_mode("gemini")
}
