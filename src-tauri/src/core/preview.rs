//! Lets the previews load local files (images in Markdown, a picture opened in
//! the editor, the assets of an HTML page) through Tauri's asset protocol.
//!
//! The protocol starts with an empty scope (tauri.conf.json). The frontend
//! allows exactly what is on screen: the folder you opened, or a single file
//! opened from outside it — the same idea as VS Code's webview
//! `localResourceRoots`, which defaults to the workspace folders.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tracing::info;

/// What the asset scope should allow for `path`: the folder itself, or the
/// file's own folder when a single file is opened.
pub fn scope_root(path: &Path) -> Result<PathBuf, String> {
    let canon = std::fs::canonicalize(path).map_err(|e| format!("Cannot preview {}: {e}", path.display()))?;
    Ok(if canon.is_dir() {
        canon
    } else {
        canon.parent().map(Path::to_path_buf).unwrap_or(canon)
    })
}

#[tauri::command]
pub fn allow_preview(app: AppHandle, path: String) -> Result<String, String> {
    let root = scope_root(Path::new(&path))?;
    app.asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(|e| format!("Could not allow previews from {}: {e}", root.display()))?;
    info!("allow_preview: {}", root.display());
    Ok(root.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_allows_its_folder_and_a_folder_allows_itself() {
        let dir = std::env::temp_dir().join(format!("fahh-preview-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("img")).unwrap();
        let file = dir.join("img").join("a.png");
        std::fs::write(&file, b"x").unwrap();
        let canon = std::fs::canonicalize(&dir).unwrap();
        assert_eq!(scope_root(&dir).unwrap(), canon);
        assert_eq!(scope_root(&file).unwrap(), canon.join("img"));
        assert!(scope_root(&dir.join("missing.png")).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }
}
