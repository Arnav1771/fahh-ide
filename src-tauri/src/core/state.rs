use std::{path::PathBuf, sync::Mutex};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct FahhConfig {
    pub sfx_cooldown_secs: Option<u64>,
    pub last_workspace: Option<String>,
    pub installed_tools: Vec<String>,
    pub theme: Option<String>,
}

#[derive(Default)]
pub struct AppState {
    pub config: Mutex<FahhConfig>,
}

fn config_path() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("no home dir"))?;
    let dir = home.join(".fahh");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("config.json"))
}

#[tauri::command]
pub fn load_config(state: State<AppState>) -> Result<FahhConfig, String> {
    let path = config_path().map_err(|e| e.to_string())?;
    if !path.exists() {
        return Ok(FahhConfig::default());
    }
    let json = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let cfg: FahhConfig = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    *state.config.lock().unwrap() = cfg.clone();
    Ok(cfg)
}

#[tauri::command]
pub fn save_config(state: State<AppState>, config: FahhConfig) -> Result<(), String> {
    let path = config_path().map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    *state.config.lock().unwrap() = config;
    Ok(())
}
