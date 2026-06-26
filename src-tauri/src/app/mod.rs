use anyhow::Result;
use tauri::App;
use tracing::info;

use crate::core::quality;

pub fn setup(app: &mut App) -> Result<()> {
    info!("Fahh Editor starting up");

    let checks = quality::run_startup_checks();
    let passed = checks.iter().filter(|g| g.passed).count();
    let total = checks.len();
    info!("startup quality gates: {passed}/{total} passed");

    Ok(())
}
