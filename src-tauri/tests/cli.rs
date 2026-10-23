//! End-to-end run of the fahh-agent binary with the scripted mock provider.
use std::io::Write;
use std::process::{Command, Stdio};

fn script(dir: &std::path::Path, json: &str) -> std::path::PathBuf {
    let p = dir.join("script.json");
    std::fs::write(&p, json).unwrap();
    p
}

fn run(dir: &std::path::Path, script: &std::path::Path, args: &[&str], stdin: &str) -> (i32, String, String) {
    run_env(dir, script, args, stdin, &[])
}

/// Sessions are saved under FAHH_DATA_DIR: keep them inside the test's own temp folder.
fn run_env(dir: &std::path::Path, script: &std::path::Path, args: &[&str], stdin: &str, env: &[(&str, &std::path::Path)]) -> (i32, String, String) {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_fahh-agent"));
    for (k, v) in env {
        cmd.env(k, v);
    }
    let mut child = cmd
        .args(args)
        .env("FAHH_AGENT_MOCK_SCRIPT", script)
        .env("FAHH_DATA_DIR", dir.join(".data"))
        .env_remove("GROQ_API_KEY")
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    // the child may exit before reading (usage errors): a broken pipe is not a test failure
    let _ = child.stdin.take().unwrap().write_all(stdin.as_bytes());
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

// ── slash commands, sessions, modes, subagents (REPL and flags) ──

#[test]
fn repl_slash_commands_help_mode_and_steps() {
    let d = tempfile::tempdir().unwrap();
    let s = script(d.path(), "[]");
    let (code, out, _) = run(d.path(), &s, &["--provider", "mock"], "/help\n/mode smart\n/mode\n/yolo\n/steps\n/nope\n/exit\n");
    assert_eq!(code, 0, "{out}");
    for needle in ["/loop <prompt>", "mode: smart", "mode: bypass", "WARNING: bypass", "no steps yet", "unknown command /nope"] {
        assert!(out.contains(needle), "missing {needle:?} in {out}");
    }
}

#[test]
fn sessions_persist_and_continue_across_runs() {
    let d = tempfile::tempdir().unwrap();
    let s = script(d.path(), r#"[{"text":"first answer"}]"#);
    let (code, _, _) = run(d.path(), &s, &["--provider", "mock", "-p", "remember this"], "");
    assert_eq!(code, 0);
    let (_, ls, _) = run(d.path(), &s, &["sessions", "ls"], "");
    assert!(ls.contains("1 step(s)") && ls.contains("remember this"), "{ls}");
    // a new process: -c picks the saved session up
    let (code, out, _) = run(d.path(), &s, &["--provider", "mock", "-c"], "/steps\n/title Kept\n/ls\n/exit\n");
    assert_eq!(code, 0, "{out}");
    assert!(out.contains("1. [normal] remember this") && out.contains("Kept"), "{out}");
    // an unknown id fails with a message
    let (code, _, err) = run(d.path(), &s, &["--provider", "mock", "-r", "nope"], "");
    assert_eq!(code, 1);
    assert!(err.contains("no saved session"), "{err}");
}

#[test]
fn revert_undoes_a_step_in_the_repl() {
    let d = tempfile::tempdir().unwrap();
    let s = script(d.path(), WRITE_THEN_READ);
    let (code, out, _) = run(d.path(), &s, &["--provider", "mock", "--mode", "auto-edit"], "make hello\n/revert 1\n/steps\n/exit\n");
    assert_eq!(code, 0, "{out}");
    assert!(!d.path().join("hello.txt").exists(), "{out}");
    assert!(out.contains("reverted 1 file(s): hello.txt") && out.contains("conversation rewound") && out.contains("no steps yet"), "{out}");
}

#[test]
fn print_mode_puts_only_the_answer_on_stdout() {
    let d = tempfile::tempdir().unwrap();
    let s = script(d.path(), r#"[{"calls":[{"id":"1","name":"list_dir","args":{"path":"."}}]},{"text":"the answer"}]"#);
    let (code, out, err) = run(d.path(), &s, &["--provider", "mock", "-p", "what is here"], "");
    assert_eq!(code, 0);
    assert_eq!(out.trim(), "the answer", "{out}");
    assert!(err.contains("> list_dir"), "{err}");
}

#[test]
fn prompt_file_and_export() {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(d.path().join("p.txt"), "from a file\n").unwrap();
    let s = script(d.path(), r#"[{"text":"ok"}]"#);
    let out_path = d.path().join("out.md");
    let (code, _, _) = run(d.path(), &s, &["--provider", "mock", "--prompt-file", "p.txt", "--export", out_path.to_str().unwrap()], "");
    assert_eq!(code, 0);
    let md = std::fs::read_to_string(out_path).unwrap();
    assert!(md.contains("from a file") && md.contains("ok"), "{md}");
}

#[test]
fn smart_mode_uses_the_judge_and_logs_the_verdict() {
    let d = tempfile::tempdir().unwrap();
    let s = script(d.path(), r#"[{"calls":[{"id":"1","name":"run_command","args":{"command":"echo ran > ran.txt"}}]},{"text":"ok"}]"#);
    let safe = d.path().join("judge-safe.json");
    std::fs::write(&safe, r#"[{"text":"SAFE just an echo"}]"#).unwrap();
    let (code, out, _) = run_env(d.path(), &s, &["--provider", "mock", "--permission-mode", "smart", "go"], "", &[("FAHH_AGENT_MOCK_JUDGE", &safe)]);
    assert_eq!(code, 0, "{out}");
    assert!(d.path().join("ran.txt").exists() && out.contains("judge: SAFE"), "{out}");
    // an unsafe verdict falls back to asking, and no terminal means no
    std::fs::remove_file(d.path().join("ran.txt")).unwrap();
    let unsafe_j = d.path().join("judge-unsafe.json");
    std::fs::write(&unsafe_j, r#"[{"text":"UNSAFE writes files"}]"#).unwrap();
    let (_, out, err) = run_env(d.path(), &s, &["--provider", "mock", "--permission-mode", "smart", "go"], "", &[("FAHH_AGENT_MOCK_JUDGE", &unsafe_j)]);
    assert!(out.contains("judge: UNSAFE") && err.contains("judge flagged"), "{out}{err}");
    assert!(!d.path().join("ran.txt").exists());
}

#[test]
fn bypass_warns_and_still_honours_deny_rules() {
    let d = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(d.path().join(".fahh")).unwrap();
    std::fs::write(d.path().join(".fahh/permissions.json"), r#"{"rules":[{"action":"deny","kind":"run","pattern":"touch denied*"}]}"#).unwrap();
    let s = script(d.path(), r#"[{"calls":[{"id":"1","name":"run_command","args":{"command":"touch ok.txt"}},{"id":"2","name":"run_command","args":{"command":"touch denied.txt"}}]},{"text":"done"}]"#);
    let (code, out, _) = run(d.path(), &s, &["--provider", "mock", "--permission-mode", "bypass", "go"], "");
    assert_eq!(code, 0, "{out}");
    assert!(out.contains("WARNING: bypass"), "{out}");
    assert!(d.path().join("ok.txt").exists() && !d.path().join("denied.txt").exists(), "{out}");
}

#[test]
fn agents_listing_reports_bad_definitions_and_agent_runs_one() {
    let d = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(d.path().join(".fahh/agents")).unwrap();
    std::fs::write(d.path().join(".fahh/agents/broken.md"), "no frontmatter").unwrap();
    let s = script(d.path(), r#"[{"text":"found it in src/lib.rs"}]"#);
    let (code, out, _) = run(d.path(), &s, &["--provider", "mock"], "/agents\n/agent explore where is the parser\n/exit\n");
    assert_eq!(code, 0, "{out}");
    for needle in ["explore", "reviewer", "planner", "skipped: project/broken.md", "[explore] started", "[explore] done", "found it in src/lib.rs"] {
        assert!(out.contains(needle), "missing {needle:?} in {out}");
    }
}

#[test]
fn loop_runs_a_review_round_and_stops_on_approval() {
    let d = tempfile::tempdir().unwrap();
    // main: write, answer; reviewer (a subagent sharing the scripted queue): APPROVED
    let s = script(
        d.path(),
        r#"[{"calls":[{"id":"1","name":"write_file","args":{"path":"out.txt","content":"v1"}}]},{"text":"wrote it"},{"text":"APPROVED"}]"#,
    );
    let (code, out, _) = run(d.path(), &s, &["--provider", "mock", "--permission-mode", "accept-edits"], "/loop make out.txt\n/exit\n");
    assert_eq!(code, 0, "{out}");
    assert!(out.contains("loop round 1/3: reviewer approved") && out.contains("[reviewer] started"), "{out}");
    assert_eq!(std::fs::read_to_string(d.path().join("out.txt")).unwrap(), "v1");
}

#[test]
fn models_subcommand_needs_a_key_and_usage_errors_exit_nonzero() {
    let d = tempfile::tempdir().unwrap();
    let s = script(d.path(), "[]");
    let (code, _, err) = run(d.path(), &s, &["models", "list", "--provider", "groq"], "");
    assert_eq!(code, 1);
    assert!(err.contains("GROQ_API_KEY"), "{err}");
    assert_eq!(run(d.path(), &s, &["models"], "").0, 1);
    assert_eq!(run(d.path(), &s, &["--permission-mode", "godlike"], "").0, 2);
}
