/**
 * Source Control sidebar.
 *
 * Talks to the git2-backed Tauri commands in `src-tauri/src/core/git.rs`
 * through the wrappers in `src/lib/tauri.ts`. All state lives in
 * `useGitStore`; all formatting lives in `src/lib/git.ts`.
 *
 * Three states matter and all three are real screens, not crashes:
 *   - no folder open
 *   - folder open but not a git repository
 *   - a repository (clean, or with staged / unstaged changes)
 */

import { useEffect, useState } from "react";
import {
  Check,
  CircleAlert,
  FileDiff,
  GitBranch,
  GitCommit,
  Minus,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";

import { useFileStore } from "../../store/fileStore";
import { useGitStore } from "../../store/gitStore";
import { gitDiff } from "../../lib/tauri";
import {
  branchLabel,
  canCommit,
  changeCount,
  fileDir,
  fileName,
  friendlyGitError,
  isClean,
  sortChanges,
  statusColor,
  statusLabel,
  statusLetter,
} from "../../lib/git";
import type { GitFileChange } from "../../lib/types";

// ─── One row in the changed-files list ────────────────────────────────────────

function ChangeRow({
  change,
  busy,
  onToggle,
  onShowDiff,
}: {
  change: GitFileChange;
  busy: boolean;
  onToggle: () => void;
  onShowDiff: () => void;
}) {
  const dir = fileDir(change.path);

  return (
    <div
      className="group flex items-center gap-1 px-2 py-[3px] rounded hover:bg-fahh-surface/60"
      title={`${statusLabel(change.status)} — ${change.path}`}
    >
      <button
        onClick={onShowDiff}
        className="flex-1 min-w-0 flex items-baseline gap-1.5 text-left"
      >
        <span className="truncate text-xs text-fahh-text">
          {fileName(change.path)}
        </span>
        {dir && (
          <span className="truncate text-[10px] text-fahh-muted shrink min-w-0">
            {dir}
          </span>
        )}
      </button>

      <button
        onClick={onToggle}
        disabled={busy}
        title={change.staged ? "Unstage" : "Stage"}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-40 text-fahh-muted hover:text-fahh-text transition-opacity shrink-0"
      >
        {change.staged ? <Minus size={13} /> : <Plus size={13} />}
      </button>

      <span
        className={`w-3 text-center text-[11px] font-bold shrink-0 ${statusColor(
          change.status
        )}`}
      >
        {statusLetter(change.status)}
      </span>
    </div>
  );
}

// ─── A staged / unstaged group ────────────────────────────────────────────────

function ChangeGroup({
  title,
  changes,
  busy,
  actionLabel,
  onAction,
  onToggle,
  onShowDiff,
}: {
  title: string;
  changes: GitFileChange[];
  busy: string[];
  actionLabel: string;
  onAction: () => void;
  onToggle: (change: GitFileChange) => void;
  onShowDiff: (change: GitFileChange) => void;
}) {
  if (changes.length === 0) return null;

  return (
    <div className="mb-2">
      <div className="flex items-center gap-1 px-2 py-1">
        <span className="text-[10px] uppercase tracking-widest text-fahh-muted font-semibold">
          {title}
        </span>
        <span className="text-[10px] text-fahh-muted">({changes.length})</span>
        <div className="flex-1" />
        <button
          onClick={onAction}
          className="text-[10px] text-fahh-muted hover:text-fahh-accent transition-colors"
        >
          {actionLabel}
        </button>
      </div>

      {sortChanges(changes).map((change) => (
        <ChangeRow
          key={`${change.staged ? "s" : "u"}:${change.path}`}
          change={change}
          busy={busy.includes(change.path)}
          onToggle={() => onToggle(change)}
          onShowDiff={() => onShowDiff(change)}
        />
      ))}
    </div>
  );
}

// ─── Diff viewer ──────────────────────────────────────────────────────────────

function DiffView({
  file,
  text,
  onClose,
}: {
  file: string;
  text: string;
  onClose: () => void;
}) {
  return (
    <div className="border-t border-fahh-surface flex flex-col max-h-64 shrink-0">
      <div className="flex items-center gap-1 px-2 py-1 bg-fahh-surface/40">
        <FileDiff size={12} className="text-fahh-muted shrink-0" />
        <span className="truncate text-[11px] text-fahh-text">{file}</span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="text-fahh-muted hover:text-fahh-text"
          title="Close diff"
        >
          <X size={12} />
        </button>
      </div>

      <pre className="flex-1 overflow-auto px-2 py-1 text-[10px] leading-relaxed font-mono whitespace-pre">
        {text.split("\n").map((line, i) => (
          <div
            key={i}
            className={
              line.startsWith("+") && !line.startsWith("+++")
                ? "text-fahh-success"
                : line.startsWith("-") && !line.startsWith("---")
                ? "text-fahh-error"
                : line.startsWith("@@")
                ? "text-fahh-accent"
                : "text-fahh-muted"
            }
          >
            {line || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function GitSidebar() {
  const root = useFileStore((s) => s.root);
  const {
    status,
    loading,
    error,
    commitMessage,
    busy,
    committing,
    lastCommit,
    setRoot,
    setCommitMessage,
    refresh,
    stage,
    unstage,
    stageAll,
    unstageAll,
    commit,
    dismissLastCommit,
  } = useGitStore();

  const [diff, setDiff] = useState<{ file: string; text: string } | null>(null);

  // Follow the folder the explorer has open.
  useEffect(() => {
    setRoot(root);
  }, [root, setRoot]);

  useEffect(() => {
    void refresh();
  }, [root, refresh]);

  const showDiff = async (change: GitFileChange) => {
    if (!root) return;
    try {
      const text = await gitDiff(root, change.path, change.staged);
      setDiff({
        file: change.path,
        text: text.trim() ? text : "(no textual changes)",
      });
    } catch (err) {
      setDiff({ file: change.path, text: friendlyGitError(err) });
    }
  };

  // ── Header, shared by every state ──
  const header = (
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-fahh-surface shrink-0">
      <span className="text-[10px] uppercase tracking-widest text-fahh-muted font-semibold">
        Source Control
      </span>
      <div className="flex-1" />
      <button
        onClick={() => void refresh()}
        disabled={loading || !root}
        title="Refresh"
        className="text-fahh-muted hover:text-fahh-text disabled:opacity-40 transition-colors"
      >
        <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
      </button>
    </div>
  );

  // ── State 1: nothing open ──
  if (!root) {
    return (
      <div className="flex flex-col h-full bg-fahh-sidebar">
        {header}
        <div className="p-3 text-xs text-fahh-muted">
          Open a folder to see source control.
        </div>
      </div>
    );
  }

  // ── State 2: hard failure talking to git ──
  if (error && !status.is_repo) {
    return (
      <div className="flex flex-col h-full bg-fahh-sidebar">
        {header}
        <div className="p-3 flex items-start gap-2 text-xs text-fahh-error">
          <CircleAlert size={14} className="shrink-0 mt-[1px]" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  // ── State 3: a folder, but not a repository ──
  if (!loading && !status.is_repo) {
    return (
      <div className="flex flex-col h-full bg-fahh-sidebar">
        {header}
        <div className="p-3 space-y-2">
          <p className="text-xs text-fahh-muted">
            This folder is not a git repository.
          </p>
          <p className="text-[11px] text-fahh-muted opacity-70">
            Run <code className="bg-fahh-surface px-1 rounded">git init</code> in
            the terminal below, then hit refresh.
          </p>
        </div>
      </div>
    );
  }

  // ── State 4: a repository ──
  const total = changeCount(status);

  return (
    <div className="flex flex-col h-full bg-fahh-sidebar overflow-hidden">
      {header}

      {/* Branch chip */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-fahh-surface shrink-0">
        <GitBranch size={12} className="text-fahh-accent shrink-0" />
        <span className="truncate text-[11px] text-fahh-text">
          {branchLabel(status)}
        </span>
        <div className="flex-1" />
        <span className="text-[10px] text-fahh-muted shrink-0">
          {total === 0 ? "clean" : `${total} changed`}
        </span>
      </div>

      {/* Commit box */}
      <div className="px-2 py-2 border-b border-fahh-surface shrink-0">
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder={
            status.staged.length === 0
              ? "Stage a file to commit…"
              : "Commit message"
          }
          rows={2}
          className="w-full resize-none bg-fahh-bg border border-fahh-surface rounded px-2 py-1 text-xs text-fahh-text placeholder:text-fahh-muted focus:outline-none focus:border-fahh-accent"
        />
        <button
          onClick={() => void commit()}
          disabled={!canCommit(status, commitMessage) || committing}
          className="mt-1.5 w-full flex items-center justify-center gap-1.5 py-1 rounded text-xs font-medium bg-fahh-accent/90 text-white hover:bg-fahh-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <GitCommit size={12} />
          {committing ? "Committing…" : "Commit"}
        </button>
      </div>

      {/* Errors from an action (the repo itself is fine) */}
      {error && (
        <div className="px-3 py-1.5 flex items-start gap-1.5 text-[11px] text-fahh-error border-b border-fahh-surface shrink-0">
          <CircleAlert size={12} className="shrink-0 mt-[1px]" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      {/* Commit confirmation */}
      {lastCommit && (
        <button
          onClick={dismissLastCommit}
          className="px-3 py-1.5 flex items-center gap-1.5 text-[11px] text-fahh-success border-b border-fahh-surface shrink-0"
        >
          <Check size={12} />
          Committed {lastCommit}
        </button>
      )}

      {/* Changed files */}
      <div className="flex-1 overflow-y-auto py-1">
        {isClean(status) ? (
          <p className="px-3 py-2 text-xs text-fahh-muted">
            No changes. Working tree is clean.
          </p>
        ) : (
          <>
            <ChangeGroup
              title="Staged Changes"
              changes={status.staged}
              busy={busy}
              actionLabel="Unstage all"
              onAction={() => void unstageAll()}
              onToggle={(c) => void unstage(c.path)}
              onShowDiff={(c) => void showDiff(c)}
            />
            <ChangeGroup
              title="Changes"
              changes={status.unstaged}
              busy={busy}
              actionLabel="Stage all"
              onAction={() => void stageAll()}
              onToggle={(c) => void stage(c.path)}
              onShowDiff={(c) => void showDiff(c)}
            />
          </>
        )}
      </div>

      {diff && (
        <DiffView
          file={diff.file}
          text={diff.text}
          onClose={() => setDiff(null)}
        />
      )}
    </div>
  );
}
