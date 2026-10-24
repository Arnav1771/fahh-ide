//! First-run helpers: Check Setup (the doctor) and the custom error sound.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

// ─── Check Setup ──────────────────────────────────────────────────────────────

/// One line of Help > Check Setup.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct SetupCheck {
    pub name: String,
    /// "tool" or "language server".
    pub kind: &'static str,
    pub found: bool,
    pub version: Option<String>,
    /// The program that answered, e.g. `python3`.
    pub program: Option<String>,
    /// One line on how to install it, shown when it is missing.
    pub hint: &'static str,
}

struct Probe {
    name: &'static str,
    kind: &'static str,
    /// Tried in order; the first that runs wins.
    programs: &'static [&'static str],
    args: &'static [&'static str],
    hint: &'static str,
}

/// What Fahh uses: the runner and git, plus the language servers `core::lsp` looks for.
const PROBES: &[Probe] = &[
    Probe { name: "git", kind: "tool", programs: &["git"], args: &["--version"], hint: "Install Git from https://git-scm.com/downloads (Windows: winget install Git.Git)" },
    Probe { name: "python", kind: "tool", programs: &["python3", "python"], args: &["--version"], hint: "Install Python 3 from https://www.python.org/downloads (Windows: winget install Python.Python.3.12)" },
    Probe { name: "node", kind: "tool", programs: &["node"], args: &["--version"], hint: "Install Node.js LTS from https://nodejs.org (Windows: winget install OpenJS.NodeJS.LTS)" },
    Probe { name: "cargo", kind: "tool", programs: &["cargo"], args: &["--version"], hint: "Install Rust with rustup: https://rustup.rs" },
    // Windows only (filtered in check_setup).
    Probe { name: "WSL", kind: "tool", programs: &["wsl.exe"], args: &["--version"], hint: "Run `wsl --install` in an administrator PowerShell, then restart" },
    Probe { name: "rust-analyzer", kind: "language server", programs: &["rust-analyzer"], args: &["--version"], hint: "rustup component add rust-analyzer" },
    Probe { name: "typescript-language-server", kind: "language server", programs: &["typescript-language-server"], args: &["--version"], hint: "npm install -g typescript-language-server typescript" },
    Probe { name: "Python language server", kind: "language server", programs: &["pylsp", "pyright"], args: &["--version"], hint: "pip install python-lsp-server (or npm install -g pyright)" },
];

/// The first version-looking token in a `--version` answer: "git version 2.43.0" -> "2.43.0",
/// "v20.11.1" -> "20.11.1", "cargo 1.82.0 (8f40fc59f 2024-08-21)" -> "1.82.0".
/// `wsl --version` answers in UTF-16, so NUL bytes are dropped first.
pub fn parse_version(output: &str) -> Option<String> {
    let text: String = output.chars().filter(|c| *c != '\0').collect();
    text.split(|c: char| c.is_whitespace() || c == '(' || c == ')' || c == ',' || c == ':')
        .map(|t| t.trim_start_matches(['v', 'V']))
        .find(|t| t.starts_with(|c: char| c.is_ascii_digit()) && t.contains('.'))
        .map(|t| {
            let end = t.find(|c: char| !(c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '+')).unwrap_or(t.len());
            t[..end].trim_end_matches('.').to_string()
        })
}

/// Run `program args`, giving up after a few seconds: (exited 0, stdout + stderr).
fn run_briefly(program: &Path, args: &[&str]) -> Option<(bool, String)> {
    let mut child = crate::core::proc::cmd(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(5);
    // ponytail: polls for exit; fine for a handful of `--version` calls that print a line.
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(40)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let out = child.wait_with_output().ok()?;
    let text = format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    Some((out.status.success(), text))
}

fn probe(p: &Probe) -> SetupCheck {
    let mut check = SetupCheck { name: p.name.into(), kind: p.kind, found: false, version: None, program: None, hint: p.hint };
    for program in p.programs {
        // `which` honours PATHEXT, so npm's `.cmd` shims on Windows are found too.
        let Ok(path) = which::which(program) else { continue };
        let Some((ok, text)) = run_briefly(&path, p.args) else { continue };
        // The Windows Store `python` stub exists but fails: that is "missing". WSL 1's inbox
        // wsl.exe has no --version, yet WSL is there.
        if ok || (p.name == "WSL" && path.exists()) {
            check.found = true;
            check.version = if ok { parse_version(&text) } else { None };
            check.program = Some(program.to_string());
            break;
        }
    }
    check
}

/// Help > Check Setup: which tools are installed, with versions.
#[tauri::command]
pub async fn check_setup() -> Result<Vec<SetupCheck>, String> {
    tokio::task::spawn_blocking(|| {
        std::thread::scope(|s| {
            let handles: Vec<_> = PROBES.iter().filter(|p| cfg!(windows) || p.name != "WSL").map(|p| s.spawn(move || probe(p))).collect();
            handles.into_iter().map(|h| h.join().expect("probe thread")).collect()
        })
    })
    .await
    .map_err(|e| e.to_string())
}

// ─── Custom error sound ───────────────────────────────────────────────────────

pub const MAX_SOUND_BYTES: u64 = 5 * 1024 * 1024;
const SOUND_STEM: &str = "custom";

/// The audio format from a file's first bytes; None when it is not one Fahh plays.
pub fn sniff_audio(head: &[u8]) -> Option<&'static str> {
    if head.len() >= 12 && &head[..4] == b"RIFF" && &head[8..12] == b"WAVE" {
        Some("wav")
    } else if head.starts_with(b"OggS") {
        Some("ogg")
    } else if head.len() >= 8 && &head[4..8] == b"ftyp" {
        Some("m4a")
    } else if head.starts_with(b"ID3") || (head.len() >= 2 && head[0] == 0xFF && head[1] & 0xE0 == 0xE0) {
        Some("mp3")
    } else {
        None
    }
}

fn sounds_dir() -> PathBuf {
    crate::agent::store::data_dir().join("sounds")
}

/// The stored custom sound in `dir`, if there is one.
pub fn find_sound(dir: &Path) -> Option<PathBuf> {
    ["mp3", "wav", "ogg", "m4a"].iter().map(|e| dir.join(format!("{SOUND_STEM}.{e}"))).find(|p| p.is_file())
}

pub fn clear_sound(dir: &Path) -> Result<(), String> {
    while let Some(p) = find_sound(dir) {
        std::fs::remove_file(&p).map_err(|e| format!("Could not remove the old sound: {e}"))?;
    }
    Ok(())
}

/// Check `src` and copy it into `dir`, so moving or deleting the original later changes nothing.
/// Returns the original's file name, for the UI.
pub fn store_sound(dir: &Path, src: &Path) -> Result<String, String> {
    let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "sound".into());
    let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if !["mp3", "wav", "ogg", "m4a"].contains(&ext.as_str()) {
        return Err(format!("{name} is not an mp3, wav, ogg or m4a file."));
    }
    let len = std::fs::metadata(src).map_err(|e| format!("Could not read {name}: {e}"))?.len();
    if len == 0 {
        return Err(format!("{name} is empty."));
    }
    if len > MAX_SOUND_BYTES {
        return Err(format!("{name} is {:.1} MB; pick a sound under 5 MB.", len as f64 / 1_048_576.0));
    }
    let bytes = std::fs::read(src).map_err(|e| format!("Could not read {name}: {e}"))?;
    let kind = sniff_audio(&bytes).ok_or_else(|| format!("{name} does not look like an audio file (mp3, wav, ogg or m4a)."))?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    clear_sound(dir)?;
    std::fs::write(dir.join(format!("{SOUND_STEM}.{kind}")), &bytes).map_err(|e| format!("Could not save the sound: {e}"))?;
    Ok(name)
}

#[tauri::command]
pub fn set_custom_sound(path: String) -> Result<String, String> {
    store_sound(&sounds_dir(), Path::new(&path))
}

/// The stored sound's bytes (an ArrayBuffer on the JS side).
#[tauri::command]
pub fn load_custom_sound() -> Result<tauri::ipc::Response, String> {
    let p = find_sound(&sounds_dir()).ok_or("No custom sound is set.")?;
    std::fs::read(p).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_custom_sound() -> Result<(), String> {
    clear_sound(&sounds_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_versions() {
        assert_eq!(parse_version("git version 2.43.0\n").as_deref(), Some("2.43.0"));
        assert_eq!(parse_version("git version 2.45.1.windows.1").as_deref(), Some("2.45.1.windows.1"));
        assert_eq!(parse_version("Python 3.12.3").as_deref(), Some("3.12.3"));
        assert_eq!(parse_version("v20.11.1\n").as_deref(), Some("20.11.1"));
        assert_eq!(parse_version("cargo 1.82.0 (8f40fc59f 2024-08-21)").as_deref(), Some("1.82.0"));
        assert_eq!(parse_version("rust-analyzer 0.3.2146-standalone").as_deref(), Some("0.3.2146-standalone"));
        assert_eq!(parse_version("4.3.3").as_deref(), Some("4.3.3"));
        assert_eq!(parse_version("pylsp v1.12.0").as_deref(), Some("1.12.0"));
        assert_eq!(parse_version("pyright 1.1.389").as_deref(), Some("1.1.389"));
    }

    #[test]
    fn parses_utf16_wsl_output() {
        let utf16: String = "WSL version: 2.3.26.0\r\nKernel version: 5.15.167.4-1".chars().flat_map(|c| [c, '\0']).collect();
        assert_eq!(parse_version(&utf16).as_deref(), Some("2.3.26.0"));
    }

    #[test]
    fn no_version_in_noise() {
        assert_eq!(parse_version("Python was not found; run without arguments to install"), None);
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn finds_a_real_tool_and_reads_its_version() {
        // `cargo test` runs under cargo, so cargo is on PATH here.
        let cargo = PROBES.iter().find(|p| p.name == "cargo").unwrap();
        let c = probe(cargo);
        assert!(c.found, "{c:?}");
        assert!(c.version.as_deref().is_some_and(|v| v.starts_with("1.")), "{c:?}");
    }

    #[test]
    fn missing_tool_is_reported_with_its_hint() {
        let p = Probe { name: "nope", kind: "tool", programs: &["fahh-definitely-not-installed"], args: &["--version"], hint: "install it" };
        let c = probe(&p);
        assert!(!c.found && c.version.is_none() && c.hint == "install it");
    }

    #[test]
    fn sniffs_audio_formats() {
        assert_eq!(sniff_audio(b"RIFF\x24\0\0\0WAVEfmt "), Some("wav"));
        assert_eq!(sniff_audio(b"OggS\0\x02"), Some("ogg"));
        assert_eq!(sniff_audio(b"\0\0\0\x20ftypM4A "), Some("m4a"));
        assert_eq!(sniff_audio(b"ID3\x04\0"), Some("mp3"));
        assert_eq!(sniff_audio(&[0xFF, 0xFB, 0x90, 0x64]), Some("mp3"));
        assert_eq!(sniff_audio(b"%PDF-1.7"), None);
        assert_eq!(sniff_audio(b""), None);
    }

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fahh-sound-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn stores_a_copy_that_outlives_the_original() {
        let d = tmp("copy");
        let src = d.join("ding.wav");
        std::fs::write(&src, b"RIFF\x24\0\0\0WAVEfmt data").unwrap();
        let store = d.join("store");
        assert_eq!(store_sound(&store, &src).unwrap(), "ding.wav");
        std::fs::remove_file(&src).unwrap();
        let kept = find_sound(&store).unwrap();
        assert!(kept.ends_with("custom.wav"));
        assert!(std::fs::read(&kept).unwrap().starts_with(b"RIFF"));

        // A new one replaces it, whatever its format.
        let ogg = d.join("boop.ogg");
        std::fs::write(&ogg, b"OggS\0\x02rest").unwrap();
        store_sound(&store, &ogg).unwrap();
        assert!(find_sound(&store).unwrap().ends_with("custom.ogg"));
        assert!(!store.join("custom.wav").exists());

        clear_sound(&store).unwrap();
        assert!(find_sound(&store).is_none());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn rejects_bad_files() {
        let d = tmp("bad");
        let store = d.join("store");
        let pdf = d.join("song.mp3");
        std::fs::write(&pdf, b"%PDF-1.7 not audio").unwrap();
        assert!(store_sound(&store, &pdf).unwrap_err().contains("does not look like an audio file"));

        let txt = d.join("notes.txt");
        std::fs::write(&txt, b"ID3 but a text file").unwrap();
        assert!(store_sound(&store, &txt).unwrap_err().contains("not an mp3, wav, ogg or m4a"));

        let empty = d.join("empty.wav");
        std::fs::write(&empty, b"").unwrap();
        assert!(store_sound(&store, &empty).unwrap_err().contains("empty"));

        let big = d.join("big.wav");
        let mut bytes = b"RIFF\0\0\0\0WAVE".to_vec();
        bytes.resize((MAX_SOUND_BYTES + 1) as usize, 0);
        std::fs::write(&big, bytes).unwrap();
        assert!(store_sound(&store, &big).unwrap_err().contains("under 5 MB"));

        assert!(store_sound(&store, &d.join("gone.wav")).is_err());
        assert!(find_sound(&store).is_none(), "nothing stored after a rejection");
        let _ = std::fs::remove_dir_all(&d);
    }
}
