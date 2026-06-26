use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Document {
    pub path: String,
    pub language: String,
    pub dirty: bool,
}

#[derive(Default)]
pub struct EditorState {
    pub documents: Mutex<HashMap<String, Document>>,
}

fn detect_language(path: &str) -> &'static str {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    match ext {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" => "javascript",
        "py" => "python",
        "json" => "json",
        "toml" => "toml",
        "md" => "markdown",
        "html" => "html",
        "css" => "css",
        "sh" | "bash" => "shell",
        "yaml" | "yml" => "yaml",
        _ => "plaintext",
    }
}

#[tauri::command]
pub fn open_document(state: State<crate::core::state::AppState>, path: String) -> Result<Document, String> {
    let lang = detect_language(&path).to_string();
    let doc = Document {
        path: path.clone(),
        language: lang,
        dirty: false,
    };
    Ok(doc)
}

#[tauri::command]
pub fn close_document(_path: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn get_open_documents(_state: State<crate::core::state::AppState>) -> Result<Vec<Document>, String> {
    Ok(vec![])
}
