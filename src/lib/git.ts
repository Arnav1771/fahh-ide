/**
 * Pure helpers for the Source Control sidebar.
 *
 * Everything here is deliberately free of React and of `@tauri-apps/api` so it
 * can be unit-tested directly. The sidebar component is a thin renderer over
 * these functions.
 */

import type { GitChangeStatus, GitFileChange, GitStatus } from "./types";

/** The state the sidebar shows before the first `git_status` call resolves. */
export const EMPTY_GIT_STATUS: GitStatus = {
  is_repo: false,
  repo_root: "",
  branch: null,
  unborn: false,
  staged: [],
  unstaged: [],
};

/** Single-letter badge, matching the letters git/VS Code use. */
const STATUS_LETTER: Record<GitChangeStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  typechange: "T",
  untracked: "U",
  conflicted: "!",
};

/** Human-readable label used for tooltips and screen readers. */
const STATUS_LABEL: Record<GitChangeStatus, string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  renamed: "Renamed",
  typechange: "Type changed",
  untracked: "Untracked",
  conflicted: "Conflicted",
};

/** Tailwind text colour per status. */
const STATUS_COLOR: Record<GitChangeStatus, string> = {
  added: "text-fahh-success",
  modified: "text-fahh-accent",
  deleted: "text-fahh-error",
  renamed: "text-fahh-accent",
  typechange: "text-fahh-accent",
  untracked: "text-fahh-success",
  conflicted: "text-fahh-error",
};

export function statusLetter(status: GitChangeStatus): string {
  return STATUS_LETTER[status] ?? "?";
}

export function statusLabel(status: GitChangeStatus): string {
  return STATUS_LABEL[status] ?? status;
}

export function statusColor(status: GitChangeStatus): string {
  return STATUS_COLOR[status] ?? "text-fahh-muted";
}

/** File name without its directory, for the primary label in the list. */
export function fileName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/** Directory portion, shown dimmed after the file name. Empty at repo root. */
export function fileDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

/** Total number of changed files across both groups. */
export function changeCount(status: GitStatus): number {
  return status.staged.length + status.unstaged.length;
}

/** True when the repo exists and has nothing to commit or stage. */
export function isClean(status: GitStatus): boolean {
  return status.is_repo && changeCount(status) === 0;
}

/** Committing is only meaningful when something is actually staged. */
export function canCommit(status: GitStatus, message: string): boolean {
  return status.is_repo && status.staged.length > 0 && message.trim().length > 0;
}

/** What the branch chip shows. Covers unborn HEAD and the no-repo case. */
export function branchLabel(status: GitStatus): string {
  if (!status.is_repo) return "no repository";
  if (!status.branch) return "detached HEAD";
  return status.unborn ? `${status.branch} (no commits yet)` : status.branch;
}

/**
 * Normalise whatever a rejected Tauri invoke threw into a readable string.
 * Tauri rejects with the raw `String` returned by the Rust command, but a
 * transport failure rejects with an `Error`, and a serialisation failure can
 * reject with an arbitrary object.
 */
export function describeGitError(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Unknown git error";
}

/**
 * Turn a raw error into the sentence shown in the sidebar. The common,
 * expected failures get a plain-English explanation instead of libgit2's
 * wording.
 */
export function friendlyGitError(err: unknown): string {
  const raw = describeGitError(err);
  const lower = raw.toLowerCase();

  if (lower.includes("not a git repository") || lower.includes("could not find repository")) {
    return "This folder is not a git repository.";
  }
  if (lower.includes("no git identity")) {
    return "No git identity configured. Run: git config --global user.name \"…\" and user.email \"…\"";
  }
  if (lower.includes("nothing to commit")) {
    return "Nothing to commit — stage a file first.";
  }
  return raw;
}

/** Stable ordering: by directory, then by file name. */
export function sortChanges(changes: GitFileChange[]): GitFileChange[] {
  return [...changes].sort((a, b) => {
    const dirCmp = fileDir(a.path).localeCompare(fileDir(b.path));
    if (dirCmp !== 0) return dirCmp;
    return fileName(a.path).localeCompare(fileName(b.path));
  });
}
