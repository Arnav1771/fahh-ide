//! Watch the open folder so the Explorer follows changes made outside it: a terminal
//! (`mkdir`, `git clone`, `npm create`), the agent, another editor. Changes are debounced
//! and emitted as `fs://changed` with the paths; churn the tree never shows is dropped.

use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_mini::{new_debouncer, notify::RecommendedWatcher, notify::RecursiveMode, DebounceEventResult, Debouncer};
use tauri::{AppHandle, Emitter};

lazy_static::lazy_static! {
    /// One watched folder per app: watching a new one drops the old watcher.
    static ref WATCHER: Mutex<Option<Debouncer<RecommendedWatcher>>> = Mutex::new(None);
}

/// Folders whose churn does not change what the Explorer shows (it hides them; see
/// workspace::build_tree): `npm install` alone writes thousands of files there.
fn ignored(path: &str) -> bool {
    let p = path.replace('\\', "/");
    ["/node_modules/", "/.git/", "/target/"].iter().any(|d| p.contains(d)) || p.ends_with("/.git")
}

fn start(root: &Path, on_change: impl Fn(Vec<String>) + Send + 'static) -> Result<Debouncer<RecommendedWatcher>, String> {
    let mut debouncer = new_debouncer(Duration::from_millis(400), move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let paths: Vec<String> = events
            .iter()
            .map(|e| e.path.to_string_lossy().into_owned())
            .filter(|p| !ignored(p))
            .collect();
        if !paths.is_empty() {
            on_change(paths);
        }
    })
    .map_err(|e| format!("Could not watch the folder: {e}"))?;
    debouncer
        .watcher()
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| format!("Could not watch {}: {e}", root.display()))?;
    Ok(debouncer)
}

/// Watch `root` (the open folder) for changes made outside the Explorer.
#[tauri::command]
pub fn watch_workspace(app: AppHandle, root: String) -> Result<(), String> {
    let debouncer = start(Path::new(&root), move |paths| {
        let _ = app.emit("fs://changed", paths);
    })?;
    *WATCHER.lock().map_err(|e| e.to_string())? = Some(debouncer);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn reports_new_files_and_skips_node_modules() {
        let dir = std::env::temp_dir().join(format!("fahh-watch-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        let (tx, rx) = mpsc::channel::<Vec<String>>();
        let _w = start(&dir, move |p| {
            let _ = tx.send(p);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(200));
        std::fs::write(dir.join("node_modules").join("x.js"), "1").unwrap();
        std::fs::create_dir(dir.join("web")).unwrap();
        let mut seen: Vec<String> = vec![];
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while !seen.iter().any(|p| p.ends_with("web")) && std::time::Instant::now() < deadline {
            if let Ok(p) = rx.recv_timeout(Duration::from_millis(500)) {
                seen.extend(p);
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
        assert!(seen.iter().any(|p| p.ends_with("web")), "{seen:?}");
        assert!(!seen.iter().any(|p| p.contains("node_modules")), "{seen:?}");
    }

    #[test]
    fn ignores_tool_folders_only() {
        assert!(ignored(r"C:\w\app\node_modules\react\index.js"));
        assert!(ignored("/w/.git/index"));
        assert!(ignored("/w/.git"));
        assert!(!ignored("/w/src/git.ts"));
        assert!(!ignored("/w/web"));
    }
}
