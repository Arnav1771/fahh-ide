use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceMetadata {
    pub root: PathBuf,
    pub files: Vec<PathBuf>,
    pub scanned_at_epoch_ms: u128,
}

#[derive(Default, Debug)]
pub struct WorkspaceCache {
    entries: HashMap<PathBuf, WorkspaceMetadata>,
}

impl WorkspaceCache {
    pub fn put(&mut self, metadata: WorkspaceMetadata) {
        self.entries.insert(metadata.root.clone(), metadata);
    }

    pub fn get(&self, root: &Path) -> Option<&WorkspaceMetadata> {
        self.entries.get(root)
    }
}

pub fn scan_workspace(root: &Path, max_depth: usize) -> std::io::Result<WorkspaceMetadata> {
    let mut files = Vec::new();
    walk(root, root, max_depth, 0, &mut files)?;

    Ok(WorkspaceMetadata {
        root: root.to_path_buf(),
        files,
        scanned_at_epoch_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_millis(),
    })
}

fn walk(
    root: &Path,
    current: &Path,
    max_depth: usize,
    depth: usize,
    files: &mut Vec<PathBuf>,
) -> std::io::Result<()> {
    if depth > max_depth {
        return Ok(());
    }

    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name();
        let is_hidden = file_name.to_string_lossy().starts_with('.');
        if is_hidden {
            continue;
        }

        if path.is_dir() {
            walk(root, &path, max_depth, depth + 1, files)?;
        } else {
            files.push(path.strip_prefix(root).unwrap_or(&path).to_path_buf());
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::scan_workspace;
    use std::fs;

    #[test]
    fn scans_workspace_tree() {
        let temp = tempfile::tempdir().expect("tempdir should create");
        fs::write(temp.path().join("main.rs"), "fn main() {}").expect("write should succeed");

        let metadata = scan_workspace(temp.path(), 5).expect("scan should succeed");
        assert_eq!(metadata.files.len(), 1);
    }
}
