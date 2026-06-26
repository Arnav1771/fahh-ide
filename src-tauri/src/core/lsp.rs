use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LspDiagnostic {
    pub file: String,
    pub line: u32,
    pub col: u32,
    pub message: String,
    pub severity: DiagnosticSeverity,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum DiagnosticSeverity {
    Error,
    Warning,
    Info,
    Hint,
}

#[derive(Debug, Clone)]
pub struct LspConfig {
    pub language: String,
    pub server_command: String,
    pub server_args: Vec<String>,
}

pub fn detect_lsp_servers() -> Vec<LspConfig> {
    let mut servers = Vec::new();

    if which_on_path("rust-analyzer") {
        servers.push(LspConfig {
            language: "rust".to_string(),
            server_command: "rust-analyzer".to_string(),
            server_args: vec![],
        });
    }

    if which_on_path("typescript-language-server") {
        servers.push(LspConfig {
            language: "typescript".to_string(),
            server_command: "typescript-language-server".to_string(),
            server_args: vec!["--stdio".to_string()],
        });
    }

    if which_on_path("pylsp") || which_on_path("pyright") {
        let cmd = if which_on_path("pyright") { "pyright-langserver" } else { "pylsp" };
        servers.push(LspConfig {
            language: "python".to_string(),
            server_command: cmd.to_string(),
            server_args: vec!["--stdio".to_string()],
        });
    }

    servers
}

fn which_on_path(cmd: &str) -> bool {
    std::process::Command::new(if cfg!(windows) { "where" } else { "which" })
        .arg(cmd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
