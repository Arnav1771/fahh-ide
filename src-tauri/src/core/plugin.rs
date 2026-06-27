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
    /// Arbitrary JSON configuration blob (may be an empty object).
    pub config: Value,
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/// Holds all built-in and user-installed plugins.
pub struct PluginRegistry {
    plugins: Vec<Plugin>,
}

impl PluginRegistry {
    /// Build the registry with all built-in plugins plus any found in
    /// `~/.fahh/plugins/*.json`.
    pub fn load() -> Self {
        let mut plugins = Self::builtin_plugins();
        plugins.extend(Self::load_user_plugins());
        Self { plugins }
    }

    /// Return all plugins.
    pub fn all(&self) -> &[Plugin] {
        &self.plugins
    }

    /// Return only plugins of a specific kind.
    pub fn by_kind(&self, kind: &PluginKind) -> Vec<Plugin> {
        self.plugins
            .iter()
            .filter(|p| &p.kind == kind)
            .cloned()
            .collect()
    }

    // ------------------------------------------------------------------
    // Built-ins
    // ------------------------------------------------------------------

    fn builtin_plugins() -> Vec<Plugin> {
        let mut v: Vec<Plugin> = vec![];

        // ---- Themes ----
        let themes: &[(&str, &str, &str)] = &[
            ("fahh-dark",       "Fahh Dark (Catppuccin Mocha)", "The default Fahh Editor dark theme, based on Catppuccin Mocha"),
            ("fahh-light",      "Fahh Light",                  "A clean, high-contrast light theme for Fahh Editor"),
            ("github-dark",     "GitHub Dark",                  "GitHub's dark syntax theme, faithful to the web UI"),
            ("dracula",         "Dracula",                      "The classic Dracula dark purple theme"),
            ("solarized-dark",  "Solarized Dark",               "Ethan Schoonover's precision Solarized dark palette"),
            ("one-dark-pro",    "One Dark Pro",                  "Atom's iconic One Dark palette ported to Fahh"),
            ("tokyo-night",     "Tokyo Night",                   "A clean dark theme inspired by Tokyo at night"),
            ("nord",            "Nord",                          "An arctic, north-bluish color palette"),
        ];
        for (id, name, desc) in themes {
            v.push(Plugin {
                id: id.to_string(),
                name: name.to_string(),
                kind: PluginKind::Theme,
                version: "1.0.0".to_string(),
                description: desc.to_string(),
                config: serde_json::json!({}),
            });
        }

        // ---- Language Packs ----
        let lang_packs: &[(&str, &str, &str)] = &[
            ("rust",       "Rust",       "Syntax highlighting, snippets, and bracket matching for Rust"),
            ("python",     "Python",     "Syntax highlighting, snippets, and indent rules for Python 3"),
            ("typescript", "TypeScript", "Full TS/TSX/JS/JSX syntax support"),
            ("go",         "Go",         "Go syntax, folding, and snippet support"),
            ("java",       "Java",       "Java 17+ syntax and code snippets"),
            ("cpp",        "C / C++",    "C and C++ (C++20) syntax, headers, and snippets"),
            ("kotlin",     "Kotlin",     "Kotlin syntax and Jetpack Compose snippets"),
            ("swift",      "Swift",      "Swift 5.9 syntax and SwiftUI snippets"),
            ("ruby",       "Ruby",       "Ruby 3 syntax and Rails snippets"),
            ("php",        "PHP",        "PHP 8.2 syntax and Laravel snippets"),
            ("dart",       "Dart",       "Dart syntax and Flutter widget snippets"),
            ("elixir",     "Elixir",     "Elixir/Phoenix syntax and pipe operator snippets"),
            ("haskell",    "Haskell",    "Haskell syntax, do-notation, and type class snippets"),
            ("zig",        "Zig",        "Zig 0.12 syntax and build snippets"),
            ("lua",        "Lua",        "Lua 5.4 syntax and table snippets"),
        ];
        for (id, name, desc) in lang_packs {
            v.push(Plugin {
                id: id.to_string(),
                name: name.to_string(),
                kind: PluginKind::LanguagePack,
                version: "1.0.0".to_string(),
                description: desc.to_string(),
                config: serde_json::json!({}),
            });
        }

        // ---- Formatters ----
        let formatters: &[(&str, &str, &str, &str)] = &[
            ("prettier",     "Prettier",      "1.0.0", "Opinionated formatter for JS/TS/JSON/CSS/HTML/YAML/Markdown"),
            ("black",        "Black",         "1.0.0", "The uncompromising Python code formatter"),
            ("gofmt",        "gofmt",         "1.0.0", "Official Go source code formatter"),
            ("rustfmt",      "rustfmt",       "1.0.0", "Official Rust code formatter (edition 2021)"),
            ("clang-format", "clang-format",  "1.0.0", "LLVM's C/C++/Objective-C formatter"),
            ("google-java-format", "google-java-format", "1.0.0", "Google's opinionated Java formatter"),
            ("shfmt",        "shfmt",         "1.0.0", "Shell script formatter supporting bash/sh/mksh"),
            ("stylua",       "StyLua",        "1.0.0", "Opinionated Lua code formatter"),
            ("ktfmt",        "ktfmt",         "1.0.0", "Google's Kotlin formatter"),
            ("swift-format", "swift-format",  "1.0.0", "Apple's official Swift formatter"),
        ];
        for (id, name, version, desc) in formatters {
            v.push(Plugin {
                id: id.to_string(),
                name: name.to_string(),
                kind: PluginKind::Formatter,
                version: version.to_string(),
                description: desc.to_string(),
                config: serde_json::json!({}),
            });
        }

        // ---- Snippet packs ----
        let snippets: &[(&str, &str, &str)] = &[
            ("snippets-react",   "React Snippets",   "Common React hooks, component skeletons, and JSX patterns"),
            ("snippets-tauri",   "Tauri Snippets",   "Tauri command, event, and plugin boilerplate"),
            ("snippets-async",   "Async/Await",       "Tokio async patterns, select!, spawn, and channel templates"),
            ("snippets-testing", "Testing Snippets",  "unittest, pytest, #[test], go test, and Jest boilerplate"),
        ];
        for (id, name, desc) in snippets {
            v.push(Plugin {
                id: id.to_string(),
                name: name.to_string(),
                kind: PluginKind::Snippet,
                version: "1.0.0".to_string(),
                description: desc.to_string(),
                config: serde_json::json!({}),
            });
        }

        v
    }

    // ------------------------------------------------------------------
    // User plugins from ~/.fahh/plugins/*.json
    // ------------------------------------------------------------------

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

/// Return only Theme plugins.
#[tauri::command]
pub fn get_themes() -> Vec<Plugin> {
    PluginRegistry::load().by_kind(&PluginKind::Theme)
}

/// Return only LanguagePack plugins.
#[tauri::command]
pub fn get_language_packs() -> Vec<Plugin> {
    PluginRegistry::load().by_kind(&PluginKind::LanguagePack)
}

/// Return only Formatter plugins.
#[tauri::command]
pub fn get_formatter_plugins() -> Vec<Plugin> {
    PluginRegistry::load().by_kind(&PluginKind::Formatter)
}

/// Return only Snippet plugins.
#[tauri::command]
pub fn get_snippet_plugins() -> Vec<Plugin> {
    PluginRegistry::load().by_kind(&PluginKind::Snippet)
}
