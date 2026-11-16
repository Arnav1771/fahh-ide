use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::{debug, info, warn};

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/// The category a plugin belongs to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginKind {
    Theme,
    /// Serialized as "language" to match the frontend `PluginKind` union.
    #[serde(rename = "language")]
    LanguagePack,
    Formatter,
    Snippet,
}

/// A single plugin/extension entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plugin {
    /// Unique identifier, e.g. "fahh-dark" or "prettier".
    pub id: String,
    /// Human-readable name displayed in the UI.
    pub name: String,
    /// Category.
    pub kind: PluginKind,
    /// SemVer string, e.g. "1.0.0".
    pub version: String,
    /// Short description shown in the plugin browser.
    pub description: String,
    /// Plugin author / vendor.
    #[serde(default = "default_author")]
    pub author: String,
    /// Whether the plugin ships with the editor and cannot be removed.
    #[serde(default)]
    pub builtin: bool,
    /// File extensions handled (language packs only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Vec<String>>,
    /// CLI command a formatter plugin invokes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// Monaco theme id (theme plugins only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub monaco_theme: Option<String>,
    /// Arbitrary JSON configuration blob (may be an empty object).
    #[serde(default)]
    pub config: Value,
}

fn default_author() -> String {
    "Fahh Team".to_string()
}


// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/// Holds the user-installed plugins.
pub struct PluginRegistry {
    plugins: Vec<Plugin>,
}

impl PluginRegistry {
    /// The plugins found in `~/.fahh/plugins/*.json`. Nothing is listed that is not really
    /// there: Fahh's own themes, languages and formatters are not "plugins" (an invented
    /// built-in list used to show themes and snippet packs that do not exist).
    pub fn load() -> Self {
        Self { plugins: Self::load_user_plugins() }
    }

    /// Return all plugins.
    pub fn all(&self) -> &[Plugin] {
        &self.plugins
    }

    fn plugins_dir() -> Option<PathBuf> {
        dirs::home_dir().map(|h| h.join(".fahh").join("plugins"))
    }

    fn load_user_plugins() -> Vec<Plugin> {
        let dir = match Self::plugins_dir() {
            Some(d) => d,
            None => {
                warn!("plugin: cannot determine home directory; skipping user plugins");
                return vec![];
            }
        };

        if !dir.exists() {
            debug!("plugin: user plugins dir does not exist: {}", dir.display());
            return vec![];
        }

        let mut plugins = vec![];

        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(e) => {
                warn!("plugin: failed to read user plugins dir {}: {e}", dir.display());
                return vec![];
            }
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }

            match std::fs::read_to_string(&path) {
                Ok(json) => match serde_json::from_str::<Plugin>(&json) {
                    Ok(plugin) => {
                        info!("plugin: loaded user plugin '{}' from {}", plugin.id, path.display());
                        plugins.push(plugin);
                    }
                    Err(e) => {
                        warn!("plugin: failed to parse {}: {e}", path.display());
                    }
                },
                Err(e) => {
                    warn!("plugin: failed to read {}: {e}", path.display());
                }
            }
        }

        plugins
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Return all plugins (built-in and user-installed).
#[tauri::command]
pub fn get_plugins() -> Vec<Plugin> {
    PluginRegistry::load().all().to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_pack_serializes_as_language() {
        // Frontend PluginKind union uses "language", not "language_pack".
        let json = serde_json::to_string(&PluginKind::LanguagePack).unwrap();
        assert_eq!(json, "\"language\"");
    }

    #[test]
    fn no_invented_builtin_plugins() {
        // Only what is in ~/.fahh/plugins is listed; nothing bundled pretends to be installed.
        assert!(PluginRegistry::load().all().iter().all(|p| !p.builtin));
    }

    #[test]
    fn user_plugin_json_round_trips() {
        let json = r#"{"id":"x","name":"X","kind":"language","version":"0.1.0","description":"d","extensions":["x"]}"#;
        let p: Plugin = serde_json::from_str(json).unwrap();
        assert_eq!(p.kind, PluginKind::LanguagePack);
        assert!(!p.builtin);
        assert_eq!(serde_json::to_value(&p).unwrap()["kind"], "language");
    }
}
