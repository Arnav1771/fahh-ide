/**
 * Source Control sidebar.
 *
 * Talks to the git2-backed Tauri commands in `src-tauri/src/core/git.rs`
 * through the wrappers in `src/lib/tauri.ts`. All state lives in
 * `useGitStore`; all formatting lives in `src/lib/git.ts`.
 *
 * Every state is a real screen, not a crash: no folder open, loading, a folder
 * that is not a repository (with Initialise), a repository (clean or changed),
 * and a folder holding several repositories (the Repositories picker).
 */

import { useEffect, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  CircleAlert,
  CloudDownload,
  CloudUpload,
  FileDiff,
  FolderGit2,
  GitBranch,
  GitCommit,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";

import { useFileStore } from "../../store/fileStore";
import { useGitStore } from "../../store/gitStore";
import { confirmDialog, promptDialog } from "../../store/dialogStore";
import { gitDiff } from "../../lib/tauri";
import {
  branchLabel,
  canCommit,
  changeCount,
  conflicted,
  fileDir,
  fileName,
  friendlyGitError,
  isClean,
  sortChanges,
  statusColor,
  statusLabel,
  statusLetter,
  suggestCommitMessage,
} from "../../lib/git";
import type { GitConflictChoice, GitFileChange } from "../../lib/types";

const ICON_BTN =
  "p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface/60 disabled:opacity-40 disabled:pointer-events-none transition-colors";

// ─── One row in the changed-files list ────────────────────────────────────────

function ChangeRow({
  change,
  busy,
  onToggle,
  onDiscard,
  onShowDiff,
}: {
  change: GitFileChange;
  busy: boolean;
  onToggle: () => void;
  onDiscard?: () => void;
  onShowDiff: () => void;
}) {
  const dir = fileDir(change.path);

  return (
    <div
      className="group flex items-center gap-1 px-2 py-[3px] rounded hover:bg-fahh-surface/60"
      title={`${statusLabel(change.status)} — ${change.path}`}
      data-testid="git-change-row"
    >
      <button onClick={onShowDiff} className="flex-1 min-w-0 flex items-baseline gap-1.5 text-left">
        <span className="truncate text-xs text-fahh-text">{fileName(change.path)}</span>
        {dir && <span className="truncate text-[10px] text-fahh-muted shrink min-w-0">{dir}</span>}
      </button>

      {onDiscard && (
        <button
          onClick={onDiscard}
          disabled={busy}
          title="Discard changes"
          aria-label={`Discard changes to ${change.path}`}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-40 text-fahh-muted hover:text-fahh-error transition-opacity shrink-0"
        >
          <Undo2 size={13} />
        </button>
      )}
      <button
        onClick={onToggle}
        disabled={busy}
        title={change.staged ? "Unstage" : "Stage"}
        aria-label={`${change.staged ? "Unstage" : "Stage"} ${change.path}`}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-40 text-fahh-muted hover:text-fahh-text transition-opacity shrink-0"
      >
        {change.staged ? <Minus size={13} /> : <Plus size={13} />}
      </button>

      <span className={`w-3 text-center text-[11px] font-bold shrink-0 ${statusColor(change.status)}`}>
        {statusLetter(change.status)}
      </span>
    </div>
  );
}

// ─── A staged / unstaged group ────────────────────────────────────────────────

function GroupHeader({ title, count, action }: { title: string; count: number; action?: { label: string; run: () => void } }) {
  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <span className="fahh-label text-[10px] uppercase tracking-widest text-fahh-muted font-semibold">{title}</span>
      <span className="text-[10px] text-fahh-muted">({count})</span>
      <div className="flex-1" />
      {action && (
        <button onClick={action.run} className="text-[10px] text-fahh-muted hover:text-fahh-accent transition-colors">
          {action.label}
        </button>
      )}
    </div>
  );
}

function ChangeGroup({
  title,
  changes,
  busy,
  actionLabel,
  onAction,
  onToggle,
  onDiscard,
  onShowDiff,
}: {
  title: string;
  changes: GitFileChange[];
  busy: string[];
  actionLabel: string;
  onAction: () => void;
  onToggle: (change: GitFileChange) => void;
  onDiscard?: (change: GitFileChange) => void;
  onShowDiff: (change: GitFileChange) => void;
}) {
  if (changes.length === 0) return null;

  return (
    <div className="mb-2">
      <GroupHeader title={title} count={changes.length} action={{ label: actionLabel, run: onAction }} />
      {sortChanges(changes).map((change) => (
        <ChangeRow
          key={`${change.staged ? "s" : "u"}:${change.path}`}
          change={change}
          busy={busy.includes(change.path)}
          onToggle={() => onToggle(change)}
          onDiscard={onDiscard && (() => onDiscard(change))}
          onShowDiff={() => onShowDiff(change)}
        />
      ))}
    </div>
  );
}

/** Conflicted files, with VS Code's accept current / incoming / both. */
function MergeGroup({ changes, onResolve, onShowDiff }: { changes: GitFileChange[]; onResolve: (file: string, c: GitConflictChoice) => void; onShowDiff: (c: GitFileChange) => void }) {
  if (changes.length === 0) return null;
  const choice = (file: string, c: GitConflictChoice, label: string, hint: string) => (
    <button
      onClick={() => onResolve(file, c)}
      title={hint}
      className="px-1.5 py-[1px] rounded border border-fahh-surface text-[10px] text-fahh-muted hover:text-fahh-text hover:border-fahh-accent transition-colors"
    >
      {label}
    </button>
  );
  return (
    <div className="mb-2" data-testid="git-merge-group">
      <GroupHeader title="Merge Changes" count={changes.length} />
      {changes.map((c) => (
        <div key={c.path} className="px-2 py-1 rounded hover:bg-fahh-surface/60">
          <button onClick={() => onShowDiff(c)} className="flex items-baseline gap-1.5 min-w-0 w-full text-left">
            <span className="text-[11px] font-bold text-fahh-error">!</span>
            <span className="truncate text-xs text-fahh-text">{fileName(c.path)}</span>
            {fileDir(c.path) && <span className="truncate text-[10px] text-fahh-muted">{fileDir(c.path)}</span>}
          </button>
          <div className="flex gap-1 mt-1 pl-3">
            {choice(c.path, "current", "Current", "Keep your side of every conflict, then stage the file")}
            {choice(c.path, "incoming", "Incoming", "Keep the incoming side of every conflict, then stage the file")}
            {choice(c.path, "both", "Both", "Keep both sides (yours first), then stage the file")}
          </div>
        </div>
      ))}
      <p className="px-3 pt-1 text-[10px] text-fahh-muted">Or edit the markers by hand and stage the file to mark it resolved.</p>
    </div>
  );
}

// ─── Diff viewer ──────────────────────────────────────────────────────────────

export function DiffView({
  file,
  text,
  onClose,
  hunkActions,
}: {
  file: string;
  text: string;
  onClose: () => void;
  /** Buttons on every `@@` line; `run` gets the hunk's index (0-based). */
  hunkActions?: { label: string; danger?: boolean; run: (hunk: number) => void }[];
}) {
  let hunk = -1;
  return (
    <div className="border-t border-fahh-surface flex flex-col max-h-64 shrink-0" data-testid="git-diff">
      <div className="flex items-center gap-1 px-2 py-1 bg-fahh-surface/40">
        <FileDiff size={12} className="text-fahh-muted shrink-0" />
        <span className="truncate text-[11px] text-fahh-text">{file}</span>
        <div className="flex-1" />
        <button onClick={onClose} className="text-fahh-muted hover:text-fahh-text" title="Close diff" aria-label="Close diff">
          <X size={12} />
        </button>
      </div>

      <pre className="flex-1 overflow-auto px-2 py-1 text-[10px] leading-relaxed font-mono whitespace-pre">
        {text.split("\n").map((line, i) => {
          const isHunk = line.startsWith("@@");
          const index = isHunk ? ++hunk : -1;
          return (
            <div
              key={i}
              className={`${
                line.startsWith("+") && !line.startsWith("+++")
                  ? "text-fahh-success"
                  : line.startsWith("-") && !line.startsWith("---")
                  ? "text-fahh-error"
                  : isHunk
                  ? "text-fahh-accent"
                  : "text-fahh-muted"
              }${isHunk && hunkActions ? " flex items-center gap-2" : ""}`}
            >
              {line || " "}
              {isHunk &&
                hunkActions?.map((a) => (
                  <button
                    key={a.label}
                    onClick={() => a.run(index)}
                    className={`font-sans text-[10px] px-1.5 rounded border border-fahh-surface bg-fahh-sidebar ${
                      a.danger ? "hover:text-fahh-error hover:border-fahh-error" : "hover:text-fahh-text hover:border-fahh-accent"
                    } text-fahh-muted transition-colors`}
                  >
                    {a.label}
                  </button>
                ))}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function GitSidebar() {
  const root = useFileStore((s) => s.root);
  const {
    repos,
    repo,
    status,
    stashes,
    loading,
    error,
    commitMessage,
    amend,
    busy,
    committing,
    syncing,
    lastCommit,
    setRoot,
    setCommitMessage,
    setAmend,
    setBranchPickerOpen,
    selectRepo,
    loadRepos,
    init,
    stage,
    unstage,
    stageAll,
    unstageAll,
    discard,
    applyHunk,
    resolve,
    commit,
    fetch,
    pull,
    push,
    stash,
    popStash,
    dismissLastCommit,
  } = useGitStore();

  const [diff, setDiff] = useState<{ file: string; text: string; staged: boolean; untracked: boolean } | null>(null);
  const path = repo ?? root;

  // Follow the folder the explorer has open (setRoot scans it for repositories).
  useEffect(() => {
    setRoot(root);
  }, [root, setRoot]);

  // A diff belongs to one repository.
  useEffect(() => setDiff(null), [path]);

  const showDiff = async (file: string, staged: boolean, untracked = false, closeIfEmpty = false) => {
    if (!path) return;
    try {
      const text = await gitDiff(path, file, staged);
      if (!text.trim() && closeIfEmpty) setDiff(null);
      else setDiff({ file, text: text.trim() ? text : "(no textual changes)", staged, untracked });
    } catch (err) {
      setDiff({ file, text: friendlyGitError(err), staged, untracked });
    }
  };

  const confirmDiscard = async (c: GitFileChange) => {
    const untracked = c.status === "untracked";
    const ok = await confirmDialog({
      title: untracked ? `Delete ${fileName(c.path)}?` : `Discard changes to ${fileName(c.path)}?`,
      message: untracked ? `${c.path} is not tracked by git, so it will be deleted from disk.` : `Your edits to ${c.path} since the last stage are lost. This can't be undone.`,
      ok: untracked ? "Delete file" : "Discard changes",
      danger: true,
    });
    if (ok) await discard(c.path);
  };

  const hunk = async (index: number, discardIt: boolean) => {
    if (!diff) return;
    if (discardIt && !(await confirmDialog({ title: "Discard this change?", message: `The lines in this block of ${diff.file} go back to the staged version.`, ok: "Discard", danger: true }))) return;
    await applyHunk(diff.file, index, diff.staged, discardIt);
    await showDiff(diff.file, diff.staged, diff.untracked, true);
  };

  const askStash = async () => {
    const message = await promptDialog({ title: "Stash changes", message: "Put every change (untracked files too) aside and clean the working tree.", placeholder: "Message (optional)", ok: "Stash" });
    if (message !== null) await stash(message || undefined);
  };

  // ── Header, shared by every state ──
  const header = (
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-fahh-surface shrink-0">
      <span className="fahh-label text-[10px] uppercase tracking-widest text-fahh-muted font-semibold">Source Control</span>
      <div className="flex-1" />
      <button
        onClick={() => void loadRepos()}
        disabled={loading || !root}
        title="Refresh"
        aria-label="Refresh source control"
        className="text-fahh-muted hover:text-fahh-text disabled:opacity-40 transition-colors"
      >
        <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
      </button>
    </div>
  );

  const shell = (body: React.ReactNode) => (
    <div className="flex flex-col h-full bg-fahh-sidebar" data-testid="git-sidebar">
      {header}
      {body}
    </div>
  );

  // ── Nothing open ──
  if (!root) return shell(<div className="p-3 text-xs text-fahh-muted">Open a folder to see source control.</div>);

  // ── First load: a skeleton shaped like the view ──
  if (loading && !status.is_repo && !error) {
    return shell(
      <div className="p-3 space-y-2 animate-pulse" aria-busy="true" aria-label="Loading source control">
        <div className="h-3 w-1/2 rounded bg-fahh-surface" />
        <div className="h-12 rounded bg-fahh-surface/70" />
        <div className="h-3 w-3/4 rounded bg-fahh-surface/70" />
        <div className="h-3 w-2/3 rounded bg-fahh-surface/70" />
      </div>
    );
  }

  // ── Hard failure talking to git ──
  if (error && !status.is_repo) {
    return shell(
      <div className="p-3 space-y-2">
        <div className="flex items-start gap-2 text-xs text-fahh-error" role="alert">
          <CircleAlert size={14} className="shrink-0 mt-[1px]" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
        <button onClick={() => void loadRepos()} className="text-[11px] text-fahh-accent hover:underline">
          Try again
        </button>
      </div>
    );
  }

  // ── A folder, but not a repository ──
  if (!status.is_repo) {
    return shell(
      <div className="p-3 space-y-3" data-testid="git-empty">
        <div className="flex items-start gap-2">
          <FolderGit2 size={16} className="text-fahh-muted shrink-0 mt-[1px]" />
          <p className="text-xs text-fahh-text">This folder isn't a git repository.</p>
        </div>
        <p className="text-[11px] text-fahh-muted">Initialise one to track changes, commit and branch. Nothing leaves your machine until you push.</p>
        <button
          onClick={() => void init()}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium bg-fahh-accent/90 text-white hover:bg-fahh-accent transition-colors"
        >
          <GitBranch size={12} /> Initialise repository
        </button>
      </div>
    );
  }

  // ── A repository ──
  const total = changeCount(status);
  const conflicts = conflicted(status);
  const unstaged = status.unstaged.filter((c) => c.status !== "conflicted");
  const detached = !status.branch || status.branch.startsWith("detached");
  const onCommitKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (canCommit(status, commitMessage, amend) && !committing) void commit();
    }
  };

  return (
    <div className="flex flex-col h-full bg-fahh-sidebar overflow-hidden" data-testid="git-sidebar">
      {header}

      {/* Repositories picker: only when the folder holds more than one */}
      {repos.length > 1 && (
        <div className="border-b border-fahh-surface py-1 shrink-0 max-h-40 overflow-y-auto" data-testid="git-repos">
          <GroupHeader title="Repositories" count={repos.length} />
          {repos.map((r) => (
            <button
              key={r.root}
              onClick={() => void selectRepo(r.root)}
              aria-pressed={r.root === repo}
              title={r.root}
              className={`w-full flex items-center gap-1.5 px-3 py-[3px] text-left text-xs transition-colors ${
                r.root === repo ? "bg-fahh-surface text-fahh-text" : "text-fahh-muted hover:bg-fahh-surface/60 hover:text-fahh-text"
              }`}
            >
              <FolderGit2 size={12} className={r.root === repo ? "text-fahh-accent shrink-0" : "shrink-0"} />
              <span className="truncate">{r.name}</span>
              <span className="flex-1" />
              <span className="flex items-center gap-0.5 text-[10px] text-fahh-muted shrink-0">
                <GitBranch size={10} />
                <span className="max-w-[90px] truncate">{r.branch ?? "detached"}</span>
              </span>
              {r.changes > 0 && <span className="text-[10px] text-fahh-warn shrink-0">{r.changes}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Branch chip + remote actions */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-fahh-surface shrink-0">
        <button
          onClick={() => setBranchPickerOpen(true)}
          title="Switch, create or delete a branch"
          data-testid="git-branch-chip"
          className="flex items-center gap-1 min-w-0 px-1 py-0.5 rounded hover:bg-fahh-surface/60 transition-colors"
        >
          <GitBranch size={12} className="text-fahh-accent shrink-0" />
          <span className="truncate text-[11px] text-fahh-text">{branchLabel(status)}</span>
          <ChevronDown size={11} className="text-fahh-muted shrink-0" />
        </button>
        <span className="text-[10px] text-fahh-muted shrink-0 ml-1">
          {total === 0 ? "clean" : `${total} changed`}
          {status.upstream && (status.ahead > 0 || status.behind > 0) ? ` · ${status.behind}↓ ${status.ahead}↑` : ""}
        </span>
        <div className="flex-1" />
        <button onClick={() => void fetch()} disabled={syncing || !status.upstream} title="Fetch" aria-label="Fetch" className={ICON_BTN}>
          <CloudDownload size={13} />
        </button>
        <button onClick={() => void pull()} disabled={syncing || detached || !status.upstream} title={status.upstream ? `Pull from ${status.upstream}` : "Publish the branch before pulling"} aria-label="Pull" className={ICON_BTN}>
          <ArrowDownToLine size={13} />
        </button>
        <button
          onClick={() => void push()}
          disabled={syncing || detached || status.unborn}
          title={status.upstream ? `Push to ${status.upstream}` : "Publish branch"}
          aria-label={status.upstream ? "Push" : "Publish branch"}
          className={ICON_BTN}
        >
          {status.upstream ? <ArrowUpFromLine size={13} /> : <CloudUpload size={13} />}
        </button>
        <button onClick={() => void askStash()} disabled={total === 0} title="Stash changes" aria-label="Stash changes" className={ICON_BTN}>
          <Archive size={13} />
        </button>
        {syncing && <RefreshCw size={12} className="animate-spin text-fahh-accent ml-0.5" aria-label="Working with the remote" />}
      </div>

      {/* Commit box */}
      <div className="px-2 py-2 border-b border-fahh-surface shrink-0">
        <div className="flex items-center justify-between pb-1">
          <span className="text-[10px] text-fahh-muted uppercase tracking-wider font-semibold">Commit</span>
          <button
            type="button"
            onClick={() => {
              const suggested = suggestCommitMessage(status);
              if (suggested) setCommitMessage(suggested);
            }}
            disabled={status.staged.length === 0 && status.unstaged.length === 0}
            className="flex items-center gap-1 text-[10px] text-fahh-accent hover:text-fahh-accent/80 transition-colors disabled:opacity-30"
            title="Suggest a Conventional Commit message from the changed files"
          >
            <Sparkles size={10} /> Suggest
          </button>
        </div>
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={onCommitKey}
          aria-label="Commit message"
          data-testid="git-commit-message"
          placeholder={status.staged.length === 0 && !amend ? "Stage a file to commit…" : "Message (Ctrl+Enter to commit)"}
          rows={2}
          className="w-full resize-none bg-fahh-bg border border-fahh-surface rounded px-2 py-1 text-xs text-fahh-text placeholder:text-fahh-muted focus:outline-none focus:border-fahh-accent"
        />
        <label className="flex items-center gap-1.5 pt-1 text-[10px] text-fahh-muted select-none">
          <input type="checkbox" checked={amend} disabled={status.unborn} onChange={(e) => setAmend(e.target.checked)} className="accent-fahh-accent" />
          Amend the last commit
        </label>
        <button
          onClick={() => void commit()}
          disabled={!canCommit(status, commitMessage, amend) || committing}
          data-testid="git-commit-button"
          className="mt-1.5 w-full flex items-center justify-center gap-1.5 py-1 rounded text-xs font-medium bg-fahh-accent/90 text-white hover:bg-fahh-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <GitCommit size={12} />
          {committing ? "Committing…" : amend ? "Amend commit" : "Commit"}
        </button>
      </div>

      {/* Errors from an action (the repo itself is fine) */}
      {error && (
        <div className="px-3 py-1.5 flex items-start gap-1.5 text-[11px] text-fahh-error border-b border-fahh-surface shrink-0" role="alert">
          <CircleAlert size={12} className="shrink-0 mt-[1px]" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      {/* Commit confirmation */}
      {lastCommit && (
        <button onClick={dismissLastCommit} aria-live="polite" className="px-3 py-1.5 flex items-center gap-1.5 text-[11px] text-fahh-success border-b border-fahh-surface shrink-0">
          <Check size={12} />
          Committed {lastCommit}
        </button>
      )}

      {/* Changed files */}
      <div className="flex-1 overflow-y-auto py-1">
        {isClean(status) ? (
          <p className="px-3 py-2 text-xs text-fahh-muted">No changes. Working tree is clean.</p>
        ) : (
          <>
            <MergeGroup changes={conflicts} onResolve={(f, c) => void resolve(f, c)} onShowDiff={(c) => void showDiff(c.path, false)} />
            <ChangeGroup
              title="Staged Changes"
              changes={status.staged}
              busy={busy}
              actionLabel="Unstage all"
              onAction={() => void unstageAll()}
              onToggle={(c) => void unstage(c.path)}
              onShowDiff={(c) => void showDiff(c.path, true)}
            />
            <ChangeGroup
              title="Changes"
              changes={unstaged}
              busy={busy}
              actionLabel="Stage all"
              onAction={() => void stageAll()}
              onToggle={(c) => void stage(c.path)}
              onDiscard={(c) => void confirmDiscard(c)}
              onShowDiff={(c) => void showDiff(c.path, false, c.status === "untracked")}
            />
          </>
        )}

        {stashes.length > 0 && (
          <div className="mt-1" data-testid="git-stashes">
            <GroupHeader title="Stashes" count={stashes.length} />
            {stashes.map((s) => (
              <div key={s.index} className="group flex items-center gap-1.5 px-3 py-[3px] rounded hover:bg-fahh-surface/60">
                <Archive size={11} className="text-fahh-muted shrink-0" />
                <span className="truncate text-xs text-fahh-text flex-1" title={s.message}>
                  {s.message}
                </span>
                <button
                  onClick={() => void popStash(s.index)}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-[10px] text-fahh-muted hover:text-fahh-accent transition-opacity"
                  title="Apply these changes and drop the stash"
                >
                  Pop
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {diff && (
        <DiffView
          file={diff.file}
          text={diff.text}
          onClose={() => setDiff(null)}
          hunkActions={
            diff.staged
              ? [{ label: "Unstage", run: (i) => void hunk(i, false) }]
              : [
                  { label: "Stage", run: (i) => void hunk(i, false) },
                  ...(diff.untracked ? [] : [{ label: "Discard", danger: true, run: (i: number) => void hunk(i, true) }]),
                ]
          }
        />
      )}
    </div>
  );
}
