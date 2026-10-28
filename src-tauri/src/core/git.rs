//! Git integration for the Source Control sidebar.
//!
//! Backed by the `git2` crate (libgit2) rather than shelling out to the `git`
//! binary: no dependency on git being on PATH, no locale-dependent porcelain
//! parsing, and no process spawn per keystroke when the sidebar refreshes.
//!
//! Every command takes a `path` — any path inside the working tree. The repo
//! is located with `Repository::discover`, so passing a nested folder works.
//!
//! Opening a folder that is not a git repository is a normal, expected state
//! and is NOT an error: `git_status` returns `is_repo: false` with empty file
//! lists so the sidebar can render an honest empty state. Only genuine
//! failures (unreadable index, bad object database, …) come back as `Err`.

use std::path::{Path, PathBuf};

use git2::{
    BranchType, Delta, Diff, DiffFormat, DiffOptions, ErrorCode, Oid, Repository, Sort, Status,
    StatusOptions, StatusShow,
};
use serde::{Deserialize, Serialize};

// ─── Wire types ───────────────────────────────────────────────────────────────

/// How a single file changed. Mirrors the subset of git status the sidebar
/// renders; the string values are what the TypeScript `GitChangeStatus` union
/// expects.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitChangeStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Typechange,
    Untracked,
    Conflicted,
}

/// One changed file, either in the index (staged) or the working tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitFileChange {
    /// Path relative to the repository root, forward-slashed.
    pub path: String,
    pub status: GitChangeStatus,
    /// `true` when this entry came from the index, `false` for the work tree.
    pub staged: bool,
}

/// Everything the sidebar needs for one refresh.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GitStatus {
    /// `false` when the folder simply is not under version control. Not an error.
    pub is_repo: bool,
    /// Absolute path to the work-tree root (empty when `is_repo` is false).
    pub repo_root: String,
    /// Short branch name, or `None` on a detached HEAD / unborn branch.
    pub branch: Option<String>,
    /// `true` before the very first commit — HEAD points at a ref that does
    /// not exist yet. Unstaging is a no-op in that state.
    pub unborn: bool,
    pub staged: Vec<GitFileChange>,
    pub unstaged: Vec<GitFileChange>,
    /// Upstream branch (`origin/main`), `None` when the branch is not published.
    pub upstream: Option<String>,
    /// Commits on HEAD that the upstream lacks (to push).
    pub ahead: usize,
    /// Commits on the upstream that HEAD lacks (to pull).
    pub behind: usize,
}

/// One commit in a file's history, for the Timeline view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommitInfo {
    pub oid: String,
    pub short: String,
    pub summary: String,
    pub author: String,
    /// Seconds since the epoch.
    pub time: i64,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn map_err(e: git2::Error) -> String {
    e.message().to_string()
}

/// Locate the repository containing `path`. Returns `Ok(None)` when there is
/// no repository above `path` — the caller decides whether that is an error.
fn discover(path: &str) -> Result<Option<Repository>, String> {
    match Repository::discover(Path::new(path)) {
        Ok(repo) => Ok(Some(repo)),
        Err(e) if e.code() == ErrorCode::NotFound => Ok(None),
        Err(e) => Err(map_err(e)),
    }
}

/// Same as [`discover`] but turns "no repository" into an `Err`, for the
/// mutating commands where there is nothing sensible to return.
fn require_repo(path: &str) -> Result<Repository, String> {
    discover(path)?.ok_or_else(|| "not a git repository".to_string())
}

fn workdir(repo: &Repository) -> PathBuf {
    repo.workdir()
        .unwrap_or_else(|| repo.path())
        .to_path_buf()
}

/// Translate the index half of a `git2::Status` bitset.
fn staged_status(s: Status) -> Option<GitChangeStatus> {
    if s.contains(Status::CONFLICTED) {
        return Some(GitChangeStatus::Conflicted);
    }
    if s.contains(Status::INDEX_NEW) {
        Some(GitChangeStatus::Added)
    } else if s.contains(Status::INDEX_DELETED) {
        Some(GitChangeStatus::Deleted)
    } else if s.contains(Status::INDEX_RENAMED) {
        Some(GitChangeStatus::Renamed)
    } else if s.contains(Status::INDEX_TYPECHANGE) {
        Some(GitChangeStatus::Typechange)
    } else if s.contains(Status::INDEX_MODIFIED) {
        Some(GitChangeStatus::Modified)
    } else {
        None
    }
}

/// Translate the work-tree half of a `git2::Status` bitset.
fn unstaged_status(s: Status) -> Option<GitChangeStatus> {
    if s.contains(Status::CONFLICTED) {
        return Some(GitChangeStatus::Conflicted);
    }
    if s.contains(Status::WT_NEW) {
        Some(GitChangeStatus::Untracked)
    } else if s.contains(Status::WT_DELETED) {
        Some(GitChangeStatus::Deleted)
    } else if s.contains(Status::WT_RENAMED) {
        Some(GitChangeStatus::Renamed)
    } else if s.contains(Status::WT_TYPECHANGE) {
        Some(GitChangeStatus::Typechange)
    } else if s.contains(Status::WT_MODIFIED) {
        Some(GitChangeStatus::Modified)
    } else {
        None
    }
}

/// Short branch name for HEAD. `None` on detached HEAD or an unborn branch.
fn branch_name(repo: &Repository) -> (Option<String>, bool) {
    match repo.head() {
        Ok(head) => {
            if head.is_branch() {
                (head.shorthand().map(str::to_string), false)
            } else {
                // Detached HEAD — surface the short oid so the UI shows something.
                let short = head
                    .target()
                    .map(|oid| format!("detached @ {:.7}", oid.to_string()));
                (short, false)
            }
        }
        Err(e) if e.code() == ErrorCode::UnbornBranch => {
            // HEAD exists but points at a ref with no commits yet. The ref name
            // is still the branch the first commit will land on.
            let name = repo
                .find_reference("HEAD")
                .ok()
                .and_then(|r| r.symbolic_target().map(str::to_string))
                .map(|t| t.trim_start_matches("refs/heads/").to_string());
            (name, true)
        }
        Err(_) => (None, false),
    }
}

/// Upstream name and ahead/behind counts for HEAD's branch. Uses the last fetched
/// state of the remote; `git_sync` fetches.
fn tracking(repo: &Repository) -> (Option<String>, usize, usize) {
    let Ok(head) = repo.head() else { return (None, 0, 0) };
    let Some(name) = head.shorthand().filter(|_| head.is_branch()) else { return (None, 0, 0) };
    let Ok(up) = repo.find_branch(name, BranchType::Local).and_then(|b| b.upstream()) else {
        return (None, 0, 0);
    };
    let up_name = up.name().ok().flatten().map(str::to_string);
    match (head.target(), up.get().target()) {
        (Some(local), Some(remote)) => match repo.graph_ahead_behind(local, remote) {
            Ok((a, b)) => (up_name, a, b),
            Err(_) => (up_name, 0, 0),
        },
        _ => (up_name, 0, 0),
    }
}

/// `file` (absolute or repo-relative) as a forward-slashed path relative to the work tree.
fn repo_relative(repo: &Repository, file: &str) -> String {
    let root = workdir(repo);
    let canon = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let abs = Path::new(file);
    let rel = if abs.is_absolute() {
        canon(abs)
            .strip_prefix(canon(&root))
            .map(Path::to_path_buf)
            .unwrap_or_else(|_| abs.strip_prefix(&root).unwrap_or(abs).to_path_buf())
    } else {
        abs.to_path_buf()
    };
    rel.to_string_lossy().replace('\\', "/")
}

/// A diff as unified patch text (`+`, `-`, ` ` prefixed lines).
fn patch_text(diff: &Diff) -> Result<String, String> {
    let mut out = String::new();
    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        if matches!(line.origin(), '+' | '-' | ' ') {
            out.push(line.origin());
        }
        out.push_str(&String::from_utf8_lossy(line.content()));
        true
    })
    .map_err(map_err)?;
    if out.is_empty() && diff.deltas().any(|d| d.flags().is_binary() || d.status() == Delta::Renamed) {
        return Ok("(binary or rename-only change — no textual diff)".to_string());
    }
    Ok(out)
}

/// Run the `git` CLI in `dir`. Used only for network operations (pull/push), which
/// need the user's credential helper and SSH setup that libgit2 does not have.
fn run_git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = crate::core::proc::cmd("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("could not run git ({e}). Install Git to pull and push."))?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    if out.status.success() { Ok(text.trim().to_string()) } else { Err(text.trim().to_string()) }
}

fn sync_blocking(path: &str) -> Result<String, String> {
    let repo = require_repo(path)?;
    let dir = workdir(&repo);
    let (branch, _) = branch_name(&repo);
    let branch = branch.filter(|b| !b.starts_with("detached")).ok_or("check out a branch to sync")?;
    if tracking(&repo).0.is_none() {
        // Not published yet: VS Code's "Publish Branch".
        return run_git(&dir, &["push", "-u", "origin", &branch]);
    }
    let pulled = run_git(&dir, &["pull", "--no-edit"])?;
    let pushed = run_git(&dir, &["push"])?;
    Ok(format!("{pulled}\n{pushed}").trim().to_string())
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/// Full status snapshot for the folder open in the editor.
#[tauri::command]
pub fn git_status(path: String) -> Result<GitStatus, String> {
    let Some(repo) = discover(&path)? else {
        return Ok(GitStatus::default());
    };

    let (branch, unborn) = branch_name(&repo);

    let mut opts = StatusOptions::new();
    opts.show(StatusShow::IndexAndWorkdir)
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true)
        .include_ignored(false)
        .include_unmodified(false);

    let statuses = repo.statuses(Some(&mut opts)).map_err(map_err)?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();

    for entry in statuses.iter() {
        let Some(file) = entry.path() else { continue };
        let bits = entry.status();

        if let Some(status) = staged_status(bits) {
            // A conflicted file is a working-tree problem, not a staged change.
            if status != GitChangeStatus::Conflicted {
                staged.push(GitFileChange {
                    path: file.to_string(),
                    status,
                    staged: true,
                });
            }
        }
        if let Some(status) = unstaged_status(bits) {
            unstaged.push(GitFileChange {
                path: file.to_string(),
                status,
                staged: false,
            });
        }
    }

    staged.sort_by(|a, b| a.path.cmp(&b.path));
    unstaged.sort_by(|a, b| a.path.cmp(&b.path));
    let (upstream, ahead, behind) = tracking(&repo);

    Ok(GitStatus {
        is_repo: true,
        repo_root: workdir(&repo).to_string_lossy().to_string(),
        branch,
        unborn,
        staged,
        unstaged,
        upstream,
        ahead,
        behind,
    })
}

/// Short branch name only — cheap enough to poll for the status bar.
#[tauri::command]
pub fn git_current_branch(path: String) -> Result<Option<String>, String> {
    match discover(&path)? {
        Some(repo) => Ok(branch_name(&repo).0),
        None => Ok(None),
    }
}

/// `git add <file>`. Handles deletions too: a file that is gone from the work
/// tree is staged with `remove_path` instead of `add_path`.
#[tauri::command]
pub fn git_stage(path: String, file: String) -> Result<(), String> {
    let repo = require_repo(&path)?;
    let root = workdir(&repo);
    let rel = Path::new(&file);

    let mut index = repo.index().map_err(map_err)?;
    if root.join(rel).exists() {
        index.add_path(rel).map_err(map_err)?;
    } else {
        index.remove_path(rel).map_err(map_err)?;
    }
    index.write().map_err(map_err)
}

/// `git restore --staged <file>` — reset the index entry back to HEAD.
/// On an unborn branch there is no HEAD to reset to, so the entry is simply
/// dropped from the index, which is the same observable result.
#[tauri::command]
pub fn git_unstage(path: String, file: String) -> Result<(), String> {
    let repo = require_repo(&path)?;
    let rel = Path::new(&file);

    let head = match repo.head() {
        Ok(head) => Some(head),
        Err(e) if e.code() == ErrorCode::UnbornBranch => None,
        Err(e) => return Err(map_err(e)),
    };

    match head {
        Some(head) => {
            let obj = head.peel(git2::ObjectType::Commit).map_err(map_err)?;
            repo.reset_default(Some(&obj), [rel]).map_err(map_err)
        }
        None => {
            let mut index = repo.index().map_err(map_err)?;
            index.remove_path(rel).map_err(map_err)?;
            index.write().map_err(map_err)
        }
    }
}

/// `git commit -m <message>` using whatever identity git config provides.
/// Returns the new commit's full oid.
#[tauri::command]
pub fn git_commit(path: String, message: String) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("commit message is empty".to_string());
    }

    let repo = require_repo(&path)?;

    let signature = repo
        .signature()
        .map_err(|_| "no git identity configured — set user.name and user.email".to_string())?;

    let mut index = repo.index().map_err(map_err)?;
    let tree_oid = index.write_tree().map_err(map_err)?;
    let tree = repo.find_tree(tree_oid).map_err(map_err)?;

    let parents: Vec<git2::Commit> = match repo.head() {
        Ok(head) => vec![head.peel_to_commit().map_err(map_err)?],
        Err(e) if e.code() == ErrorCode::UnbornBranch => Vec::new(),
        Err(e) => return Err(map_err(e)),
    };
    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

    if parent_refs.is_empty() && tree.is_empty() {
        return Err("nothing to commit".to_string());
    }

    let oid = repo
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            &message,
            &tree,
            &parent_refs,
        )
        .map_err(map_err)?;

    Ok(oid.to_string())
}

/// Unified diff for one file. `staged = true` diffs HEAD against the index,
/// `false` diffs the index against the working tree.
///
/// Untracked files have no blob on either side, so libgit2 produces nothing;
/// in that case the file's current contents are returned as an all-additions
/// diff so the UI has something to show.
#[tauri::command]
pub fn git_diff(path: String, file: String, staged: bool) -> Result<String, String> {
    let repo = require_repo(&path)?;

    let mut opts = DiffOptions::new();
    opts.pathspec(&file)
        .include_untracked(true)
        .show_untracked_content(true)
        .context_lines(3);

    let diff = if staged {
        let tree = match repo.head() {
            Ok(head) => Some(head.peel_to_tree().map_err(map_err)?),
            Err(e) if e.code() == ErrorCode::UnbornBranch => None,
            Err(e) => return Err(map_err(e)),
        };
        repo.diff_tree_to_index(tree.as_ref(), None, Some(&mut opts))
            .map_err(map_err)?
    } else {
        repo.diff_index_to_workdir(None, Some(&mut opts))
            .map_err(map_err)?
    };

    patch_text(&diff)
}

/// Pull, then push (VS Code's Sync Changes). Publishes the branch when it has no
/// upstream yet. Runs off the UI thread: the network can take a while.
#[tauri::command]
pub async fn git_sync(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || sync_blocking(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// Commits that changed `file`, newest first, for the Timeline view.
// ponytail: compares the blob at one path per commit, so history stops at a rename
// (no --follow); scans at most 5000 commits.
#[tauri::command]
pub fn git_file_log(path: String, file: String, limit: Option<usize>) -> Result<Vec<GitCommitInfo>, String> {
    let Some(repo) = discover(&path)? else { return Ok(Vec::new()) };
    let rel = repo_relative(&repo, &file);
    let limit = limit.unwrap_or(50);
    let mut walk = repo.revwalk().map_err(map_err)?;
    if walk.push_head().is_err() {
        return Ok(Vec::new()); // no commits yet
    }
    walk.set_sorting(Sort::TIME).map_err(map_err)?;
    let blob_at = |tree: &git2::Tree| tree.get_path(Path::new(&rel)).ok().map(|e| e.id());
    let mut out = Vec::new();
    for oid in walk.take(5000) {
        let commit = repo.find_commit(oid.map_err(map_err)?).map_err(map_err)?;
        let now = blob_at(&commit.tree().map_err(map_err)?);
        let before = match commit.parent(0) {
            Ok(p) => blob_at(&p.tree().map_err(map_err)?),
            Err(_) => None,
        };
        if now == before {
            continue;
        }
        let id = commit.id().to_string();
        out.push(GitCommitInfo {
            short: id[..7].to_string(),
            oid: id,
            summary: commit.summary().unwrap_or("").to_string(),
            author: commit.author().name().unwrap_or("").to_string(),
            time: commit.time().seconds(),
        });
        if out.len() >= limit {
            break;
        }
    }
    Ok(out)
}

/// What commit `oid` changed in `file`, as a unified diff against its first parent.
#[tauri::command]
pub fn git_file_commit_diff(path: String, oid: String, file: String) -> Result<String, String> {
    let repo = require_repo(&path)?;
    let commit = repo.find_commit(Oid::from_str(&oid).map_err(map_err)?).map_err(map_err)?;
    let tree = commit.tree().map_err(map_err)?;
    let parent = commit.parent(0).ok().map(|p| p.tree()).transpose().map_err(map_err)?;
    let mut opts = DiffOptions::new();
    opts.pathspec(repo_relative(&repo, &file)).context_lines(3);
    let diff = repo
        .diff_tree_to_tree(parent.as_ref(), Some(&tree), Some(&mut opts))
        .map_err(map_err)?;
    patch_text(&diff)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn commit_file(repo: &Repository, name: &str, body: &str, msg: &str) {
        std::fs::write(workdir(repo).join(name), body).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(name)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = git2::Signature::now("t", "t@example.com").unwrap();
        let parents: Vec<git2::Commit> = repo.head().ok().and_then(|h| h.peel_to_commit().ok()).into_iter().collect();
        let refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &refs).unwrap();
    }

    #[test]
    fn file_log_and_commit_diff() {
        let dir = std::env::temp_dir().join(format!("fahh-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = Repository::init(&dir).unwrap();
        commit_file(&repo, "a.txt", "one\n", "add a");
        commit_file(&repo, "b.txt", "x\n", "add b");
        commit_file(&repo, "a.txt", "two\n", "edit a");
        let p = dir.to_string_lossy().to_string();

        let abs = dir.join("a.txt").to_string_lossy().to_string();
        let log = git_file_log(p.clone(), abs.clone(), None).unwrap();
        let msgs: Vec<&str> = log.iter().map(|c| c.summary.as_str()).collect();
        assert_eq!(msgs, ["edit a", "add a"], "b.txt commit must be skipped");

        let diff = git_file_commit_diff(p.clone(), log[0].oid.clone(), abs).unwrap();
        assert!(diff.contains("-one") && diff.contains("+two"), "{diff}");

        let st = git_status(p).unwrap();
        assert_eq!((st.upstream, st.ahead, st.behind), (None, 0, 0));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
