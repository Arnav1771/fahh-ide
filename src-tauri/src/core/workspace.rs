use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileEntry>>,
}

fn build_tree(path: &Path, depth: usize) -> Result<FileEntry> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let is_dir = path.is_dir();

    let children = if is_dir && depth < 5 {
        let mut entries: Vec<FileEntry> = match std::fs::read_dir(path) {
            Ok(read_dir) => read_dir
                .filter_map(|e| e.ok())
                .filter(|e| {
                    let name = e.file_name();
                    let s = name.to_string_lossy();
                    !s.starts_with('.') && s != "node_modules" && s != "target"
                })
                .filter_map(|e| build_tree(&e.path(), depth + 1).ok())
                .collect(),
            Err(_) => Vec::new(),
        };
        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Some(entries)
    } else {
        None
    };

    Ok(FileEntry {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir,
        children,
    })
}

#[tauri::command]
pub fn get_file_tree(root: String) -> Result<FileEntry, String> {
    let path = PathBuf::from(&root);
    if !path.exists() {
        return Err(format!("path does not exist: {root}"));
    }
    build_tree(&path, 0).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    match std::fs::read(&path) {
        Ok(bytes) => Ok(String::from_utf8_lossy(&bytes).to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_file(path: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::File::create(&path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn rename_file(from: String, to: String) -> Result<(), String> {
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

/// Explorer > New Folder. Fails when something already has that name.
#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        return Err(format!("{} already exists", p.display()));
    }
    std::fs::create_dir_all(p).map_err(|e| e.to_string())
}

/// Explorer drag and drop: move a file or folder into `dir`, keeping its name.
/// Returns the new path. Refuses to overwrite, and to move a folder into itself.
#[tauri::command]
pub fn move_path(from: String, dir: String) -> Result<String, String> {
    let src = Path::new(&from);
    let name = src.file_name().ok_or_else(|| format!("cannot move {from}"))?;
    if !src.exists() {
        return Err(format!("{from} does not exist"));
    }
    let dir_path = Path::new(&dir);
    if !dir_path.is_dir() {
        return Err(format!("{dir} is not a folder"));
    }
    // Compare real paths, so "a/./b" or a symlinked spelling cannot sneak a folder into itself.
    let real_src = src.canonicalize().map_err(|e| e.to_string())?;
    let real_dir = dir_path.canonicalize().map_err(|e| e.to_string())?;
    if real_dir.starts_with(&real_src) {
        return Err("cannot move a folder into itself".into());
    }
    let dest = dir_path.join(name);
    if real_src.parent() == Some(real_dir.as_path()) {
        return Ok(src.to_string_lossy().to_string()); // already there
    }
    if dest.exists() {
        return Err(format!("{} already exists in {dir}", name.to_string_lossy()));
    }
    std::fs::rename(src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

/// Show a file or folder in the system file manager (Explorer selects it; Finder reveals it;
/// Linux opens the folder that holds it).
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("{path} does not exist"));
    }
    #[cfg(windows)]
    let spawned = {
        use std::os::windows::process::CommandExt;
        crate::core::proc::cmd("explorer").raw_arg(format!("/select,\"{path}\"")).spawn()
    };
    #[cfg(target_os = "macos")]
    let spawned = crate::core::proc::cmd("open").arg("-R").arg(p).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = {
        let target = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
        crate::core::proc::cmd("xdg-open").arg(target).spawn()
    };
    spawned.map(|_| ()).map_err(|e| format!("could not open the file manager: {e}"))
}

const SEARCH_SKIP_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist", ".fahh", ".next", "build", ".cache", "coverage", ".turbo",
];

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchMatch {
    pub file: String,
    pub line_number: usize,
    pub line_text: String,
    pub match_start: usize,
    pub match_end: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub query: String,
    pub total_matches: usize,
    pub files_searched: usize,
    pub matches: Vec<SearchMatch>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReplaceResult {
    pub files_modified: usize,
    pub total_replacements: usize,
}

// Tauri commands take flat named arguments from the frontend, so the list cannot shrink without changing the IPC contract.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn search_workspace(
    root: String,
    query: String,
    case_sensitive: Option<bool>,
    whole_word: Option<bool>,
    is_regex: Option<bool>,
    include_glob: Option<String>,
    exclude_glob: Option<String>,
    max_results: Option<usize>,
) -> Result<SearchResult, String> {
    if query.is_empty() {
        return Ok(SearchResult {
            query,
            total_matches: 0,
            files_searched: 0,
            matches: Vec::new(),
        });
    }

    let root_path = PathBuf::from(&root);
    if !root_path.exists() {
        return Err(format!("Workspace root does not exist: {root}"));
    }

    let is_case = case_sensitive.unwrap_or(false);
    let is_word = whole_word.unwrap_or(false);
    let is_reg = is_regex.unwrap_or(false);
    let max_hits = max_results.unwrap_or(1000);

    let pattern_str = if is_reg {
        if is_word {
            format!(r"\b(?:{})\b", query)
        } else {
            query.clone()
        }
    } else {
        let escaped = regex::escape(&query);
        if is_word {
            format!(r"\b{}\b", escaped)
        } else {
            escaped
        }
    };

    let mut regex_builder = regex::RegexBuilder::new(&pattern_str);
    regex_builder.case_insensitive(!is_case);
    let re = regex_builder.build().map_err(|e| format!("Invalid regex: {e}"))?;

    let mut matches = Vec::new();
    let mut files_searched = 0;

    let walker = WalkDir::new(&root_path)
        .into_iter()
        .filter_entry(|e| {
            if e.file_type().is_dir() {
                let name = e.file_name().to_string_lossy();
                !SEARCH_SKIP_DIRS.contains(&name.as_ref())
            } else {
                true
            }
        });

    for entry in walker.filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }

        if let Ok(meta) = entry.metadata() {
            if meta.len() > 2_000_000 {
                continue;
            }
        }

        let abs_path = entry.path();
        let rel_path = abs_path
            .strip_prefix(&root_path)
            .unwrap_or(abs_path)
            .to_string_lossy()
            .replace('\\', "/");

        if let Some(ref incl) = include_glob {
            let incl_trimmed = incl.trim();
            if !incl_trimmed.is_empty() {
                let matches_any = incl_trimmed.split(',').any(|pattern| {
                    let pat = pattern.trim();
                    if pat.is_empty() {
                        return true;
                    }
                    crate::agent::perm::glob_match(pat, &rel_path)
                        || crate::agent::perm::glob_match(pat, entry.file_name().to_string_lossy().as_ref())
                });
                if !matches_any {
                    continue;
                }
            }
        }

        if let Some(ref excl) = exclude_glob {
            let excl_trimmed = excl.trim();
            if !excl_trimmed.is_empty() {
                let matches_excl = excl_trimmed.split(',').any(|pattern| {
                    let pat = pattern.trim();
                    if pat.is_empty() {
                        return false;
                    }
                    crate::agent::perm::glob_match(pat, &rel_path)
                        || crate::agent::perm::glob_match(pat, entry.file_name().to_string_lossy().as_ref())
                });
                if matches_excl {
                    continue;
                }
            }
        }

        let Ok(text) = std::fs::read_to_string(abs_path) else {
            continue;
        };

        files_searched += 1;

        for (line_idx, line) in text.lines().enumerate() {
            for m in re.find_iter(line) {
                matches.push(SearchMatch {
                    file: abs_path.to_string_lossy().to_string(),
                    line_number: line_idx + 1,
                    line_text: line.to_string(),
                    match_start: m.start(),
                    match_end: m.end(),
                });

                if matches.len() >= max_hits {
                    return Ok(SearchResult {
                        query,
                        total_matches: matches.len(),
                        files_searched,
                        matches,
                    });
                }
            }
        }
    }

    Ok(SearchResult {
        query,
        total_matches: matches.len(),
        files_searched,
        matches,
    })
}

// Tauri commands take flat named arguments from the frontend, so the list cannot shrink without changing the IPC contract.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn replace_in_workspace(
    root: String,
    query: String,
    replacement: String,
    case_sensitive: Option<bool>,
    whole_word: Option<bool>,
    is_regex: Option<bool>,
    include_glob: Option<String>,
    exclude_glob: Option<String>,
    files: Option<Vec<String>>,
) -> Result<ReplaceResult, String> {
    if query.is_empty() {
        return Ok(ReplaceResult {
            files_modified: 0,
            total_replacements: 0,
        });
    }

    let is_case = case_sensitive.unwrap_or(false);
    let is_word = whole_word.unwrap_or(false);
    let is_reg = is_regex.unwrap_or(false);

    let pattern_str = if is_reg {
        if is_word {
            format!(r"\b(?:{})\b", query)
        } else {
            query.clone()
        }
    } else {
        let escaped = regex::escape(&query);
        if is_word {
            format!(r"\b{}\b", escaped)
        } else {
            escaped
        }
    };

    let mut regex_builder = regex::RegexBuilder::new(&pattern_str);
    regex_builder.case_insensitive(!is_case);
    let re = regex_builder.build().map_err(|e| format!("Invalid regex: {e}"))?;

    let target_files: Vec<PathBuf> = if let Some(explicit_files) = files {
        explicit_files.into_iter().map(PathBuf::from).collect()
    } else {
        let root_path = PathBuf::from(&root);
        let mut list = Vec::new();
        let walker = WalkDir::new(&root_path)
            .into_iter()
            .filter_entry(|e| {
                if e.file_type().is_dir() {
                    let name = e.file_name().to_string_lossy();
                    !SEARCH_SKIP_DIRS.contains(&name.as_ref())
                } else {
                    true
                }
            });

        for entry in walker.filter_map(Result::ok) {
            if !entry.file_type().is_file() {
                continue;
            }
            if let Ok(meta) = entry.metadata() {
                if meta.len() > 2_000_000 {
                    continue;
                }
            }
            let abs_path = entry.path();
            let rel_path = abs_path
                .strip_prefix(&root_path)
                .unwrap_or(abs_path)
                .to_string_lossy()
                .replace('\\', "/");

            if let Some(ref incl) = include_glob {
                let incl_trimmed = incl.trim();
                if !incl_trimmed.is_empty() {
                    let matches_any = incl_trimmed.split(',').any(|pat| {
                        let p = pat.trim();
                        p.is_empty()
                            || crate::agent::perm::glob_match(p, &rel_path)
                            || crate::agent::perm::glob_match(p, entry.file_name().to_string_lossy().as_ref())
                    });
                    if !matches_any {
                        continue;
                    }
                }
            }

            if let Some(ref excl) = exclude_glob {
                let excl_trimmed = excl.trim();
                if !excl_trimmed.is_empty() {
                    let matches_excl = excl_trimmed.split(',').any(|pat| {
                        let p = pat.trim();
                        !p.is_empty()
                            && (crate::agent::perm::glob_match(p, &rel_path)
                                || crate::agent::perm::glob_match(p, entry.file_name().to_string_lossy().as_ref()))
                    });
                    if matches_excl {
                        continue;
                    }
                }
            }
            list.push(abs_path.to_path_buf());
        }
        list
    };

    let mut files_modified = 0;
    let mut total_replacements = 0;

    for file_path in target_files {
        if let Ok(content) = std::fs::read_to_string(&file_path) {
            let count = re.find_iter(&content).count();
            if count > 0 {
                let replaced = re.replace_all(&content, replacement.as_str());
                if std::fs::write(&file_path, replaced.as_bytes()).is_ok() {
                    files_modified += 1;
                    total_replacements += count;
                }
            }
        }
    }

    Ok(ReplaceResult {
        files_modified,
        total_replacements,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(p: &Path) -> String {
        p.to_string_lossy().to_string()
    }

    #[test]
    fn create_dir_makes_nested_folders_and_refuses_existing() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path().join("a").join("b");
        create_dir(s(&d)).unwrap();
        assert!(d.is_dir());
        assert!(create_dir(s(&d)).unwrap_err().contains("already exists"));
    }

    #[test]
    fn move_path_moves_files_and_folders_into_a_folder() {
        let t = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(t.path().join("src/lib")).unwrap();
        std::fs::create_dir_all(t.path().join("dst")).unwrap();
        std::fs::write(t.path().join("src/a.txt"), "a").unwrap();
        std::fs::write(t.path().join("src/lib/b.txt"), "b").unwrap();

        let to = move_path(s(&t.path().join("src/a.txt")), s(&t.path().join("dst"))).unwrap();
        assert_eq!(Path::new(&to), t.path().join("dst/a.txt"));
        assert_eq!(std::fs::read_to_string(&to).unwrap(), "a");
        assert!(!t.path().join("src/a.txt").exists());

        move_path(s(&t.path().join("src/lib")), s(&t.path().join("dst"))).unwrap();
        assert_eq!(std::fs::read_to_string(t.path().join("dst/lib/b.txt")).unwrap(), "b");
    }

    #[test]
    fn move_path_guards() {
        let t = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(t.path().join("a/inner")).unwrap();
        std::fs::create_dir_all(t.path().join("b")).unwrap();
        std::fs::write(t.path().join("x.txt"), "1").unwrap();
        std::fs::write(t.path().join("b/x.txt"), "2").unwrap();
        // into itself, or into its own child
        assert!(move_path(s(&t.path().join("a")), s(&t.path().join("a"))).unwrap_err().contains("into itself"));
        assert!(move_path(s(&t.path().join("a")), s(&t.path().join("a/inner"))).unwrap_err().contains("into itself"));
        // never overwrites
        assert!(move_path(s(&t.path().join("x.txt")), s(&t.path().join("b"))).unwrap_err().contains("already exists"));
        assert_eq!(std::fs::read_to_string(t.path().join("b/x.txt")).unwrap(), "2");
        // onto a file, or from nowhere
        assert!(move_path(s(&t.path().join("a")), s(&t.path().join("x.txt"))).is_err());
        assert!(move_path(s(&t.path().join("nope")), s(&t.path().join("b"))).is_err());
        // dropping where it already is changes nothing
        let same = move_path(s(&t.path().join("x.txt")), s(t.path())).unwrap();
        assert_eq!(Path::new(&same), t.path().join("x.txt"));
        assert!(t.path().join("x.txt").exists());
    }

    #[test]
    fn reveal_path_rejects_missing_paths() {
        assert!(reveal_path("/definitely/not/here/fahh".into()).unwrap_err().contains("does not exist"));
    }
}
