//! Watch each window's open folder so the Explorer and the open tabs follow changes made
//! outside them: a terminal (`mkdir`, `git checkout`, `npm create`), the agent, another
//! editor. Changes are debounced (~150 ms) and sent to that window only, as one batched
//! `fs://changed` event (see [`FsChanges`]). Churn the Explorer never shows (dependency and
//! build folders) is dropped.
//!
//! Two backends:
//! - native (`notify` + `notify-debouncer-full`): inotify, FSEvents, ReadDirectoryChangesW;
//! - polling, for folders the OS cannot watch: a WSL folder opened from Windows
//!   (`\\wsl.localhost\...` or `\\wsl$\...`) is a 9P network share, and ReadDirectoryChangesW
//!   reports nothing for changes made inside Linux, so those roots are re-scanned every
//!   [`POLL_EVERY`] instead. Polling is also the fallback when the native watch fails.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use notify_debouncer_full::notify::event::ModifyKind;
use notify_debouncer_full::notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Window};

const DEBOUNCE: Duration = Duration::from_millis(150);
// ponytail: a full re-scan per tick; fine for a project, slow on a huge tree over 9P.
const POLL_EVERY: Duration = Duration::from_millis(1500);
const POLL_MAX_ENTRIES: usize = 50_000;

/// Folders whose insides the watcher ignores: the Quick Open skip list (src/lib/quickOpen.ts).
/// The folder itself still counts, so creating or deleting `dist` updates the Explorer.
const SKIP: &[&str] = &["node_modules", ".git", "target", "dist", "build", ".next", "__pycache__", ".venv", "venv"];

/// One batch of changes under `root`. `structure`: paths created, removed or renamed (both
/// names), so their folders are re-read. `content`: files written in place (open tabs reload).
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct FsChanges {
    pub root: String,
    pub structure: Vec<String>,
    pub content: Vec<String>,
}

impl FsChanges {
    fn is_empty(&self) -> bool {
        self.structure.is_empty() && self.content.is_empty()
    }
}

/// A running watch; dropping it stops it.
enum Handle {
    Native(#[allow(dead_code)] Debouncer<RecommendedWatcher, FileIdMap>),
    Poll(Arc<AtomicBool>),
}

impl Drop for Handle {
    fn drop(&mut self) {
        if let Handle::Poll(stop) = self {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

lazy_static::lazy_static! {
    /// One watched folder per window label: a window opening another folder replaces its own watch only.
    static ref WATCHERS: Mutex<HashMap<String, Handle>> = Mutex::new(HashMap::new());
}

/// True when `path` is inside one of the [`SKIP`] folders under `root`.
fn ignored(root: &Path, path: &Path) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(path);
    let parts: Vec<_> = rel.components().collect();
    parts.len() > 1 && parts[..parts.len() - 1].iter().any(|c| SKIP.contains(&c.as_os_str().to_string_lossy().as_ref()))
}

/// `\\wsl.localhost\Ubuntu\...` or `\\wsl$\Ubuntu\...` (either slash direction).
pub fn is_wsl_unc(root: &str) -> bool {
    let r = root.replace('/', "\\").to_lowercase();
    r.starts_with("\\\\wsl.localhost\\") || r.starts_with("\\\\wsl$\\")
}

fn native(root: &Path, emit: impl Fn(FsChanges) + Send + 'static) -> Result<Handle, String> {
    let root_buf = root.to_path_buf();
    let root_str = root.to_string_lossy().into_owned();
    let mut debouncer = new_debouncer(DEBOUNCE, None, move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let mut out = FsChanges { root: root_str.clone(), ..Default::default() };
        let mut seen = HashSet::new();
        for ev in &events {
            let structural = match ev.kind {
                EventKind::Access(_) => continue,
                EventKind::Modify(ModifyKind::Data(_) | ModifyKind::Metadata(_) | ModifyKind::Any | ModifyKind::Other) => false,
                _ => true, // create, remove, rename, and anything unknown
            };
            for p in ev.paths.iter().filter(|p| !ignored(&root_buf, p)) {
                let s = p.to_string_lossy().into_owned();
                let list = if structural { &mut out.structure } else { &mut out.content };
                if seen.insert((structural, s.clone())) {
                    list.push(s);
                }
            }
        }
        if !out.is_empty() {
            emit(out);
        }
    })
    .map_err(|e| format!("Could not watch the folder: {e}"))?;
    debouncer
        .watcher()
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| format!("Could not watch {}: {e}", root.display()))?;
    debouncer.cache().add_root(root, RecursiveMode::Recursive);
    Ok(Handle::Native(debouncer))
}

/// What the poller remembers per path: (is_dir, modified, len).
type Snapshot = HashMap<PathBuf, (bool, Option<SystemTime>, u64)>;

fn snapshot(root: &Path) -> Snapshot {
    let mut snap = Snapshot::new();
    let mut it = walkdir::WalkDir::new(root).min_depth(1).into_iter();
    while let Some(next) = it.next() {
        let Ok(e) = next else { continue };
        let Ok(meta) = e.metadata() else { continue };
        snap.insert(e.path().to_path_buf(), (meta.is_dir(), meta.modified().ok(), meta.len()));
        if meta.is_dir() && SKIP.contains(&e.file_name().to_string_lossy().as_ref()) {
            it.skip_current_dir();
        }
        if snap.len() >= POLL_MAX_ENTRIES {
            break;
        }
    }
    snap
}

/// The changes between two scans. A folder's own mtime is noise (its children say what changed).
fn diff(root: &str, old: &Snapshot, new: &Snapshot) -> FsChanges {
    let mut out = FsChanges { root: root.to_string(), ..Default::default() };
    for (p, n) in new {
        match old.get(p) {
            None => out.structure.push(p.to_string_lossy().into_owned()),
            Some(o) if !n.0 && (o.1 != n.1 || o.2 != n.2) => out.content.push(p.to_string_lossy().into_owned()),
            _ => {}
        }
    }
    out.structure.extend(old.keys().filter(|p| !new.contains_key(*p)).map(|p| p.to_string_lossy().into_owned()));
    out.structure.sort();
    out.content.sort();
    out
}

fn poll(root: &Path, emit: impl Fn(FsChanges) + Send + 'static) -> Handle {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let root = root.to_path_buf();
    std::thread::spawn(move || {
        let root_str = root.to_string_lossy().into_owned();
        let mut last = snapshot(&root);
        while !flag.load(Ordering::Relaxed) {
            std::thread::sleep(POLL_EVERY);
            if flag.load(Ordering::Relaxed) {
                break;
            }
            let now = snapshot(&root);
            let changes = diff(&root_str, &last, &now);
            last = now;
            if !changes.is_empty() {
                emit(changes);
            }
        }
    });
    Handle::Poll(stop)
}

fn start(root: &Path, force_poll: bool, emit: impl Fn(FsChanges) + Send + Clone + 'static) -> Handle {
    if !force_poll {
        match native(root, emit.clone()) {
            Ok(h) => return h,
            Err(e) => tracing::warn!("{e}; polling instead"),
        }
    }
    poll(root, emit)
}

/// Watch `root` (this window's open folder) for changes made outside the Explorer.
#[tauri::command]
pub fn watch_workspace(app: AppHandle, window: Window, root: String) -> Result<(), String> {
    let path = Path::new(&root);
    if !path.is_dir() {
        return Err(format!("{root} is not a folder"));
    }
    let label = window.label().to_string();
    let target = label.clone();
    let handle = start(path, is_wsl_unc(&root), move |changes| {
        let _ = app.emit_to(target.as_str(), "fs://changed", changes);
    });
    WATCHERS.lock().map_err(|e| e.to_string())?.insert(label, handle);
    Ok(())
}

/// Stop watching this window's folder (the folder closed).
#[tauri::command]
pub fn unwatch_workspace(window: Window) {
    stop(window.label());
}

/// Stop the watch of a closed window.
pub fn stop(label: &str) {
    if let Ok(mut w) = WATCHERS.lock() {
        w.remove(label);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Instant;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fahh-watch-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        dir.canonicalize().unwrap()
    }

    /// Collect batches until `done` holds for everything seen, or 10 s pass.
    fn collect(rx: &mpsc::Receiver<FsChanges>, done: impl Fn(&FsChanges) -> bool) -> FsChanges {
        let mut all = FsChanges::default();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !done(&all) && Instant::now() < deadline {
            if let Ok(c) = rx.recv_timeout(Duration::from_millis(200)) {
                all.root = c.root;
                all.structure.extend(c.structure);
                all.content.extend(c.content);
            }
        }
        all
    }

    fn has(list: &[String], end: &str) -> bool {
        list.iter().any(|p| p.ends_with(end))
    }

    /// Create, write, rename and delete each arrive, and node_modules churn does not.
    fn lifecycle(force_poll: bool) {
        let dir = temp(if force_poll { "poll" } else { "native" });
        let (tx, rx) = mpsc::channel::<FsChanges>();
        let _h = start(&dir, force_poll, move |c| {
            let _ = tx.send(c);
        });
        std::thread::sleep(Duration::from_millis(300));

        std::fs::write(dir.join("node_modules").join("x.js"), "1").unwrap();
        std::fs::create_dir(dir.join("web")).unwrap();
        std::fs::write(dir.join("a.txt"), "1").unwrap();
        let c = collect(&rx, |c| has(&c.structure, "web") && has(&c.structure, "a.txt"));
        assert!(has(&c.structure, "web") && has(&c.structure, "a.txt"), "create: {c:?}");
        let inside_deps = |p: &String| p.contains("node_modules/") || p.contains("node_modules\\");
        assert!(!c.structure.iter().chain(&c.content).any(inside_deps), "{c:?}");
        assert_eq!(c.root, dir.to_string_lossy());

        std::fs::write(dir.join("a.txt"), "changed content").unwrap();
        let c = collect(&rx, |c| has(&c.content, "a.txt") || has(&c.structure, "a.txt"));
        assert!(has(&c.content, "a.txt") || has(&c.structure, "a.txt"), "write: {c:?}");

        std::fs::rename(dir.join("a.txt"), dir.join("b.txt")).unwrap();
        let c = collect(&rx, |c| has(&c.structure, "a.txt") && has(&c.structure, "b.txt"));
        assert!(has(&c.structure, "a.txt") && has(&c.structure, "b.txt"), "rename: {c:?}");

        std::fs::remove_file(dir.join("b.txt")).unwrap();
        let c = collect(&rx, |c| has(&c.structure, "b.txt"));
        assert!(has(&c.structure, "b.txt"), "delete: {c:?}");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn native_watch_reports_create_write_rename_delete() {
        lifecycle(false);
    }

    #[test]
    fn polling_watch_reports_create_write_rename_delete() {
        lifecycle(true);
    }

    #[test]
    fn dropping_the_handle_stops_polling() {
        let dir = temp("stop");
        let (tx, rx) = mpsc::channel::<FsChanges>();
        drop(start(&dir, true, move |c| {
            let _ = tx.send(c);
        }));
        std::fs::write(dir.join("late.txt"), "1").unwrap();
        assert!(rx.recv_timeout(POLL_EVERY * 2).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ignores_the_insides_of_tool_folders_only() {
        let root = Path::new("/w/build/app"); // a root under a folder named like a skipped one
        assert!(ignored(root, Path::new("/w/build/app/node_modules/react/index.js")));
        assert!(ignored(root, Path::new("/w/build/app/.git/index")));
        assert!(ignored(root, Path::new("/w/build/app/src/__pycache__/x.pyc")));
        assert!(!ignored(root, Path::new("/w/build/app/.git")));
        assert!(!ignored(root, Path::new("/w/build/app/dist")));
        assert!(!ignored(root, Path::new("/w/build/app/src/git.ts")));
    }

    #[test]
    fn wsl_roots_poll() {
        assert!(is_wsl_unc(r"\\wsl.localhost\Ubuntu\home\me\app"));
        assert!(is_wsl_unc(r"\\wsl$\Ubuntu\home\me"));
        assert!(is_wsl_unc("//wsl.localhost/Ubuntu/home"));
        assert!(!is_wsl_unc(r"C:\code\app"));
        assert!(!is_wsl_unc("/home/me/app"));
    }

    #[test]
    fn diff_sorts_changes_and_ignores_folder_mtimes() {
        let t0 = SystemTime::UNIX_EPOCH;
        let t1 = t0 + Duration::from_secs(1);
        let old: Snapshot = [("/r/src".into(), (true, Some(t0), 0)), ("/r/a".into(), (false, Some(t0), 1)), ("/r/gone".into(), (false, Some(t0), 1))].into();
        let new: Snapshot = [("/r/src".into(), (true, Some(t1), 0)), ("/r/a".into(), (false, Some(t1), 1)), ("/r/new".into(), (false, Some(t0), 1))].into();
        let d = diff("/r", &old, &new);
        assert_eq!(d.structure, vec!["/r/gone", "/r/new"]);
        assert_eq!(d.content, vec!["/r/a"]);
    }
}
