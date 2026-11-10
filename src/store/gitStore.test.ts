import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitStatus } from "../lib/types";
import { EMPTY_GIT_STATUS } from "../lib/git";

// Mock the IPC wrappers so the store can be driven without a Tauri runtime.
const gitStatus = vi.fn();
const gitStage = vi.fn();
const gitUnstage = vi.fn();
const gitCommit = vi.fn();
const gitRepositories = vi.fn();
const gitPush = vi.fn();
const gitResolveConflict = vi.fn();
const show = vi.fn();

vi.mock("../lib/tauri", () => ({
  gitStatus: (...a: unknown[]) => gitStatus(...a),
  gitStage: (...a: unknown[]) => gitStage(...a),
  gitUnstage: (...a: unknown[]) => gitUnstage(...a),
  gitCommit: (...a: unknown[]) => gitCommit(...a),
  gitRepositories: (...a: unknown[]) => gitRepositories(...a),
  gitPush: (...a: unknown[]) => gitPush(...a),
  gitResolveConflict: (...a: unknown[]) => gitResolveConflict(...a),
  gitStashList: () => Promise.resolve([]),
}));
vi.mock("./toastStore", () => ({ useToastStore: { getState: () => ({ show }) } }));

import { useGitStore } from "./gitStore";

const store = () => useGitStore.getState();

function status(partial: Partial<GitStatus> = {}): GitStatus {
  return {
    is_repo: true,
    repo_root: "/repo",
    branch: "main",
    unborn: false,
    staged: [],
    unstaged: [{ path: "a.ts", status: "modified", staged: false }],
    upstream: null,
    ahead: 0,
    behind: 0,
    ...partial,
  };
}

beforeEach(() => {
  gitStatus.mockReset();
  gitStage.mockReset().mockResolvedValue(undefined);
  gitUnstage.mockReset().mockResolvedValue(undefined);
  gitCommit.mockReset();
  gitRepositories.mockReset().mockResolvedValue([]);
  gitPush.mockReset();
  gitResolveConflict.mockReset().mockResolvedValue(undefined);
  show.mockReset();

  useGitStore.setState({
    root: null,
    repos: [],
    repo: null,
    amend: false,
    syncing: false,
    status: EMPTY_GIT_STATUS,
    loading: false,
    error: null,
    commitMessage: "",
    busy: [],
    committing: false,
    lastCommit: null,
  });
});

describe("gitStore.setRoot", () => {
  it("wipes stale state when the workspace changes", () => {
    useGitStore.setState({
      root: "/old",
      status: status(),
      commitMessage: "wip",
      error: "boom",
      lastCommit: "abc1234",
    });

    store().setRoot("/new");

    expect(store().root).toBe("/new");
    expect(store().status).toEqual(EMPTY_GIT_STATUS);
    expect(store().commitMessage).toBe("");
    expect(store().error).toBeNull();
    expect(store().lastCommit).toBeNull();
  });

  it("ignores a set to the same root so typing a commit message is not lost", () => {
    store().setRoot("/repo");
    store().setCommitMessage("half a message");
    store().setRoot("/repo");

    expect(store().commitMessage).toBe("half a message");
  });
});

describe("gitStore.refresh", () => {
  it("does not call the backend when no folder is open", async () => {
    await store().refresh();
    expect(gitStatus).not.toHaveBeenCalled();
    expect(store().status).toEqual(EMPTY_GIT_STATUS);
  });

  it("stores the status returned by the backend", async () => {
    gitStatus.mockResolvedValue(status());
    store().setRoot("/repo");

    await store().refresh();

    expect(gitStatus).toHaveBeenCalledWith("/repo");
    expect(store().status.branch).toBe("main");
    expect(store().loading).toBe(false);
    expect(store().error).toBeNull();
  });

  it("keeps a non-repo folder as a normal empty state, not an error", async () => {
    gitStatus.mockResolvedValue({ ...EMPTY_GIT_STATUS });
    store().setRoot("/tmp");

    await store().refresh();

    expect(store().status.is_repo).toBe(false);
    expect(store().error).toBeNull();
  });

  it("turns a rejection into a friendly error and clears the status", async () => {
    gitStatus.mockRejectedValue("not a git repository");
    store().setRoot("/tmp");

    await store().refresh();

    expect(store().error).toBe("This folder is not a git repository.");
    expect(store().status).toEqual(EMPTY_GIT_STATUS);
    expect(store().loading).toBe(false);
  });
});

describe("gitStore staging", () => {
  it("stages a file and refreshes afterwards", async () => {
    gitStatus.mockResolvedValue(
      status({ staged: [{ path: "a.ts", status: "modified", staged: true }], unstaged: [] })
    );
    store().setRoot("/repo");

    await store().stage("a.ts");

    expect(gitStage).toHaveBeenCalledWith("/repo", "a.ts");
    expect(gitStatus).toHaveBeenCalled();
    expect(store().status.staged).toHaveLength(1);
  });

  it("clears the busy flag even when staging fails", async () => {
    gitStage.mockRejectedValue("index is locked");
    useGitStore.setState({ root: "/repo" });

    await store().stage("a.ts");

    expect(store().busy).toEqual([]);
    expect(store().error).toBe("index is locked");
  });

  it("unstages through git_unstage", async () => {
    gitStatus.mockResolvedValue(status());
    store().setRoot("/repo");

    await store().unstage("a.ts");

    expect(gitUnstage).toHaveBeenCalledWith("/repo", "a.ts");
  });

  it("stageAll stages every unstaged file", async () => {
    gitStatus.mockResolvedValue(status());
    useGitStore.setState({
      root: "/repo",
      status: status({
        unstaged: [
          { path: "a.ts", status: "modified", staged: false },
          { path: "b.ts", status: "untracked", staged: false },
        ],
      }),
    });

    await store().stageAll();

    expect(gitStage).toHaveBeenCalledTimes(2);
    expect(gitStage).toHaveBeenCalledWith("/repo", "a.ts");
    expect(gitStage).toHaveBeenCalledWith("/repo", "b.ts");
  });

  it("does nothing at all when no folder is open", async () => {
    await store().stage("a.ts");
    expect(gitStage).not.toHaveBeenCalled();
  });
});

describe("gitStore.commit", () => {
  it("refuses an empty message without calling the backend", async () => {
    useGitStore.setState({
      root: "/repo",
      status: status({ staged: [{ path: "a.ts", status: "modified", staged: true }] }),
      commitMessage: "   ",
    });

    await store().commit();

    expect(gitCommit).not.toHaveBeenCalled();
    expect(store().error).toMatch(/commit message/i);
  });

  it("refuses when nothing is staged", async () => {
    useGitStore.setState({
      root: "/repo",
      status: status(),
      commitMessage: "fix: thing",
    });

    await store().commit();

    expect(gitCommit).not.toHaveBeenCalled();
    expect(store().error).toMatch(/nothing staged/i);
  });

  it("commits, clears the message and keeps the short oid", async () => {
    gitCommit.mockResolvedValue("9f1c0dd1234567890abcdef");
    gitStatus.mockResolvedValue(status({ staged: [], unstaged: [] }));

    useGitStore.setState({
      root: "/repo",
      status: status({ staged: [{ path: "a.ts", status: "modified", staged: true }] }),
      commitMessage: "fix: thing",
    });

    await store().commit();

    expect(gitCommit).toHaveBeenCalledWith("/repo", "fix: thing", false);
    expect(store().commitMessage).toBe("");
    expect(store().lastCommit).toBe("9f1c0dd");
    expect(store().committing).toBe(false);
    expect(store().error).toBeNull();
  });

  it("surfaces a missing git identity in plain English and keeps the message", async () => {
    gitCommit.mockRejectedValue(
      "no git identity configured — set user.name and user.email"
    );

    useGitStore.setState({
      root: "/repo",
      status: status({ staged: [{ path: "a.ts", status: "modified", staged: true }] }),
      commitMessage: "fix: thing",
    });

    await store().commit();

    expect(store().error).toContain("git config --global");
    expect(store().commitMessage).toBe("fix: thing");
    expect(store().committing).toBe(false);
  });

  it("amends with nothing staged (reword) and resets the toggle", async () => {
    gitCommit.mockResolvedValue("abcdef0123");
    gitStatus.mockResolvedValue(status({ unstaged: [] }));
    useGitStore.setState({ root: "/repo", status: status({ unstaged: [] }), commitMessage: "better words", amend: true });

    await store().commit();

    expect(gitCommit).toHaveBeenCalledWith("/repo", "better words", true);
    expect(store().amend).toBe(false);
  });
});

describe("gitStore repositories", () => {
  const repos = [
    { root: "/work/api", name: "api", branch: "main", changes: 2 },
    { root: "/work/web", name: "web", branch: "dev", changes: 0 },
  ];

  it("picks the first repository in the folder and reports on it", async () => {
    gitRepositories.mockResolvedValue(repos);
    gitStatus.mockResolvedValue(status({ repo_root: "/work/api" }));
    useGitStore.setState({ root: "/work" });

    await store().loadRepos();

    expect(store().repo).toBe("/work/api");
    expect(gitStatus).toHaveBeenLastCalledWith("/work/api");
  });

  it("switches repository, and every action follows the selection", async () => {
    gitStatus.mockResolvedValue(status({ branch: "dev", unstaged: [] }));
    useGitStore.setState({ root: "/work", repos, repo: "/work/api" });

    await store().selectRepo("/work/web");
    await store().stage("x.ts");

    expect(gitStatus).toHaveBeenCalledWith("/work/web");
    expect(gitStage).toHaveBeenCalledWith("/work/web", "x.ts");
    expect(store().repos[1]).toMatchObject({ branch: "dev", changes: 0 });
  });

  it("drops a status that arrives after the selection moved on", async () => {
    let resolveOld: (s: GitStatus) => void = () => {};
    gitStatus.mockReturnValueOnce(new Promise((r) => (resolveOld = r))).mockResolvedValue(status({ branch: "dev" }));
    useGitStore.setState({ root: "/work", repos, repo: "/work/api" });

    const stale = store().refresh();
    await store().selectRepo("/work/web");
    resolveOld(status({ branch: "OLD" }));
    await stale;

    expect(store().status.branch).toBe("dev");
  });
});

describe("gitStore network and conflicts", () => {
  it("explains a rejected push in plain words, in an error toast", async () => {
    gitPush.mockRejectedValue(" ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs");
    gitStatus.mockResolvedValue(status({ upstream: "origin/main" }));
    useGitStore.setState({ root: "/repo", status: status({ upstream: "origin/main" }) });

    await store().push();

    expect(show).toHaveBeenCalledWith(expect.stringMatching(/Push failed: The remote has commits you don't have yet/), "error");
    expect(store().syncing).toBe(false);
  });

  it("resolves a conflict with the chosen side", async () => {
    gitStatus.mockResolvedValue(status({ unstaged: [] }));
    useGitStore.setState({ root: "/repo" });

    await store().resolve("a.ts", "incoming");

    expect(gitResolveConflict).toHaveBeenCalledWith("/repo", "a.ts", "incoming");
    expect(show).toHaveBeenCalledWith("Resolved a.ts", undefined);
  });
});
