//! Session persistence: one JSON file per session under the app data dir,
//! grouped per workspace, so /ls /resume /continue /fork /revert survive restarts.
//! The file holds the conversation, the step list and the checkpoints.

use super::perm::Mode;
use super::provider::Msg;
use super::tools::Checkpoints;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// `FAHH_DATA_DIR` wins (tests, portable installs); otherwise the OS data dir.
pub fn data_dir() -> PathBuf {
    std::env::var_os("FAHH_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::data_dir().map(|d| d.join("fahh")))
        .unwrap_or_else(|| PathBuf::from(".fahh-data"))
}

fn fnv(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.to_lowercase().replace('\\', "/").bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// Where one workspace's sessions live.
pub fn sessions_dir(data: &Path, workspace: &Path) -> PathBuf {
    data.join("sessions").join(fnv(&workspace.to_string_lossy()))
}

pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn new_id() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    format!("s{ms:x}{:x}", N.fetch_add(1, Ordering::Relaxed))
}

/// One step = one user request (a /loop is one step too).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TurnRec {
    pub id: u32,
    pub prompt: String,
    /// Where this step starts in the history; `None` once compaction folded it into a summary.
    pub hist_start: Option<usize>,
    pub mode: Mode,
    pub at: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Usage {
    pub model_calls: u32,
    pub tool_calls: u32,
    /// Estimated (characters / 4): providers differ in what they report.
    pub tokens_in: u64,
    pub tokens_out: u64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SessionFile {
    pub id: String,
    pub title: String,
    pub workspace: String,
    pub created: u64,
    pub updated: u64,
    pub next_turn: u32,
    pub turns: Vec<TurnRec>,
    pub history: Vec<Msg>,
    pub checkpoints: Checkpoints,
    #[serde(default)]
    pub usage: Usage,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    pub updated: u64,
    pub steps: usize,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() < 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn file_of(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("invalid session id".into());
    }
    Ok(dir.join(format!("{id}.json")))
}

/// Write atomically: a crash mid-save keeps the previous file.
pub fn save(dir: &Path, f: &SessionFile) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = file_of(dir, &f.id)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string(f).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

pub fn load(dir: &Path, id: &str) -> Result<SessionFile, String> {
    let text = std::fs::read_to_string(file_of(dir, id)?).map_err(|_| format!("no saved session `{id}`"))?;
    serde_json::from_str(&text).map_err(|e| format!("session `{id}` is damaged: {e}"))
}

/// Newest first. Unreadable files are skipped.
pub fn list(dir: &Path) -> Vec<SessionInfo> {
    let mut out: Vec<SessionInfo> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
        .filter_map(|e| {
            let id = e.path().file_stem()?.to_string_lossy().into_owned();
            let f = load(dir, &id).ok()?;
            Some(SessionInfo { id: f.id, title: f.title, updated: f.updated, steps: f.turns.len() })
        })
        .collect();
    out.sort_by(|a, b| b.updated.cmp(&a.updated).then(b.id.cmp(&a.id)));
    out
}

pub fn remove(dir: &Path, id: &str) -> Result<(), String> {
    std::fs::remove_file(file_of(dir, id)?).map_err(|_| format!("no saved session `{id}`"))
}

pub fn latest(dir: &Path) -> Option<String> {
    list(dir).into_iter().next().map(|i| i.id)
}

/// A title from the first prompt.
pub fn title_from(prompt: &str) -> String {
    let t: String = prompt.lines().next().unwrap_or("").chars().take(60).collect();
    if t.trim().is_empty() { "Untitled".into() } else { t.trim().to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(id: &str, updated: u64) -> SessionFile {
        SessionFile {
            id: id.into(),
            title: format!("t-{id}"),
            workspace: "/w".into(),
            created: 1,
            updated,
            next_turn: 2,
            turns: vec![TurnRec { id: 1, prompt: "hi".into(), hist_start: Some(0), mode: Mode::Ask, at: 1 }],
            history: vec![Msg::User { text: "hi".into() }, Msg::Assistant { text: "yo".into(), calls: vec![] }],
            checkpoints: Checkpoints::default(),
            usage: Usage::default(),
        }
    }

    #[test]
    fn round_trip_list_latest_remove() {
        let d = tempfile::tempdir().unwrap();
        save(d.path(), &file("sa", 10)).unwrap();
        save(d.path(), &file("sb", 20)).unwrap();
        let back = load(d.path(), "sa").unwrap();
        assert_eq!((back.title.as_str(), back.history.len(), back.turns[0].prompt.as_str()), ("t-sa", 2, "hi"));
        let l = list(d.path());
        assert_eq!(l.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), vec!["sb", "sa"]);
        assert_eq!(latest(d.path()).as_deref(), Some("sb"));
        remove(d.path(), "sb").unwrap();
        assert_eq!(latest(d.path()).as_deref(), Some("sa"));
        assert!(load(d.path(), "sb").is_err());
    }

    #[test]
    fn ids_cannot_escape_the_directory() {
        let d = tempfile::tempdir().unwrap();
        assert!(load(d.path(), "../x").is_err());
        assert!(remove(d.path(), "a/b").is_err());
        assert!(save(d.path(), &file("../evil", 1)).is_err());
    }

    #[test]
    fn damaged_files_are_skipped_in_the_list_and_reported_on_load() {
        let d = tempfile::tempdir().unwrap();
        save(d.path(), &file("ok", 1)).unwrap();
        std::fs::write(d.path().join("bad.json"), "{nope").unwrap();
        assert_eq!(list(d.path()).len(), 1);
        assert!(load(d.path(), "bad").unwrap_err().contains("damaged"));
    }

    #[test]
    fn workspaces_get_separate_folders() {
        let a = sessions_dir(Path::new("/data"), Path::new("/proj/a"));
        let b = sessions_dir(Path::new("/data"), Path::new("/proj/b"));
        assert_ne!(a, b);
        assert_eq!(a, sessions_dir(Path::new("/data"), Path::new("/PROJ/a"))); // case-insensitive, like Windows paths
    }

    #[test]
    fn titles() {
        assert_eq!(title_from("fix the bug\nmore"), "fix the bug");
        assert_eq!(title_from("  "), "Untitled");
    }
}
