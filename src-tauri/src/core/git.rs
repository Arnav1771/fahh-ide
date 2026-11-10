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
    build::CheckoutBuilder, ApplyLocation, ApplyOptions, BranchType, Delta, Diff, DiffFormat,
    DiffOptions, ErrorCode, ObjectType, Oid, Repository, Sort, StashFlags, Status, StatusOptions,
    StatusShow,
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

/// A changed line range against the last commit, for the editor gutter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LineChange {
    /// "added", "modified" or "deleted" (deleted marks the line the removal happened above).
    pub kind: String,
    /// 1-based, inclusive.
    pub start: u32,
    pub end: u32,
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

/// A repository found in the open folder, for the Repositories picker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitRepoInfo {
    /// Absolute work-tree root; pass it as `path` to every other command.
    pub root: String,
    /// The folder name, or the path below the open folder for nested repos.
    pub name: String,
    pub branch: Option<String>,
    /// Changed files (staged + unstaged).
    pub changes: usize,
}

/// A local or remote-tracking branch, for the branch picker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitBranchInfo {
    /// `main`, or `origin/main` for a remote branch.
    pub name: String,
    pub remote: bool,
    pub current: bool,
    pub upstream: Option<String>,
}

/// One `git stash list` entry. `index` 0 is the newest.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStashInfo {
    pub index: usize,
    pub message: String,
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

/// HEAD's branch name, or an error on a detached HEAD.
fn checked_out_branch(repo: &Repository) -> Result<String, String> {
    branch_name(repo)
        .0
        .filter(|b| !b.starts_with("detached"))
        .ok_or_else(|| "check out a branch first (HEAD is detached)".to_string())
}

/// The remote a new branch is published to: `origin`, or the only remote there is.
fn default_remote(repo: &Repository) -> Result<String, String> {
    let remotes = repo.remotes().map_err(map_err)?;
    let names: Vec<&str> = remotes.iter().flatten().collect();
    if names.contains(&"origin") {
        return Ok("origin".into());
    }
    match names.as_slice() {
        [one] => Ok(one.to_string()),
        [] => Err("no remote configured: add one with git remote add origin <url>".into()),
        _ => Err("several remotes and none is called origin: push once from a terminal with git push -u <remote> <branch>".into()),
    }
}

fn push_blocking(path: &str) -> Result<String, String> {
    let repo = require_repo(path)?;
    let dir = workdir(&repo);
    let branch = checked_out_branch(&repo)?;
    if tracking(&repo).0.is_none() {
        // Not published yet: VS Code's "Publish Branch".
        let remote = default_remote(&repo)?;
        return run_git(&dir, &["push", "-u", &remote, &branch]);
    }
    run_git(&dir, &["push"])
}

fn pull_blocking(path: &str) -> Result<String, String> {
    let repo = require_repo(path)?;
    checked_out_branch(&repo)?;
    if tracking(&repo).0.is_none() {
        return Err("this branch has no upstream yet: publish it first".into());
    }
    // Without pull.rebase set, git >= 2.27 refuses to pull divergent branches; merge
    // like VS Code does. A user who set pull.rebase keeps their choice.
    let mut args = vec!["pull", "--no-edit"];
    if repo.config().and_then(|c| c.get_string("pull.rebase")).is_err() {
        args.push("--no-rebase");
    }
    run_git(&workdir(&repo), &args)
}

fn sync_blocking(path: &str) -> Result<String, String> {
    let repo = require_repo(path)?;
    checked_out_branch(&repo)?;
    if tracking(&repo).0.is_none() {
        return push_blocking(path);
    }
    let pulled = pull_blocking(path)?;
    let pushed = push_blocking(path)?;
    Ok(format!("{pulled}\n{pushed}").trim().to_string())
}

/// Network work runs off the UI thread: a fetch can take a while.
async fn off_thread(f: impl FnOnce() -> Result<String, String> + Send + 'static) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

fn status_options() -> StatusOptions {
    let mut opts = StatusOptions::new();
    opts.show(StatusShow::IndexAndWorkdir)
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true)
        .include_ignored(false)
        .include_unmodified(false);
    opts
}

/// Folders under `dir` (itself included, `depth` levels down) that hold a `.git`
/// directory or file (submodules and worktrees have a `.git` file).
// ponytail: fixed depth and skip-list, like VS Code's git.repositoryScanMaxDepth; make
// them settings if people keep repos deeper.
fn find_repos(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if dir.join(".git").exists() {
        out.push(dir.to_path_buf());
    }
    if depth == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let name = e.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || matches!(&*name, "node_modules" | "target" | "dist" | "build" | "vendor") {
            continue;
        }
        // file_type() does not follow symlinks, so a link loop is never walked.
        if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            find_repos(&e.path(), depth - 1, out);
        }
    }
}

/// Comparison key for a path: libgit2 hands back `C:/x/` where Windows gave `C:\x`.
fn path_key(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_string()
}

/// Replace every conflict block in `text` with the chosen side. `choice` is
/// "current" (ours), "incoming" (theirs) or "both". Handles diff3 base sections.
fn resolve_markers(text: &str, choice: &str) -> Result<String, String> {
    if !matches!(choice, "current" | "incoming" | "both") {
        return Err(format!("unknown conflict choice: {choice}"));
    }
    #[derive(PartialEq)]
    enum At { Out, Ours, Base, Theirs }
    let (mut at, mut found) = (At::Out, false);
    let (mut out, mut ours, mut theirs) = (String::new(), String::new(), String::new());
    for line in text.split_inclusive('\n') {
        match at {
            At::Out if line.starts_with("<<<<<<<") => {
                at = At::Ours;
                found = true;
            }
            At::Ours if line.starts_with("|||||||") => at = At::Base,
            At::Ours | At::Base if line.starts_with("=======") => at = At::Theirs,
            At::Theirs if line.starts_with(">>>>>>>") => {
                if choice != "incoming" {
                    out.push_str(&ours);
                }
                if choice != "current" {
                    out.push_str(&theirs);
                }
                ours.clear();
                theirs.clear();
                at = At::Out;
            }
            At::Out => out.push_str(line),
            At::Ours => ours.push_str(line),
            At::Base => {}
            At::Theirs => theirs.push_str(line),
        }
    }
    if at != At::Out {
        return Err("a conflict block is not closed (missing >>>>>>>): fix the file by hand".into());
    }
    if !found {
        return Err("no conflict markers in this file: stage it to mark it resolved".into());
    }
    Ok(out)
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/// Full status snapshot for the folder open in the editor.
#[tauri::command]
pub fn git_status(path: String) -> Result<GitStatus, String> {
    let Some(repo) = discover(&path)? else {
        return Ok(GitStatus::default());
    };

    let (branch, unborn) = branch_name(&repo);

    let mut opts = status_options();
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
/// `amend` rewrites the last commit with the index and the new message (`--amend`).
/// Returns the new commit's full oid.
#[tauri::command]
pub fn git_commit(path: String, message: String, amend: Option<bool>) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("commit message is empty".to_string());
    }

    let repo = require_repo(&path)?;

    let signature = repo
        .signature()
        .map_err(|_| "no git identity configured — set user.name and user.email".to_string())?;

    let mut index = repo.index().map_err(map_err)?;
    if index.has_conflicts() {
        return Err("resolve the merge conflicts before committing".to_string());
    }
    let tree_oid = index.write_tree().map_err(map_err)?;
    let tree = repo.find_tree(tree_oid).map_err(map_err)?;

    if amend == Some(true) {
        let head = repo
            .head()
            .and_then(|h| h.peel_to_commit())
            .map_err(|_| "nothing to amend: there are no commits yet".to_string())?;
        let oid = head
            .amend(Some("HEAD"), None, Some(&signature), None, Some(&message), Some(&tree))
            .map_err(map_err)?;
        return Ok(oid.to_string());
    }

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
    off_thread(move || sync_blocking(&path)).await
}

/// `git fetch --prune` (all of the upstream's refs, so behind counts are current).
#[tauri::command]
pub async fn git_fetch(path: String) -> Result<String, String> {
    off_thread(move || run_git(&workdir(&require_repo(&path)?), &["fetch", "--prune"])).await
}

/// `git pull` (merging, unless the user configured pull.rebase).
#[tauri::command]
pub async fn git_pull(path: String) -> Result<String, String> {
    off_thread(move || pull_blocking(&path)).await
}

/// `git push`; publishes the branch (`push -u <remote> <branch>`) when it has no upstream.
#[tauri::command]
pub async fn git_push(path: String) -> Result<String, String> {
    off_thread(move || push_blocking(&path)).await
}

/// Every repository in the open folder: the one enclosing it (if any), then the ones
/// up to two levels below it, for the Repositories picker.
#[tauri::command]
pub fn git_repositories(path: String) -> Result<Vec<GitRepoInfo>, String> {
    let base = Path::new(&path);
    let base_key = path_key(&path);
    let mut roots: Vec<PathBuf> = discover(&path)?.map(|r| workdir(&r)).into_iter().collect();
    find_repos(base, 2, &mut roots);

    let mut seen = Vec::new();
    let mut out = Vec::new();
    for root in roots {
        let root_str = root.to_string_lossy().to_string();
        let key = path_key(&root_str);
        if seen.contains(&key) {
            continue;
        }
        seen.push(key.clone());
        let Ok(repo) = Repository::open(&root) else { continue };
        let name = match key.strip_prefix(&format!("{base_key}/")) {
            Some(rel) => rel.to_string(),
            None => key.rsplit('/').next().unwrap_or(&key).to_string(),
        };
        let changes = repo.statuses(Some(&mut status_options())).map(|s| s.len()).unwrap_or(0);
        out.push(GitRepoInfo { root: root_str, name, branch: branch_name(&repo).0, changes });
    }
    Ok(out)
}

/// `git init` in `path`.
#[tauri::command]
pub fn git_init(path: String) -> Result<(), String> {
    Repository::init(&path).map(|_| ()).map_err(map_err)
}

/// Local branches, then remote-tracking ones (`origin/HEAD` left out).
#[tauri::command]
pub fn git_branches(path: String) -> Result<Vec<GitBranchInfo>, String> {
    let repo = require_repo(&path)?;
    let mut out = Vec::new();
    for item in repo.branches(None).map_err(map_err)? {
        let (b, kind) = item.map_err(map_err)?;
        let Some(name) = b.name().ok().flatten().map(str::to_string) else { continue };
        let remote = kind == BranchType::Remote;
        if remote && name.ends_with("/HEAD") {
            continue;
        }
        let upstream = if remote {
            None
        } else {
            b.upstream().ok().and_then(|u| u.name().ok().flatten().map(str::to_string))
        };
        out.push(GitBranchInfo { current: b.is_head(), remote, name, upstream });
    }
    out.sort_by(|a, b| (a.remote, &a.name).cmp(&(b.remote, &b.name)));
    Ok(out)
}

/// Switch to `branch` (`git switch`). `create` makes it at HEAD first (`switch -c`).
/// A remote branch (`origin/feature`) gets a local branch that tracks it.
/// Refuses, like git, when local changes would be overwritten.
#[tauri::command]
pub fn git_checkout(path: String, branch: String, create: Option<bool>) -> Result<(), String> {
    let repo = require_repo(&path)?;
    let local = if create == Some(true) {
        let head = repo
            .head()
            .and_then(|h| h.peel_to_commit())
            .map_err(|_| "make a first commit before creating a branch".to_string())?;
        repo.branch(&branch, &head, false).map_err(map_err)?
    } else if let Ok(b) = repo.find_branch(&branch, BranchType::Local) {
        b
    } else {
        let remote = repo.find_branch(&branch, BranchType::Remote).map_err(map_err)?;
        let short = branch.split_once('/').map_or(branch.as_str(), |(_, s)| s);
        let commit = remote.get().peel_to_commit().map_err(map_err)?;
        let mut b = match repo.find_branch(short, BranchType::Local) {
            Ok(b) => b,
            Err(_) => repo.branch(short, &commit, false).map_err(map_err)?,
        };
        b.set_upstream(Some(&branch)).map_err(map_err)?;
        b
    };
    let refname = local.get().name().ok_or("branch name is not valid UTF-8")?.to_string();
    let target = local.get().peel(ObjectType::Commit).map_err(map_err)?;
    repo.checkout_tree(&target, Some(CheckoutBuilder::new().safe())).map_err(map_err)?;
    repo.set_head(&refname).map_err(map_err)
}

/// `git branch -D <branch>`. The UI confirms first; the checked-out branch is refused.
#[tauri::command]
pub fn git_delete_branch(path: String, branch: String) -> Result<(), String> {
    let repo = require_repo(&path)?;
    let mut b = repo.find_branch(&branch, BranchType::Local).map_err(map_err)?;
    if b.is_head() {
        return Err("you are on this branch: switch to another one before deleting it".into());
    }
    b.delete().map_err(map_err)
}

/// `git restore <file>`: throw away work-tree changes. An untracked file is deleted.
#[tauri::command]
pub fn git_discard(path: String, file: String) -> Result<(), String> {
    let repo = require_repo(&path)?;
    let rel = Path::new(&file);
    let untracked = repo.status_file(rel).map(|s| s.contains(Status::WT_NEW)).unwrap_or(false);
    if untracked {
        let abs = workdir(&repo).join(rel);
        return if abs.is_dir() { std::fs::remove_dir_all(abs) } else { std::fs::remove_file(abs) }
            .map_err(|e| e.to_string());
    }
    repo.checkout_index(None, Some(CheckoutBuilder::new().force().path(rel)))
        .map_err(map_err)
}

/// Stage, unstage or discard one hunk of `file`. `hunk` counts the `@@` headers of
/// the matching `git_diff` text from 0. `staged = true` unstages; otherwise
/// `discard` picks discard over stage.
// ponytail: whole hunks only; line-level staging needs a patch builder.
#[tauri::command]
pub fn git_apply_hunk(path: String, file: String, hunk: usize, staged: bool, discard: bool) -> Result<(), String> {
    let repo = require_repo(&path)?;
    let mut opts = DiffOptions::new();
    opts.pathspec(&file)
        .include_untracked(true)
        .show_untracked_content(true)
        .context_lines(3)
        // Unstage and discard apply the change backwards.
        .reverse(staged || discard);
    let (diff, at) = if staged {
        let tree = match repo.head() {
            Ok(head) => Some(head.peel_to_tree().map_err(map_err)?),
            Err(e) if e.code() == ErrorCode::UnbornBranch => None,
            Err(e) => return Err(map_err(e)),
        };
        (repo.diff_tree_to_index(tree.as_ref(), None, Some(&mut opts)).map_err(map_err)?, ApplyLocation::Index)
    } else {
        let at = if discard { ApplyLocation::WorkDir } else { ApplyLocation::Index };
        (repo.diff_index_to_workdir(None, Some(&mut opts)).map_err(map_err)?, at)
    };
    let mut seen = 0usize;
    let mut apply = ApplyOptions::new();
    apply.hunk_callback(|_| {
        seen += 1;
        seen == hunk + 1
    });
    repo.apply(&diff, at, Some(&mut apply)).map_err(map_err)
}

/// Rewrite every conflict block in `file` with one side (`current`, `incoming` or
/// `both`), save it and stage it, which marks it resolved.
#[tauri::command]
pub fn git_resolve_conflict(path: String, file: String, choice: String) -> Result<(), String> {
    let repo = require_repo(&path)?;
    let abs = workdir(&repo).join(&file);
    let text = std::fs::read_to_string(&abs).map_err(|e| e.to_string())?;
    std::fs::write(&abs, resolve_markers(&text, &choice)?).map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(map_err)?;
    index.add_path(Path::new(&file)).map_err(map_err)?;
    index.write().map_err(map_err)
}

/// `git stash list`, newest first.
#[tauri::command]
pub fn git_stash_list(path: String) -> Result<Vec<GitStashInfo>, String> {
    let mut repo = require_repo(&path)?;
    let mut out = Vec::new();
    repo.stash_foreach(|index, message, _| {
        out.push(GitStashInfo { index, message: message.to_string() });
        true
    })
    .map_err(map_err)?;
    Ok(out)
}

/// `git stash push --include-untracked [-m message]`.
#[tauri::command]
pub fn git_stash_push(path: String, message: Option<String>) -> Result<(), String> {
    let mut repo = require_repo(&path)?;
    let sig = repo
        .signature()
        .map_err(|_| "no git identity configured — set user.name and user.email".to_string())?;
    let message = message.filter(|m| !m.trim().is_empty());
    match repo.stash_save(&sig, message.as_deref().unwrap_or("WIP"), Some(StashFlags::INCLUDE_UNTRACKED)) {
        Ok(_) => Ok(()),
        Err(e) if e.code() == ErrorCode::NotFound => Err("nothing to stash: no local changes".into()),
        Err(e) => Err(map_err(e)),
    }
}

/// `git stash pop stash@{index}`. Leaves the stash in place when applying conflicts.
#[tauri::command]
pub fn git_stash_pop(path: String, index: usize) -> Result<(), String> {
    let mut repo = require_repo(&path)?;
    repo.stash_pop(index, None).map_err(map_err)
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

/// Lines of `content` (the editor text) that differ from the file in HEAD. Empty when the
/// folder is not a repo or the file is not committed yet.
#[tauri::command]
pub fn git_line_changes(path: String, file: String, content: String) -> Result<Vec<LineChange>, String> {
    let Some(repo) = discover(&path)? else { return Ok(Vec::new()) };
    let rel = repo_relative(&repo, &file);
    let Ok(head) = repo.head().and_then(|h| h.peel_to_tree()) else { return Ok(Vec::new()) };
    let Ok(entry) = head.get_path(Path::new(&rel)) else { return Ok(Vec::new()) };
    let blob = repo.find_blob(entry.id()).map_err(map_err)?;
    let mut opts = DiffOptions::new();
    opts.context_lines(0);
    let patch = git2::Patch::from_blob_and_buffer(&blob, None, content.as_bytes(), None, Some(&mut opts)).map_err(map_err)?;
    let mut out = Vec::new();
    for i in 0..patch.num_hunks() {
        let (h, _) = patch.hunk(i).map_err(map_err)?;
        let (start, new_lines, old_lines) = (h.new_start(), h.new_lines(), h.old_lines());
        out.push(match (old_lines, new_lines) {
            (0, n) => LineChange { kind: "added".into(), start, end: start + n - 1 },
            (_, 0) => LineChange { kind: "deleted".into(), start: start.max(1), end: start.max(1) },
            (_, n) => LineChange { kind: "modified".into(), start, end: start + n - 1 },
        });
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
    fn line_changes_against_head() {
        let dir = std::env::temp_dir().join(format!("fahh-gutter-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = Repository::init(&dir).unwrap();
        commit_file(&repo, "a.txt", "one\ntwo\nthree\nfour\n", "add a");
        let p = dir.to_string_lossy().to_string();
        let f = dir.join("a.txt").to_string_lossy().to_string();
        // two changed, a line added after four, three removed
        let now = "one\nTWO\nfour\nfive\n".to_string();
        let ch = git_line_changes(p.clone(), f.clone(), now).unwrap();
        let kinds: Vec<(&str, u32, u32)> = ch.iter().map(|c| (c.kind.as_str(), c.start, c.end)).collect();
        assert!(kinds.contains(&("modified", 2, 2)) || kinds.contains(&("modified", 2, 3)), "{kinds:?}");
        assert!(kinds.iter().any(|k| k.0 == "added" && k.1 == 4), "{kinds:?}");
        assert!(git_line_changes(p.clone(), f.clone(), "one\ntwo\nthree\nfour\n".into()).unwrap().is_empty());
        assert!(git_line_changes(p, dir.join("new.txt").to_string_lossy().to_string(), "x".into()).unwrap().is_empty(), "untracked: no markers");
        let _ = std::fs::remove_dir_all(&dir);
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

    // ── Real repos on disk, driven through the same commands the UI calls ──

    /// Run the git CLI in `dir`, panicking with its output on failure.
    fn git(dir: &Path, args: &[&str]) -> String {
        let out = std::process::Command::new("git").args(args).current_dir(dir).output().unwrap();
        let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        assert!(out.status.success(), "git {args:?}: {text}");
        text
    }

    /// A fresh repo (via `git_init`) with a local identity, so tests never depend on ~/.gitconfig.
    fn new_repo(dir: &Path) -> String {
        std::fs::create_dir_all(dir).unwrap();
        let p = dir.to_string_lossy().to_string();
        git_init(p.clone()).unwrap();
        let mut cfg = Repository::open(dir).unwrap().config().unwrap();
        cfg.set_str("user.name", "Fahh Test").unwrap();
        cfg.set_str("user.email", "test@fahh.dev").unwrap();
        p
    }

    fn write(dir: &Path, name: &str, body: &str) {
        std::fs::write(dir.join(name), body).unwrap();
    }

    fn stage_commit(p: &str, file: &str, msg: &str) -> String {
        git_stage(p.into(), file.into()).unwrap();
        git_commit(p.into(), msg.into(), None).unwrap()
    }

    fn head_branch(p: &str) -> String {
        git_status(p.into()).unwrap().branch.unwrap()
    }

    #[test]
    fn init_stage_unstage_commit_amend() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("r");
        assert!(!git_status(tmp.path().to_string_lossy().into()).unwrap().is_repo, "plain folder is not a repo");
        let p = new_repo(&dir);
        let st = git_status(p.clone()).unwrap();
        assert!(st.is_repo && st.unborn);

        write(&dir, "a.txt", "hello\n");
        assert_eq!(git_status(p.clone()).unwrap().unstaged[0].status, GitChangeStatus::Untracked);
        git_stage(p.clone(), "a.txt".into()).unwrap();
        assert_eq!(git_status(p.clone()).unwrap().staged.len(), 1);
        git_unstage(p.clone(), "a.txt".into()).unwrap();
        assert!(git_status(p.clone()).unwrap().staged.is_empty(), "unstage on an unborn branch");
        stage_commit(&p, "a.txt", "first");
        assert!(isclean(&p));

        write(&dir, "a.txt", "hello again\n");
        git_stage(p.clone(), "a.txt".into()).unwrap();
        let oid = git_commit(p.clone(), "first, fixed".into(), Some(true)).unwrap();
        let repo = Repository::open(&dir).unwrap();
        let head = repo.find_commit(Oid::from_str(&oid).unwrap()).unwrap();
        assert_eq!(head.summary(), Some("first, fixed"));
        assert_eq!(head.parent_count(), 0, "amend replaces, it does not stack");
        assert!(git_commit(p, "  ".into(), None).is_err(), "empty message refused");
    }

    fn isclean(p: &str) -> bool {
        let st = git_status(p.into()).unwrap();
        st.staged.is_empty() && st.unstaged.is_empty()
    }

    #[test]
    fn branches_switch_create_delete() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let p = new_repo(&dir);
        assert!(git_checkout(p.clone(), "early".into(), Some(true)).is_err(), "no commit to branch from yet");
        write(&dir, "a.txt", "1\n");
        stage_commit(&p, "a.txt", "one");
        let main = head_branch(&p);

        git_checkout(p.clone(), "feat".into(), Some(true)).unwrap();
        assert_eq!(head_branch(&p), "feat");
        write(&dir, "a.txt", "2\n");
        stage_commit(&p, "a.txt", "two");

        git_checkout(p.clone(), main.clone(), None).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "1\n", "work tree follows the branch");
        let names: Vec<(String, bool)> = git_branches(p.clone()).unwrap().into_iter().map(|b| (b.name, b.current)).collect();
        assert!(names.contains(&(main.clone(), true)) && names.contains(&("feat".into(), false)), "{names:?}");

        write(&dir, "a.txt", "dirty\n");
        assert!(git_checkout(p.clone(), "feat".into(), None).is_err(), "local changes would be overwritten");
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "dirty\n", "refused switch keeps the edit");
        git_discard(p.clone(), "a.txt".into()).unwrap();

        assert!(git_delete_branch(p.clone(), main.clone()).is_err(), "can't delete the current branch");
        git_delete_branch(p.clone(), "feat".into()).unwrap();
        assert_eq!(git_branches(p).unwrap().len(), 1);
    }

    #[test]
    fn discard_restores_tracked_and_deletes_untracked() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let p = new_repo(&dir);
        write(&dir, "a.txt", "keep\n");
        stage_commit(&p, "a.txt", "one");
        write(&dir, "a.txt", "oops\n");
        write(&dir, "junk.txt", "x\n");
        git_discard(p.clone(), "a.txt".into()).unwrap();
        git_discard(p.clone(), "junk.txt".into()).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "keep\n");
        assert!(!dir.join("junk.txt").exists());
        assert!(isclean(&p));
    }

    #[test]
    fn stash_push_list_pop() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let p = new_repo(&dir);
        write(&dir, "a.txt", "1\n");
        stage_commit(&p, "a.txt", "one");
        assert!(git_stash_push(p.clone(), None).is_err(), "nothing to stash");

        write(&dir, "a.txt", "2\n");
        write(&dir, "new.txt", "n\n");
        git_stash_push(p.clone(), Some("half done".into())).unwrap();
        assert!(isclean(&p), "stash takes untracked files too");
        let list = git_stash_list(p.clone()).unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].message.contains("half done"), "{:?}", list[0]);

        git_stash_pop(p.clone(), 0).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "2\n");
        assert!(dir.join("new.txt").exists());
        assert!(git_stash_list(p).unwrap().is_empty());
    }

    #[test]
    fn merge_conflict_is_reported_and_resolved() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let p = new_repo(&dir);
        write(&dir, "a.txt", "top\nbase\nbottom\n");
        stage_commit(&p, "a.txt", "base");
        let main = head_branch(&p);
        git_checkout(p.clone(), "other".into(), Some(true)).unwrap();
        write(&dir, "a.txt", "top\ntheirs\nbottom\n");
        stage_commit(&p, "a.txt", "theirs");
        git_checkout(p.clone(), main, None).unwrap();
        write(&dir, "a.txt", "top\nours\nbottom\n");
        stage_commit(&p, "a.txt", "ours");

        let out = std::process::Command::new("git").args(["merge", "other"]).current_dir(&dir).output().unwrap();
        assert!(!out.status.success(), "merge must conflict");
        let st = git_status(p.clone()).unwrap();
        assert_eq!(st.unstaged.iter().map(|c| c.status).collect::<Vec<_>>(), [GitChangeStatus::Conflicted]);
        assert!(st.staged.is_empty(), "a conflict is not a staged change");
        assert!(git_commit(p.clone(), "merge".into(), None).is_err(), "commit refused while conflicted");

        git_resolve_conflict(p.clone(), "a.txt".into(), "both".into()).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "top\nours\ntheirs\nbottom\n");
        let st = git_status(p.clone()).unwrap();
        assert!(st.unstaged.is_empty() && st.staged.len() == 1, "resolved file is staged");
        git_commit(p, "merge other".into(), None).unwrap();
    }

    #[test]
    fn conflict_marker_choices() {
        let text = "a\n<<<<<<< HEAD\nmine\n||||||| base\nold\n=======\nyours\n>>>>>>> other\nz\n";
        assert_eq!(resolve_markers(text, "current").unwrap(), "a\nmine\nz\n");
        assert_eq!(resolve_markers(text, "incoming").unwrap(), "a\nyours\nz\n");
        assert_eq!(resolve_markers(text, "both").unwrap(), "a\nmine\nyours\nz\n");
        assert!(resolve_markers("a\n<<<<<<< HEAD\nmine\n", "current").is_err(), "unterminated");
        assert!(resolve_markers("plain\n", "current").is_err(), "no markers");
        assert!(resolve_markers(text, "theirs").is_err(), "unknown choice");
    }

    #[test]
    fn hunks_stage_unstage_discard() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let p = new_repo(&dir);
        let lines: Vec<String> = (1..=20).map(|i| format!("line {i}\n")).collect();
        write(&dir, "f.txt", &lines.concat());
        stage_commit(&p, "f.txt", "twenty lines");
        let mut edited = lines.clone();
        edited[1] = "LINE 2\n".into();
        edited[17] = "LINE 18\n".into();
        write(&dir, "f.txt", &edited.concat());
        let diff = |staged| git_diff(p.clone(), "f.txt".into(), staged).unwrap();
        assert_eq!(diff(false).lines().filter(|l| l.starts_with("@@")).count(), 2, "two hunks: {}", diff(false));

        git_apply_hunk(p.clone(), "f.txt".into(), 1, false, false).unwrap();
        assert!(diff(true).contains("+LINE 18") && !diff(true).contains("LINE 2\n"), "only hunk 2 staged: {}", diff(true));
        assert!(diff(false).contains("+LINE 2") && !diff(false).contains("LINE 18"), "{}", diff(false));

        git_apply_hunk(p.clone(), "f.txt".into(), 0, true, false).unwrap();
        assert!(diff(true).is_empty(), "unstaged again");

        git_apply_hunk(p.clone(), "f.txt".into(), 0, false, true).unwrap();
        let now = std::fs::read_to_string(dir.join("f.txt")).unwrap();
        assert!(now.contains("line 2\n") && now.contains("LINE 18\n"), "only hunk 1 discarded: {now}");
    }

    #[test]
    fn publish_fetch_pull_push_against_a_bare_remote() {
        let tmp = tempfile::tempdir().unwrap();
        let bare = tmp.path().join("remote.git");
        git(tmp.path(), &["init", "--bare", "-q", bare.to_str().unwrap()]);

        let a = tmp.path().join("a");
        let pa = new_repo(&a);
        write(&a, "a.txt", "1\n");
        stage_commit(&pa, "a.txt", "one");
        assert!(push_blocking(&pa).unwrap_err().contains("no remote"), "publish without a remote explains itself");
        git(&a, &["remote", "add", "origin", bare.to_str().unwrap()]);
        assert!(pull_blocking(&pa).is_err(), "pull before publish");
        push_blocking(&pa).unwrap(); // publish
        let branch = head_branch(&pa);
        assert_eq!(git_status(pa.clone()).unwrap().upstream, Some(format!("origin/{branch}")));

        // A second clone pushes a commit; `a` sees it after a fetch and gets it with pull.
        git(tmp.path(), &["clone", "-q", bare.to_str().unwrap(), "b"]);
        let b = tmp.path().join("b");
        git(&b, &["-c", "user.name=B", "-c", "user.email=b@x", "commit", "-q", "--allow-empty", "-m", "from b"]);
        git(&b, &["push", "-q"]);
        tauri::async_runtime::block_on(git_fetch(pa.clone())).unwrap();
        assert_eq!(git_status(pa.clone()).unwrap().behind, 1);
        pull_blocking(&pa).unwrap();
        assert_eq!(git_status(pa.clone()).unwrap().behind, 0);

        // Both sides commit: a plain push is rejected, sync merges then pushes.
        git(&b, &["-c", "user.name=B", "-c", "user.email=b@x", "commit", "-q", "--allow-empty", "-m", "b again"]);
        git(&b, &["push", "-q"]);
        write(&a, "a.txt", "2\n");
        stage_commit(&pa, "a.txt", "two");
        let err = push_blocking(&pa).unwrap_err();
        assert!(err.contains("rejected"), "non-fast-forward reported: {err}");
        sync_blocking(&pa).unwrap();
        let st = git_status(pa).unwrap();
        assert_eq!((st.ahead, st.behind), (0, 0));
        git(&b, &["pull", "-q", "--no-rebase"]);
        assert_eq!(std::fs::read_to_string(b.join("a.txt")).unwrap(), "2\n", "b received a's commit");
    }

    #[test]
    fn repositories_lists_nested_repos() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join("work");
        new_repo(&base.join("api"));
        new_repo(&base.join("libs").join("ui"));
        new_repo(&base.join("node_modules").join("dep"));
        write(&base.join("api"), "x.txt", "x\n");
        let repos = git_repositories(base.to_string_lossy().into()).unwrap();
        let names: Vec<(&str, usize)> = repos.iter().map(|r| (r.name.as_str(), r.changes)).collect();
        assert_eq!(names, [("api", 1), ("libs/ui", 0)]);

        // Opening a repo's own folder (or a folder inside it) lists it once.
        let api = base.join("api");
        assert_eq!(git_repositories(api.to_string_lossy().into()).unwrap().len(), 1);
        std::fs::create_dir_all(api.join("src")).unwrap();
        let inner = git_repositories(api.join("src").to_string_lossy().into()).unwrap();
        assert_eq!(inner.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["api"]);
    }
}
