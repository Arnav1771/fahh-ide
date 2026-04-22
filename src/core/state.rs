use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionState {
    pub open_files: Vec<String>,
    pub active_file: Option<String>,
    pub last_workspace: Option<String>,
}

#[derive(Clone, Debug)]
pub struct StateStore {
    path: PathBuf,
}

impl StateStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn load(&self) -> Result<SessionState> {
        if !Path::new(&self.path).exists() {
            return Ok(SessionState::default());
        }

        let content = fs::read_to_string(&self.path)?;
        Ok(serde_json::from_str(&content)?)
    }

    pub fn save(&self, state: &SessionState) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let data = serde_json::to_string_pretty(state)?;
        fs::write(&self.path, data)?;
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

#[cfg(test)]
mod tests {
    use super::{SessionState, StateStore};

    #[test]
    fn roundtrips_session_state() {
        let dir = tempfile::tempdir().expect("tempdir should create");
        let store = StateStore::new(dir.path().join("session.json"));

        let original = SessionState {
            open_files: vec!["src/main.rs".to_string()],
            active_file: Some("src/main.rs".to_string()),
            last_workspace: Some("/workspace".to_string()),
        };

        store.save(&original).expect("save should succeed");
        let loaded = store.load().expect("load should succeed");

        assert_eq!(original, loaded);
    }
}
