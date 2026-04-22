use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRequest {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskResult {
    pub status_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Default, Debug)]
pub struct TaskRunner;

impl TaskRunner {
    pub async fn run(&self, request: TaskRequest) -> Result<TaskResult> {
        let mut command = Command::new(&request.command);
        command.args(&request.args);

        if let Some(cwd) = request.cwd {
            command.current_dir(cwd);
        }

        let output = command.output().await?;
        Ok(TaskResult {
            status_code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}
