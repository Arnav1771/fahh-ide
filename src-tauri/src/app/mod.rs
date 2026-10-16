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
            *app.state::<cli::PendingOpen>().0.lock().unwrap() = Some(req);
        }
    }

    Ok(())
}

/// A second `fahh <path>` while we are running: the single-instance plugin forwards its argv
/// and cwd here. We reuse this window (one window, like VS Code reusing the last active one):
/// tell the UI what to open and bring the window to the front.
pub fn on_second_launch(app: &tauri::AppHandle, argv: Vec<String>, cwd: String) {
    if let cli::Launch::Open(req) = cli::parse(&argv, std::path::Path::new(&cwd)) {
        let _ = app.emit("fahh://open", req);
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// The frontend calls this once on start-up to pick up the path from the first launch.
#[tauri::command]
pub fn take_pending_open(state: tauri::State<cli::PendingOpen>) -> Option<cli::OpenRequest> {
    state.0.lock().unwrap().take()
}
