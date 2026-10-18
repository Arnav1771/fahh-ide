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

/// A second `fahh <path>` while running: when a path/project is given, we open a NEW WINDOW
/// so the user can work on multiple projects simultaneously without replacing their active workspace.
pub fn on_second_launch(app: &tauri::AppHandle, argv: Vec<String>, cwd: String) {
    match cli::parse(&argv, std::path::Path::new(&cwd)) {
        cli::Launch::Open(req) => {
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            let label = format!("fahh-win-{}", timestamp);

            // Park the open request for the newly spawned window
            app.state::<cli::PendingOpen>().set_for_window(&label, req.clone());

            let folder_name = std::path::Path::new(&req.path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| req.path.clone());
            let title = format!("Fahh Editor — {}", folder_name);

            // If the requested project is already open in an existing window, focus it directly
            for (_, existing_win) in app.webview_windows() {
                if let Ok(existing_title) = existing_win.title() {
                    if existing_title == title {
                        let _ = existing_win.unminimize();
                        let _ = existing_win.show();
                        let _ = existing_win.set_focus();
                        let _ = existing_win.emit("fahh://open", req);
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
                    let _ = new_win.emit("fahh://open", req);
                }
                Err(err) => {
                    tracing::warn!("Failed opening new window ({err}), forwarding to main window");
                    let _ = app.emit("fahh://open", req);
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.unminimize();
                        let _ = w.show();
                        let _ = w.set_focus();
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

/// Explicit command to open a fresh Fahh window from menus or shortcuts.
#[tauri::command]
pub fn open_new_window(
    app: tauri::AppHandle,
    path: Option<String>,
) -> Result<String, String> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let label = format!("fahh-win-{}", timestamp);

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
