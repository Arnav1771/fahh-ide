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
  upstream: null,
  ahead: 0,
  behind: 0,
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

/** Committing is only meaningful when something is staged (an amend may just reword). */
export function canCommit(status: GitStatus, message: string, amend = false): boolean {
  return status.is_repo && (amend ? !status.unborn : status.staged.length > 0) && message.trim().length > 0;
}

/** Files git stopped on during a merge, pull or stash pop. */
export function conflicted(status: GitStatus): GitFileChange[] {
  return status.unstaged.filter((c) => c.status === "conflicted");
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
  // Network operations shell out to the git CLI with prompts disabled.
  if (
    lower.includes("authentication failed") ||
    lower.includes("could not read username") ||
    lower.includes("terminal prompts disabled") ||
    lower.includes("permission denied (publickey)")
  ) {
    return "Git couldn't sign in to the remote. Run git push once in a terminal to save your credentials (or set up an SSH key), then try again.";
  }
  if (lower.includes("non-fast-forward") || lower.includes("fetch first") || lower.includes("[rejected]")) {
    return "The remote has commits you don't have yet. Pull (or Sync) first, then push.";
  }
  if (lower.includes("could not resolve host") || lower.includes("unable to access")) {
    return "Couldn't reach the remote. Check your connection and the remote URL.";
  }
  if (lower.includes("automatic merge failed") || lower.includes("conflict (content)")) {
    return "Pulling hit merge conflicts. Resolve them under Merge Changes, then commit.";
  }
  if (lower.includes("prevents checkout") || lower.includes("would be overwritten")) {
    return "Your local changes would be overwritten. Commit or stash them, then switch branches.";
  }
  if (lower.includes("not owned by current user") || lower.includes("dubious ownership")) {
    return "Git doesn't trust this folder's owner (common for \\\\wsl.localhost repos). Run: git config --global --add safe.directory '*' or add just this path.";
  }
  if (lower.includes("could not run git")) {
    return "Pull, push and fetch need the git command. Install Git and restart Fahh.";
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

/**
 * Synthesizes a clean Conventional Commits message based on staged or unstaged changes.
 */
export function suggestCommitMessage(status: GitStatus): string {
  const list = status.staged.length > 0 ? status.staged : status.unstaged;
  if (!list || list.length === 0) return "";

  const paths = list.map((c) => c.path.toLowerCase());
  let type = "feat";
  let scope = "";
  let desc = "";

  // Extract scope from directory structure
  const firstParts = list[0].path.split(/[/\\]/);
  if (firstParts.length > 1) {
    const candidate = firstParts[firstParts.length - 2].toLowerCase();
    if (candidate !== "src" && candidate !== "app") {
      scope = candidate;
    }
  }

  if (paths.every((p) => p.includes(".test.") || p.includes(".spec.") || p.includes("tests/"))) {
    type = "test";
    desc = "update unit test suites";
  } else if (paths.every((p) => p.includes("doc") || p.endsWith(".md") || p.endsWith(".html"))) {
    type = "docs";
    desc = "update documentation and guides";
  } else if (paths.some((p) => p.includes("fix") || p.includes("error") || p.includes("bug"))) {
    type = "fix";
    desc = `resolve issue in ${list.map((c) => fileName(c.path)).slice(0, 2).join(", ")}`;
  } else if (paths.every((p) => p.endsWith(".css") || p.includes("theme") || p.includes("style"))) {
    type = "style";
    desc = `update styling and themes in ${scope || "ui"}`;
  } else {
    type = "feat";
    const names = list.map((c) => fileName(c.path).replace(/\.[^/.]+$/, "")).slice(0, 2).join(", ");
    desc = `enhance ${names}${list.length > 2 ? ` and ${list.length - 2} more files` : ""}`;
  }

  const scopeStr = scope ? `(${scope})` : "";
  return `${type}${scopeStr}: ${desc}`;
}
