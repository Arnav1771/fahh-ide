import { describe, expect, it } from "vitest";
import {
  EMPTY_GIT_STATUS,
  branchLabel,
  canCommit,
  changeCount,
  describeGitError,
  fileDir,
  fileName,
  friendlyGitError,
  isClean,
  sortChanges,
  statusColor,
  statusLabel,
  statusLetter,
} from "./git";
import type { GitFileChange, GitStatus } from "./types";

function change(
  path: string,
  status: GitFileChange["status"] = "modified",
  staged = false
): GitFileChange {
  return { path, status, staged };
}

function repo(partial: Partial<GitStatus> = {}): GitStatus {
  return {
    is_repo: true,
    repo_root: "/home/dell/proj",
    branch: "main",
    unborn: false,
    staged: [],
    unstaged: [],
    ...partial,
  };
}

describe("EMPTY_GIT_STATUS", () => {
  it("is the not-a-repo state, not an error state", () => {
    expect(EMPTY_GIT_STATUS.is_repo).toBe(false);
    expect(EMPTY_GIT_STATUS.staged).toEqual([]);
    expect(EMPTY_GIT_STATUS.unstaged).toEqual([]);
  });
});

describe("status presentation", () => {
  it("uses git's own letters", () => {
    expect(statusLetter("added")).toBe("A");
    expect(statusLetter("modified")).toBe("M");
    expect(statusLetter("deleted")).toBe("D");
    expect(statusLetter("renamed")).toBe("R");
    expect(statusLetter("untracked")).toBe("U");
    expect(statusLetter("conflicted")).toBe("!");
  });

  it("has a readable label and a colour for every status the backend emits", () => {
    const all: GitFileChange["status"][] = [
      "added",
      "modified",
      "deleted",
      "renamed",
      "typechange",
      "untracked",
      "conflicted",
    ];
    for (const status of all) {
      expect(statusLabel(status).length).toBeGreaterThan(0);
      expect(statusColor(status)).toMatch(/^text-/);
      expect(statusLetter(status)).toHaveLength(1);
    }
  });
});

describe("path splitting", () => {
  it("splits a nested path into name and directory", () => {
    expect(fileName("src/lib/tauri.ts")).toBe("tauri.ts");
    expect(fileDir("src/lib/tauri.ts")).toBe("src/lib");
  });

  it("leaves a repo-root file with no directory", () => {
    expect(fileName("README.md")).toBe("README.md");
    expect(fileDir("README.md")).toBe("");
  });

  it("handles a trailing slash without returning an empty name", () => {
    expect(fileName("assets/")).toBe("assets");
  });
});

describe("counting and cleanliness", () => {
  it("counts both groups", () => {
    const status = repo({
      staged: [change("a.ts", "modified", true)],
      unstaged: [change("b.ts"), change("c.ts", "untracked")],
    });
    expect(changeCount(status)).toBe(3);
  });

  it("is clean only when it is a repo with nothing to do", () => {
    expect(isClean(repo())).toBe(true);
    expect(isClean(repo({ unstaged: [change("a.ts")] }))).toBe(false);
    // Not a repo at all is not "clean" — it is a different screen.
    expect(isClean(EMPTY_GIT_STATUS)).toBe(false);
  });
});

describe("canCommit", () => {
  const staged = repo({ staged: [change("a.ts", "modified", true)] });

  it("needs staged files AND a message", () => {
    expect(canCommit(staged, "fix the thing")).toBe(true);
    expect(canCommit(staged, "")).toBe(false);
    expect(canCommit(staged, "   ")).toBe(false);
    expect(canCommit(repo({ unstaged: [change("a.ts")] }), "msg")).toBe(false);
  });

  it("is false outside a repository", () => {
    expect(canCommit(EMPTY_GIT_STATUS, "msg")).toBe(false);
  });
});

describe("branchLabel", () => {
  it("shows the branch name", () => {
    expect(branchLabel(repo({ branch: "fix/mod-2026-07-24" }))).toBe(
      "fix/mod-2026-07-24"
    );
  });

  it("flags an unborn branch so an empty repo is not confusing", () => {
    expect(branchLabel(repo({ branch: "main", unborn: true }))).toBe(
      "main (no commits yet)"
    );
  });

  it("names a detached HEAD", () => {
    expect(branchLabel(repo({ branch: null }))).toBe("detached HEAD");
  });

  it("says so when there is no repository", () => {
    expect(branchLabel(EMPTY_GIT_STATUS)).toBe("no repository");
  });
});

describe("describeGitError", () => {
  it("passes a plain string through — that is what Tauri rejects with", () => {
    expect(describeGitError("not a git repository")).toBe(
      "not a git repository"
    );
  });

  it("unwraps an Error", () => {
    expect(describeGitError(new Error("index is locked"))).toBe(
      "index is locked"
    );
  });

  it("digs a message out of an arbitrary object", () => {
    expect(describeGitError({ message: "bad object" })).toBe("bad object");
  });

  it("never returns undefined for junk", () => {
    expect(describeGitError(undefined)).toBe("Unknown git error");
    expect(describeGitError(null)).toBe("Unknown git error");
    expect(describeGitError(1234)).toBe("Unknown git error");
  });
});

describe("friendlyGitError", () => {
  it("turns the not-a-repo case into a sentence", () => {
    expect(friendlyGitError("not a git repository")).toBe(
      "This folder is not a git repository."
    );
    expect(friendlyGitError("could not find repository at '/tmp/x'")).toBe(
      "This folder is not a git repository."
    );
  });

  it("tells the user how to fix a missing git identity", () => {
    expect(
      friendlyGitError("no git identity configured — set user.name and user.email")
    ).toContain("git config --global");
  });

  it("explains an empty commit", () => {
    expect(friendlyGitError("nothing to commit")).toBe(
      "Nothing to commit — stage a file first."
    );
  });

  it("passes an unrecognised libgit2 message through untouched", () => {
    expect(friendlyGitError("failed to lock file for writing")).toBe(
      "failed to lock file for writing"
    );
  });
});

describe("sortChanges", () => {
  it("groups by directory, then sorts by file name", () => {
    const sorted = sortChanges([
      change("src/z.ts"),
      change("README.md"),
      change("src/a.ts"),
      change("docs/b.md"),
    ]);

    expect(sorted.map((c) => c.path)).toEqual([
      "README.md",
      "docs/b.md",
      "src/a.ts",
      "src/z.ts",
    ]);
  });

  it("does not mutate its input", () => {
    const input = [change("b.ts"), change("a.ts")];
    const copy = [...input];
    sortChanges(input);
    expect(input).toEqual(copy);
  });
});
