//! The `fahh` command line: `fahh .`, `fahh <folder>`, `fahh <file>[:line]`.
//!
//! Parsing is pure (no Tauri) so it can be unit tested. The same parser serves
//! the first launch (our own argv) and a second launch (argv forwarded by the
//! single-instance plugin to the already running window).

use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Dir,
    File,
    Missing,
}

/// What the caller asked to open. Mirrors `OpenRequest` in src/lib/types.ts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OpenRequest {
    pub path: String,
    pub line: Option<u32>,
    pub kind: Kind,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Launch {
    /// No path given: just start (or focus) the editor.
    Nothing,
    Open(OpenRequest),
    /// `fahh agent ...`: belongs to the separate `fahh-agent` binary; the shim forwards it,
    /// so the editor itself never acts on it.
    Agent(Vec<String>),
}

/// The request from the first launch, held until the window asks for it
/// (an event sent during startup would arrive before anyone listens).
#[derive(Default)]
pub struct PendingOpen(pub Mutex<Option<OpenRequest>>);

/// Lexical clean-up: drop `.` and fold `..`, without touching the disk.
fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// `name:12` or `name:12:5` -> (`name`, Some(12)). Only when `name:..` is not itself a real path.
fn split_line(arg: &str, cwd: &Path) -> (String, Option<u32>) {
    let exists = |s: &str| cwd.join(s).exists();
    if exists(arg) {
        return (arg.to_string(), None);
    }
    let strip = |s: &str| -> Option<(String, u32)> {
        let (head, tail) = s.rsplit_once(':')?;
        let n = tail.parse::<u32>().ok()?;
        (!head.is_empty()).then(|| (head.to_string(), n))
    };
    match strip(arg) {
        None => (arg.to_string(), None),
        Some((head, n1)) => {
            if exists(&head) {
                return (head, Some(n1)); // file:line
            }
            match strip(&head) {
                Some((head2, n2)) => (head2, Some(n2)), // file:line:col
                None => (head, Some(n1)),
            }
        }
    }
}

/// `args` is a full argv (program name first), `cwd` the caller's working directory.
pub fn parse(args: &[String], cwd: &Path) -> Launch {
    let mut rest = args.iter().skip(1).filter(|a| !a.starts_with('-'));
    let Some(first) = rest.next() else {
        return Launch::Nothing;
    };
    if first == "agent" {
        // flags are kept for the agent: take them from the raw argv
        let tail = args.iter().skip(1).skip_while(|a| a.as_str() != "agent").skip(1);
        return Launch::Agent(tail.cloned().collect());
    }
    let (name, line) = split_line(first, cwd);
    let full = normalize(&cwd.join(&name));
    let kind = if full.is_dir() {
        Kind::Dir
    } else if full.is_file() {
        Kind::File
    } else {
        Kind::Missing
    };
    Launch::Open(OpenRequest {
        path: full.to_string_lossy().into_owned(),
        line: if kind == Kind::File { line } else { None },
        kind,
    })
}

// ── installing the command (macOS / AppImage; the Windows installer and the deb do it themselves) ──

/// The `fahh` shell command: start the editor detached, or hand `agent ...` to `fahh-agent`.
pub fn shim_script(exe: &Path) -> String {
    let exe = exe.to_string_lossy().replace('\'', r"'\''");
    format!(
        "#!/bin/sh\n\
         # fahh: open files and folders in Fahh Editor (fahh . | fahh <folder> | fahh <file>[:line])\n\
         if [ \"$1\" = \"agent\" ]; then\n\
         \x20 shift\n\
         \x20 d=\"$(dirname \"$0\")\"\n\
         \x20 if [ -x \"$d/fahh-agent\" ]; then exec \"$d/fahh-agent\" \"$@\"; fi\n\
         \x20 if command -v fahh-agent >/dev/null 2>&1; then exec fahh-agent \"$@\"; fi\n\
         \x20 echo \"fahh: 'fahh-agent' is not installed\" >&2\n\
         \x20 exit 1\n\
         fi\n\
         nohup '{exe}' \"$@\" >/dev/null 2>&1 &\n"
    )
}

/// Write the shim to `dir/fahh` (executable). Returns its path.
#[cfg(unix)]
pub fn install_into(dir: &Path, exe: &Path) -> std::io::Result<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::create_dir_all(dir)?;
    let target = dir.join("fahh");
    std::fs::write(&target, shim_script(exe))?;
    std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755))?;
    Ok(target)
}

#[cfg(unix)]
#[tauri::command]
pub fn install_cli() -> Result<String, String> {
    // AppImage: current_exe is inside a temporary mount; $APPIMAGE is the real file.
    let exe = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok())
        .ok_or("cannot find the Fahh Editor executable")?;
    let dir = if cfg!(target_os = "macos") {
        PathBuf::from("/usr/local/bin")
    } else {
        dirs::home_dir().ok_or("no home folder")?.join(".local/bin")
    };
    match install_into(&dir, &exe) {
        Ok(p) => Ok(format!("Installed {}. Open a new terminal and run: fahh .", p.display())),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => Err(format!(
            "No permission to write {}. Run once in a terminal: sudo mkdir -p {d} && sudo ln -sf '{e}' {d}/fahh (or re-run this action as an administrator).",
            dir.display(),
            d = dir.display(),
            e = exe.display()
        )),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(unix))]
#[tauri::command]
pub fn install_cli() -> Result<String, String> {
    Err("On Windows the installer adds `fahh` to your PATH; reinstall Fahh Editor if it is missing.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(a: &[&str]) -> Vec<String> {
        std::iter::once("fahh").chain(a.iter().copied()).map(String::from).collect()
    }

    /// A scratch folder with `src/main.rs` in it.
    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fahh-cli-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("src")).unwrap();
        std::fs::write(d.join("src/main.rs"), "fn main() {}\n").unwrap();
        std::fs::write(d.join("weird:12"), "x").unwrap();
        d
    }

    fn open(l: Launch) -> OpenRequest {
        match l {
            Launch::Open(r) => r,
            other => panic!("expected Open, got {other:?}"),
        }
    }

    #[test]
    fn no_args_just_starts() {
        assert_eq!(parse(&argv(&[]), Path::new("/tmp")), Launch::Nothing);
        assert_eq!(parse(&argv(&["--flag"]), Path::new("/tmp")), Launch::Nothing);
    }

    #[test]
    fn dot_is_the_callers_directory() {
        let d = scratch("dot");
        let r = open(parse(&argv(&["."]), &d));
        assert_eq!(r.kind, Kind::Dir);
        assert_eq!(PathBuf::from(&r.path), d);
        assert_eq!(r.line, None);
    }

    #[test]
    fn relative_and_absolute_folders() {
        let d = scratch("dirs");
        let r = open(parse(&argv(&["src"]), &d));
        assert_eq!((r.kind, PathBuf::from(&r.path)), (Kind::Dir, d.join("src")));
        let r = open(parse(&argv(&["../.."]), &d.join("src")));
        assert_eq!(PathBuf::from(&r.path), d.parent().unwrap().to_path_buf());
        let abs = d.join("src");
        let r = open(parse(&argv(&[abs.to_str().unwrap()]), Path::new("/nonexistent-cwd")));
        assert_eq!((r.kind, PathBuf::from(&r.path)), (Kind::Dir, abs));
    }

    #[test]
    fn files_with_and_without_line() {
        let d = scratch("files");
        let f = d.join("src/main.rs");
        let r = open(parse(&argv(&["src/main.rs"]), &d));
        assert_eq!((r.kind, r.line, PathBuf::from(&r.path)), (Kind::File, None, f.clone()));
        let r = open(parse(&argv(&["src/main.rs:42"]), &d));
        assert_eq!((r.kind, r.line, PathBuf::from(&r.path)), (Kind::File, Some(42), f.clone()));
        let r = open(parse(&argv(&["src/main.rs:42:7"]), &d));
        assert_eq!((r.kind, r.line, PathBuf::from(&r.path)), (Kind::File, Some(42), f));
    }

    #[test]
    fn a_real_file_with_a_colon_in_its_name_wins_over_line_syntax() {
        let d = scratch("colon");
        let r = open(parse(&argv(&["weird:12"]), &d));
        assert_eq!((r.kind, r.line), (Kind::File, None));
    }

    #[test]
    fn missing_paths_are_reported_not_guessed() {
        let d = scratch("missing");
        let r = open(parse(&argv(&["nope.rs:3"]), &d));
        assert_eq!(r.kind, Kind::Missing);
        assert_eq!(PathBuf::from(&r.path), d.join("nope.rs"));
        assert_eq!(r.line, None);
    }

    #[test]
    fn unknown_flags_are_ignored() {
        let d = scratch("flags");
        let r = open(parse(&argv(&["--new-window", "-r", "src"]), &d));
        assert_eq!(r.kind, Kind::Dir);
    }

    #[test]
    fn agent_is_passed_through_untouched() {
        let l = parse(&argv(&["agent", "run", "--model", "x", "."]), Path::new("/tmp"));
        assert_eq!(l, Launch::Agent(["run", "--model", "x", "."].map(String::from).to_vec()));
        assert_eq!(parse(&argv(&["agent"]), Path::new("/tmp")), Launch::Agent(vec![]));
    }

    #[cfg(unix)]
    #[test]
    fn shim_is_written_executable_and_forwards_agent() {
        use std::os::unix::fs::PermissionsExt;
        let d = scratch("shim");
        let bin = d.join("bin");
        let p = install_into(&bin, Path::new("/opt/Fahh Editor/it's")).unwrap();
        assert_eq!(p, bin.join("fahh"));
        assert_ne!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o111, 0);
        let s = std::fs::read_to_string(&p).unwrap();
        assert!(s.contains(r"nohup '/opt/Fahh Editor/it'\''s' "), "{s}");
        // `fahh agent` with no fahh-agent installed: one-line hint, exit 1
        let out = crate::core::proc::cmd("sh")
            .arg(&p)
            .arg("agent")
            .env("PATH", "/usr/bin:/bin")
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(1));
        assert!(String::from_utf8_lossy(&out.stderr).contains("fahh-agent' is not installed"));
    }
}
