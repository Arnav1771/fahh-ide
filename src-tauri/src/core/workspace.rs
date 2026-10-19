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
