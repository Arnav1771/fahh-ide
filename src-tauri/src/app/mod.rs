pub mod cli;

use anyhow::Result;
use tauri::{App, Emitter, Manager};
use tracing::info;

use crate::core::quality;

pub fn setup(app: &mut App) -> Result<()> {
    info!("Fahh Editor starting up");

    let checks = quality::run_startup_checks();
    let passed = checks.iter().filter(|g| g.passed).count();
    let total = checks.len();
    info!("startup quality gates: {passed}/{total} passed");

    // `fahh <path>` on the very first launch: park it until the window asks.
    let args: Vec<String> = std::env::args().collect();
    if let Ok(cwd) = std::env::current_dir() {
        if let cli::Launch::Open(req) = cli::parse(&args, &cwd) {
            app.state::<cli::PendingOpen>().set_main(req);
        }
    }

    Ok(())
}

/// A plain file (not a workspace file) goes to an existing window as a tab, like `code file`.
/// Each extra window is a whole WebView renderer (~160 MB), so `fahh a.ts b.ts ...` from a shell
/// used to cost a window per file.
fn opens_as_tab(req: &cli::OpenRequest) -> bool {
    let lower = req.path.to_ascii_lowercase();
    req.kind == cli::Kind::File && !lower.ends_with(".code-workspace") && !lower.ends_with(".fahh-workspace")
}

/// The window a forwarded file should land in: the focused one, else main, else any.
fn target_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .cloned()
        .or_else(|| app.get_webview_window("main"))
        .or_else(|| windows.values().next().cloned())
}

/// A second `fahh <path>` while running: a file opens as a tab in an existing window; a folder
/// (or workspace file) opens a NEW WINDOW so several projects can be open side by side.
pub fn on_second_launch(app: &tauri::AppHandle, argv: Vec<String>, cwd: String) {
    match cli::parse(&argv, std::path::Path::new(&cwd)) {
        cli::Launch::Open(req) if opens_as_tab(&req) => {
            if let Some(w) = target_window(app) {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
                let _ = w.emit_to(w.label(), "fahh://open", req);
            }
        }
        cli::Launch::Open(req) => {
            let label = new_window_label();

            // Park the open request for the newly spawned window
            app.state::<cli::PendingOpen>().set_for_window(&label, req.clone());

            let folder_name = std::path::Path::new(&req.path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| req.path.clone());
            let title = format!("Fahh Editor — {}", folder_name);

            // If the requested project is already open in an existing window, focus it directly
            for (win_label, existing_win) in app.webview_windows() {
                if let Ok(existing_title) = existing_win.title() {
                    if existing_title == title {
                        let _ = existing_win.unminimize();
                        let _ = existing_win.show();
                        let _ = existing_win.set_focus();
                        let _ = existing_win.emit_to(&win_label, "fahh://open", req);
                        return;
                    }
                }
            }

            let builder = tauri::WebviewWindowBuilder::new(
                app,
                &label,
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title(&title)
            .inner_size(1400.0, 900.0)
            .min_inner_size(600.0, 400.0)
            .resizable(true)
            .decorations(false);

            match builder.build() {
                Ok(new_win) => {
                    let _ = new_win.show();
                    let _ = new_win.set_focus();
                    // Note: new_win picks up req cleanly on mount via take_pending_open.
                    // We intentionally do NOT broadcast emit here, protecting existing windows.
                }
                Err(err) => {
                    tracing::warn!("Failed opening new window ({err}), forwarding to main window");
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.unminimize();
                        let _ = w.show();
                        let _ = w.set_focus();
                        let _ = w.emit_to("main", "fahh://open", req);
                    }
                }
            }
        }
        _ => {
            // Naked `fahh`: bring existing window to front
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
    }
}

/// The frontend calls this once on start-up to pick up the path for its specific window.
#[tauri::command]
pub fn take_pending_open(
    state: tauri::State<cli::PendingOpen>,
    window: tauri::WebviewWindow,
) -> Option<cli::OpenRequest> {
    state.take_for_window(window.label())
}

/// Label for an extra window. Must match a `windows` glob in capabilities/default.json, or
/// every IPC call from that window is denied (see the test below).
fn new_window_label() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("fahh-win-{ms}")
}

/// Explicit command to open a fresh Fahh window from menus or shortcuts.
/// `async` on purpose: on Windows, building a webview inside a synchronous command (which
/// runs on the UI thread) deadlocks WebView2, and the new window stays blank white forever.
#[tauri::command]
pub async fn open_new_window(
    app: tauri::AppHandle,
    path: Option<String>,
) -> Result<String, String> {
    let label = new_window_label();

    let title = if let Some(ref p) = path {
        let name = std::path::Path::new(p)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| p.clone());
        app.state::<cli::PendingOpen>().set_for_window(
            &label,
            cli::OpenRequest {
                path: p.clone(),
                line: None,
                kind: if std::path::Path::new(p).is_dir() { cli::Kind::Dir } else { cli::Kind::File },
            },
        );
        format!("Fahh Editor — {}", name)
    } else {
        "Fahh Editor".to_string()
    };

    let builder = tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title(&title)
    .inner_size(1400.0, 900.0)
    .min_inner_size(600.0, 400.0)
    .resizable(true)
    .decorations(false);

    let win = builder.build().map_err(|e| e.to_string())?;
    let _ = win.show();
    let _ = win.set_focus();
    Ok(label)
}

#[cfg(test)]
mod tests {
    use super::{cli, new_window_label, opens_as_tab};

    /// Every label this code gives a window is covered by the capability, so its IPC works.
    #[test]
    fn window_labels_are_covered_by_the_capability() {
        let cap: serde_json::Value = serde_json::from_str(include_str!("../../capabilities/default.json")).unwrap();
        let globs: Vec<&str> = cap["windows"].as_array().unwrap().iter().map(|g| g.as_str().unwrap()).collect();
        let covered = |label: &str| {
            globs.iter().any(|g| match g.strip_suffix('*') {
                Some(prefix) => label.starts_with(prefix),
                None => label == *g,
            })
        };
        assert!(covered("main"));
        assert!(covered(&new_window_label()), "{} not in {globs:?}", new_window_label());
    }

    /// A synchronous command runs on the UI thread, where building a WebView2 deadlocks.
    #[test]
    fn new_window_command_is_async() {
        assert!(include_str!("mod.rs").contains("pub async fn open_new_window("));
    }

    fn req(path: &str, kind: cli::Kind) -> cli::OpenRequest {
        cli::OpenRequest { path: path.into(), line: None, kind }
    }

    #[test]
    fn files_open_as_tabs_folders_and_workspaces_get_windows() {
        assert!(opens_as_tab(&req("C:\\p\\a.ts", cli::Kind::File)));
        assert!(!opens_as_tab(&req("C:\\p", cli::Kind::Dir)));
        assert!(!opens_as_tab(&req("C:\\p\\team.code-workspace", cli::Kind::File)));
        assert!(!opens_as_tab(&req("/p/x.FAHH-WORKSPACE", cli::Kind::File)));
        assert!(!opens_as_tab(&req("/p/new.ts", cli::Kind::Missing)));
    }
}
