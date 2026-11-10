import { create } from "zustand";
import type { GitConflictChoice, GitRepoInfo, GitStashInfo, GitStatus } from "../lib/types";
import { EMPTY_GIT_STATUS, changeCount, friendlyGitError } from "../lib/git";
import {
  gitApplyHunk,
  gitCheckout,
  gitCommit,
  gitDeleteBranch,
  gitDiscard,
  gitFetch,
  gitInit,
  gitPull,
  gitPush,
  gitRepositories,
  gitResolveConflict,
  gitStage,
  gitStashList,
  gitStashPop,
  gitStashPush,
  gitStatus as fetchGitStatus,
  gitSync,
  gitUnstage,
} from "../lib/tauri";
import { useToastStore } from "./toastStore";

interface GitStore {
  /** Absolute path of the folder the explorer has open. */
  root: string | null;
  /** Repositories found in `root` (more than one: the Repositories picker shows). */
  repos: GitRepoInfo[];
  /** Root of the repository the view reports on; null = discover from `root`. */
  repo: string | null;
  status: GitStatus;
  stashes: GitStashInfo[];
  /** True only for the initial load of a root — per-file actions use `busy`. */
  loading: boolean;
  /** User-facing error text, already run through `friendlyGitError`. */
  error: string | null;
  commitMessage: string;
  /** The next commit rewrites the last one (`--amend`). */
  amend: boolean;
  /** Repo-relative paths with an in-flight stage/unstage. */
  busy: string[];
  committing: boolean;
  /** A fetch / pull / push / sync is running. */
  syncing: boolean;
  /** Short oid of the last commit made from the sidebar, for the toast. */
  lastCommit: string | null;
  branchPickerOpen: boolean;

  setCommitMessage: (message: string) => void;
  setAmend: (amend: boolean) => void;
  setBranchPickerOpen: (open: boolean) => void;
  setRoot: (root: string | null) => void;
  /** Rescan the folder for repositories; keeps the selection when it still exists. */
  loadRepos: () => Promise<void>;
  selectRepo: (root: string) => Promise<void>;
  refresh: () => Promise<void>;
  init: () => Promise<void>;
  stage: (file: string) => Promise<void>;
  unstage: (file: string) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  discard: (file: string) => Promise<void>;
  applyHunk: (file: string, hunk: number, staged: boolean, discard: boolean) => Promise<void>;
  resolve: (file: string, choice: GitConflictChoice) => Promise<void>;
  commit: () => Promise<void>;
  checkout: (branch: string, create?: boolean) => Promise<void>;
  deleteBranch: (branch: string) => Promise<void>;
  /** Pull then push, like VS Code's Sync Changes. */
  sync: () => Promise<void>;
  fetch: () => Promise<void>;
  pull: () => Promise<void>;
  push: () => Promise<void>;
  stash: (message?: string) => Promise<void>;
  popStash: (index: number) => Promise<void>;
  dismissLastCommit: () => void;
}

const toast = (msg: string, kind?: "error") => useToastStore.getState().show(msg, kind);

export const useGitStore = create<GitStore>((set, get) => {
  /** The path every command runs against. */
  const target = () => get().repo ?? get().root;

  /** Run a local mutation, surface its error in the view, then refresh. */
  const act = async (fn: (path: string) => Promise<unknown>, done?: string) => {
    const path = target();
    if (!path) return;
    let error: string | null = null;
    try {
      await fn(path);
      if (done) toast(done);
    } catch (err) {
      error = friendlyGitError(err);
    }
    // Refresh first: a successful refresh clears `error`, which would hide this one.
    await get().refresh();
    set({ error });
  };

  /** A network operation: one at a time, answered with a toast either way. */
  const network = async (fn: (path: string) => Promise<unknown>, done: string, failed: string) => {
    const path = target();
    if (!path || get().syncing) return;
    set({ syncing: true });
    try {
      await fn(path);
      toast(done);
    } catch (err) {
      toast(`${failed}: ${friendlyGitError(err)}`, "error");
    } finally {
      set({ syncing: false });
      await get().refresh();
    }
  };

  return {
    root: null,
    repos: [],
    repo: null,
    status: EMPTY_GIT_STATUS,
    stashes: [],
    loading: false,
    error: null,
    commitMessage: "",
    amend: false,
    busy: [],
    committing: false,
    syncing: false,
    lastCommit: null,
    branchPickerOpen: false,

    setCommitMessage: (message) => set({ commitMessage: message }),
    setAmend: (amend) => set({ amend }),
    setBranchPickerOpen: (open) => set({ branchPickerOpen: open }),

    setRoot: (root) => {
      if (get().root === root) return;
      // A new folder means everything we were showing is stale.
      set({
        root,
        repos: [],
        repo: null,
        status: EMPTY_GIT_STATUS,
        stashes: [],
        error: null,
        commitMessage: "",
        amend: false,
        busy: [],
        lastCommit: null,
      });
      void get().loadRepos();
    },

    loadRepos: async () => {
      const { root } = get();
      if (!root) return;
      try {
        const repos = await gitRepositories(root);
        if (get().root !== root) return;
        const keep = repos.find((r) => r.root === get().repo);
        set({ repos, repo: (keep ?? repos[0])?.root ?? null });
      } catch {
        set({ repos: [], repo: null });
      }
      await get().refresh();
    },

    selectRepo: async (repo) => {
      if (get().repo === repo) return;
      set({ repo, status: EMPTY_GIT_STATUS, stashes: [], error: null, commitMessage: "", amend: false, busy: [], lastCommit: null });
      await get().refresh();
    },

    refresh: async () => {
      const path = target();
      if (!path) {
        set({ status: EMPTY_GIT_STATUS, error: null, loading: false });
        return;
      }

      set({ loading: true });
      try {
        const status = await fetchGitStatus(path);
        const stashes = status.is_repo ? await gitStashList(path).catch(() => []) : [];
        // A newer repo selection won while we waited: drop this answer.
        if (target() !== path) return;
        set((s) => ({
          status,
          stashes,
          error: null,
          loading: false,
          repos: s.repos.map((r) => (r.root === s.repo ? { ...r, branch: status.branch, changes: changeCount(status) } : r)),
        }));
      } catch (err) {
        if (target() !== path) return;
        set({
          status: EMPTY_GIT_STATUS,
          error: friendlyGitError(err),
          loading: false,
        });
      }
    },

    init: async () => {
      const { root } = get();
      if (!root) return;
      try {
        await gitInit(root);
        toast("Initialised a git repository");
        set({ repo: null, error: null });
      } catch (err) {
        set({ error: friendlyGitError(err) });
      }
      await get().loadRepos();
    },

    stage: async (file) => {
      const path = target();
      if (!path) return;
      set((s) => ({ busy: [...s.busy, file] }));
      try {
        await gitStage(path, file);
        set({ error: null });
        await get().refresh();
      } catch (err) {
        set({ error: friendlyGitError(err) });
      } finally {
        set((s) => ({ busy: s.busy.filter((p) => p !== file) }));
      }
    },

    unstage: async (file) => {
      const path = target();
      if (!path) return;
      set((s) => ({ busy: [...s.busy, file] }));
      try {
        await gitUnstage(path, file);
        set({ error: null });
        await get().refresh();
      } catch (err) {
        set({ error: friendlyGitError(err) });
      } finally {
        set((s) => ({ busy: s.busy.filter((p) => p !== file) }));
      }
    },

    stageAll: () =>
      act(async (path) => {
        for (const c of get().status.unstaged) await gitStage(path, c.path);
      }),

    unstageAll: () =>
      act(async (path) => {
        for (const c of get().status.staged) await gitUnstage(path, c.path);
      }),

    discard: (file) => act((path) => gitDiscard(path, file), `Discarded changes to ${file}`),

    applyHunk: (file, hunk, staged, discard) => act((path) => gitApplyHunk(path, file, hunk, staged, discard)),

    resolve: (file, choice) => act((path) => gitResolveConflict(path, file, choice), `Resolved ${file}`),

    commit: async () => {
      const { commitMessage, status, amend } = get();
      const path = target();
      if (!path) return;
      if (!commitMessage.trim()) {
        set({ error: "Enter a commit message first." });
        return;
      }
      if (status.staged.length === 0 && !amend) {
        set({ error: "Nothing staged — stage a file first." });
        return;
      }

      set({ committing: true });
      try {
        const oid = await gitCommit(path, commitMessage, amend);
        set({
          commitMessage: "",
          amend: false,
          error: null,
          lastCommit: oid.slice(0, 7),
          committing: false,
        });
        await get().refresh();
      } catch (err) {
        set({ error: friendlyGitError(err), committing: false });
      }
    },

    checkout: (branch, create = false) =>
      act((path) => gitCheckout(path, branch, create), create ? `Created and switched to ${branch}` : `Switched to ${branch.replace(/^[^/]+\//, "")}`),

    deleteBranch: (branch) => act((path) => gitDeleteBranch(path, branch), `Deleted branch ${branch}`),

    sync: () => {
      const { status } = get();
      return network(gitSync, status.upstream ? `Synced with ${status.upstream}` : `Published ${status.branch ?? "branch"}`, "Sync failed");
    },
    fetch: () => network(gitFetch, "Fetched from the remote", "Fetch failed"),
    pull: () => network(gitPull, "Pulled", "Pull failed"),
    push: () => {
      const { status } = get();
      return network(gitPush, status.upstream ? `Pushed to ${status.upstream}` : `Published ${status.branch ?? "branch"}`, "Push failed");
    },

    stash: (message) => act((path) => gitStashPush(path, message), "Stashed your changes"),
    popStash: (index) => act((path) => gitStashPop(path, index), "Applied and dropped the stash"),

    dismissLastCommit: () => set({ lastCommit: null }),
  };
});
