use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{AppHandle, Emitter};
use tracing::info;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum OptionalTool {
    N8n,
    BrowserUse,
    Flowise,
    GitHubCli,
    ClaudeCli,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToolStatus {
    pub tool: String,
    pub installed: bool,
    pub version: Option<String>,
}

impl OptionalTool {
    fn name(&self) -> &'static str {
        match self {
            OptionalTool::N8n => "n8n",
            OptionalTool::BrowserUse => "browser-use",
            OptionalTool::Flowise => "flowise",
            OptionalTool::GitHubCli => "gh",
            OptionalTool::ClaudeCli => "claude",
        }
    }

    fn check_command(&self) -> (&'static str, &'static [&'static str]) {
        match self {
            OptionalTool::N8n => ("n8n", &["--version"]),
            OptionalTool::BrowserUse => ("python", &["-c", "import browser_use"]),
            OptionalTool::Flowise => ("flowise", &["--version"]),
            OptionalTool::GitHubCli => ("gh", &["--version"]),
            OptionalTool::ClaudeCli => ("claude", &["--version"]),
        }
    }

    fn install_command(&self) -> (&'static str, Vec<&'static str>) {
        match self {
            OptionalTool::N8n => ("npm", vec!["install", "-g", "n8n"]),
            OptionalTool::BrowserUse => ("pip", vec!["install", "browser-use"]),
            OptionalTool::Flowise => ("npm", vec!["install", "-g", "flowise"]),
            OptionalTool::GitHubCli => ("winget", vec!["install", "GitHub.cli", "--silent"]),
            OptionalTool::ClaudeCli => ("npm", vec!["install", "-g", "@anthropic-ai/claude-code"]),
        }
    }

    pub fn check_installed(&self) -> ToolStatus {
        let (cmd, args) = self.check_command();
        let output = Command::new(cmd).args(args).output();
        let installed = output.map(|o| o.status.success()).unwrap_or(false);
        ToolStatus {
            tool: self.name().to_string(),
            installed,
            version: None,
        }
    }
}

#[tauri::command]
pub fn get_tool_status() -> Vec<ToolStatus> {
    let tools = [
        OptionalTool::N8n,
        OptionalTool::BrowserUse,
        OptionalTool::Flowise,
        OptionalTool::GitHubCli,
        OptionalTool::ClaudeCli,
    ];
    tools.iter().map(|t| t.check_installed()).collect()
}

#[tauri::command]
pub async fn install_tool(app: AppHandle, tool_name: String) -> Result<(), String> {
    let tool = match tool_name.as_str() {
        "n8n" => OptionalTool::N8n,
        "browser-use" => OptionalTool::BrowserUse,
        "flowise" => OptionalTool::Flowise,
        "gh" => OptionalTool::GitHubCli,
        "claude" => OptionalTool::ClaudeCli,
        _ => return Err(format!("unknown tool: {tool_name}")),
    };

    let (cmd, args) = tool.install_command();
    info!("installing {tool_name}");

    let _ = app.emit("installer://progress", serde_json::json!({
        "tool": tool_name,
        "status": "starting",
        "message": format!("Installing {tool_name}...")
    }));

    let output = Command::new(cmd)
        .args(&args)
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    let _ = app.emit("installer://progress", serde_json::json!({
        "tool": tool_name,
        "status": if output.status.success() { "done" } else { "error" },
        "message": if output.status.success() { stdout } else { stderr }
    }));

    if output.status.success() {
        Ok(())
    } else {
        Err(format!("install failed: {}", String::from_utf8_lossy(&output.stderr)))
    }
}
