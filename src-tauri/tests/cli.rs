//! End-to-end run of the fahh-agent binary with the scripted mock provider.
use std::io::Write;
use std::process::{Command, Stdio};

fn script(dir: &std::path::Path, json: &str) -> std::path::PathBuf {
    let p = dir.join("script.json");
    std::fs::write(&p, json).unwrap();
    p
}

fn run(dir: &std::path::Path, script: &std::path::Path, args: &[&str], stdin: &str) -> (i32, String, String) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_fahh-agent"))
        .args(args)
        .env("FAHH_AGENT_MOCK_SCRIPT", script)
        .env_remove("GROQ_API_KEY")
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(stdin.as_bytes()).unwrap();
    let o = child.wait_with_output().unwrap();
    (o.status.code().unwrap_or(-1), String::from_utf8_lossy(&o.stdout).into(), String::from_utf8_lossy(&o.stderr).into())
}

const WRITE_THEN_READ: &str = r#"[
 {"text":"Writing.","calls":[{"id":"1","name":"write_file","args":{"path":"hello.txt","content":"hi from fahh"}}]},
 {"calls":[{"id":"2","name":"read_file","args":{"path":"hello.txt"}}]},
 {"text":"It contains: hi from fahh"}
]"#;

#[test]
fn auto_edit_writes_file_and_exits_zero() {
    let d = tempfile::tempdir().unwrap();
    let s = script(d.path(), WRITE_THEN_READ);
    let (code, out, _) = run(d.path(), &s, &["--provider", "mock", "--mode", "auto-edit", "make", "hello"], "");
    assert_eq!(code, 0, "{out}");
    assert_eq!(std::fs::read_to_string(d.path().join("hello.txt")).unwrap(), "hi from fahh");
    assert!(out.contains("> write_file") && out.contains("> read_file") && out.contains("[done in 3 step(s)"), "{out}");
}

#[test]
fn ask_mode_without_a_terminal_denies_and_still_finishes() {
    let d = tempfile::tempdir().unwrap();
    let s = script(d.path(), WRITE_THEN_READ);
    let (code, _, err) = run(d.path(), &s, &["--provider", "mock", "make hello"], "");
    assert_eq!(code, 0);
    assert!(err.contains("allow?"), "{err}");
    assert!(!d.path().join("hello.txt").exists());
}

#[test]
fn ask_mode_yes_runs_the_command_and_no_does_not() {
    let d = tempfile::tempdir().unwrap();
    let s = script(d.path(), r#"[{"calls":[{"id":"1","name":"run_command","args":{"command":"echo ran > ran.txt"}}]},{"text":"ok"}]"#);
    let (code, _, _) = run(d.path(), &s, &["--provider", "mock", "go"], "n\n");
    assert_eq!(code, 0);
    assert!(!d.path().join("ran.txt").exists());
    let (_, _, _) = run(d.path(), &s, &["--provider", "mock", "go"], "y\n");
    assert!(d.path().join("ran.txt").exists());
}

#[test]
fn errors_give_nonzero_exit_codes() {
    let d = tempfile::tempdir().unwrap();
    let s = script(d.path(), "[]");
    assert_eq!(run(d.path(), &s, &["--provider", "mock", "go"], "").0, 1); // mock ran out of turns
    assert_eq!(run(d.path(), &s, &["--mode", "bogus"], "").0, 2);
    assert_eq!(run(d.path(), &s, &["--provider", "groq", "hi"], "").0, 1); // no key
}

#[test]
fn plan_mode_writes_plan_and_asks_before_implementing() {
    let d = tempfile::tempdir().unwrap();
    let s = script(d.path(), r#"[{"calls":[{"id":"1","name":"write_plan","args":{"title":"Hello","markdown":"1. make hello.txt"}}]},{"text":"plan ready"}]"#);
    let (code, out, err) = run(d.path(), &s, &["--provider", "mock", "--mode", "plan", "plan it"], "n\n");
    assert_eq!(code, 0, "{out}{err}");
    assert!(err.contains("Implement .fahh/plans/hello-1.md?"), "{err}");
    assert!(d.path().join(".fahh/plans/hello-1.md").exists());
}
