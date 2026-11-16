//! Workspace trust, as in VS Code: "Do you trust the authors of the files in this folder?"
//!
//! Some features run code the folder ships: its Python environments (`.venv/bin/python`),
//! language servers that load project code (rust-analyzer build scripts and proc macros,
//! ESLint and Tailwind configs, the project's own TypeScript), and tasks. They stay off in a
//! folder until the user trusts it. The answer is kept per folder in the app data dir, where
//! nothing inside a repository can change it.

use std::collections::BTreeMap;
use std::path::PathBuf;

fn store_path() -> PathBuf {
    crate::agent::store::data_dir().join("trust.json")
}

/// One spelling per folder: forward slashes, no trailing slash, lower case on Windows.
pub fn norm(path: &str) -> String {
    let p = path.replace('\\', "/");
    let p = p.trim_end_matches('/');
    let p = if p.is_empty() { "/" } else { p };
    if cfg!(windows) || p.starts_with("//") || p.as_bytes().get(1) == Some(&b':') {
        p.to_lowercase()
    } else {
        p.to_string()
    }
}

fn load() -> BTreeMap<String, bool> {
    std::fs::read_to_string(store_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// The answer for a folder (or for the nearest answered folder above a path), if any.
pub fn decision_in(map: &BTreeMap<String, bool>, path: &str) -> Option<bool> {
    let p = norm(path);
    map.iter()
        .filter(|(root, _)| p == **root || p.starts_with(&format!("{}/", root.trim_end_matches('/'))))
        .max_by_key(|(root, _)| root.len())
        .map(|(_, t)| *t)
}

/// Is `path` (a folder or a file in one) inside a folder the user trusts?
pub fn is_trusted(path: &str) -> bool {
    decision_in(&load(), path) == Some(true)
}

#[tauri::command]
pub fn workspace_trust_get(root: String) -> Option<bool> {
    decision_in(&load(), &root)
}

#[tauri::command]
pub fn workspace_trust_set(root: String, trusted: bool) -> Result<(), String> {
    let mut map = load();
    map.insert(norm(&root), trusted);
    let path = store_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?;
    crate::core::fsutil::write_atomic(&path, json.as_bytes()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trust_covers_the_folder_and_below_and_the_nearest_answer_wins() {
        let mut m = BTreeMap::new();
        m.insert(norm("/home/u/code"), true);
        m.insert(norm("/home/u/code/vendor/evil"), false);
        assert_eq!(decision_in(&m, "/home/u/code"), Some(true));
        assert_eq!(decision_in(&m, "/home/u/code/app/src"), Some(true));
        assert_eq!(decision_in(&m, "/home/u/code/vendor/evil/x"), Some(false));
        assert_eq!(decision_in(&m, "/home/u/codex"), None, "a sibling with the same prefix is not inside");
        assert_eq!(decision_in(&m, "/tmp/clone"), None);
    }

    #[test]
    fn windows_and_wsl_spellings_are_one_folder() {
        assert_eq!(norm(r"C:\Users\A\Proj\"), "c:/users/a/proj");
        assert_eq!(norm(r"\\wsl.localhost\Ubuntu\home\x"), "//wsl.localhost/ubuntu/home/x");
    }
}
