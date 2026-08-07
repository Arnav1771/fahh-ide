import { create } from "zustand";
import type { GitStatus } from "../lib/types";
import { EMPTY_GIT_STATUS, friendlyGitError } from "../lib/git";
import {
  gitCommit,
  gitStage,
  gitStatus as fetchGitStatus,
  gitUnstage,
} from "../lib/tauri";

interface GitStore {
  /** Absolute path of the folder the sidebar is reporting on. */
  root: string | null;
  status: GitStatus;
  /** True only for the initial load of a root — per-file actions use `busy`. */
  loading: boolean;
  /** User-facing error text, already run through `friendlyGitError`. */
  error: string | null;
  commitMessage: string;
  /** Repo-relative paths with an in-flight stage/unstage. */
  busy: string[];
  committing: boolean;
  /** Short oid of the last commit made from the sidebar, for the toast. */
  lastCommit: string | null;

  setCommitMessage: (message: string) => void;
  setRoot: (root: string | null) => void;
  refresh: () => Promise<void>;
  stage: (file: string) => Promise<void>;
  unstage: (file: string) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  commit: () => Promise<void>;
  dismissLastCommit: () => void;
}

export const useGitStore = create<GitStore>((set, get) => ({
  root: null,
  status: EMPTY_GIT_STATUS,
  loading: false,
  error: null,
  commitMessage: "",
  busy: [],
  committing: false,
  lastCommit: null,

  setCommitMessage: (message) => set({ commitMessage: message }),

  setRoot: (root) => {
    if (get().root === root) return;
    // A new folder means everything we were showing is stale.
    set({
      root,
      status: EMPTY_GIT_STATUS,
      error: null,
      commitMessage: "",
      busy: [],
      lastCommit: null,
    });
  },

  refresh: async () => {
    const { root } = get();
    if (!root) {
      set({ status: EMPTY_GIT_STATUS, error: null, loading: false });
      return;
    }

    set({ loading: true });
    try {
      const status = await fetchGitStatus(root);
      set({ status, error: null, loading: false });
    } catch (err) {
      set({
        status: EMPTY_GIT_STATUS,
        error: friendlyGitError(err),
        loading: false,
      });
    }
  },

  stage: async (file) => {
    const { root } = get();
    if (!root) return;
    set((s) => ({ busy: [...s.busy, file] }));
    try {
      await gitStage(root, file);
      set({ error: null });
      await get().refresh();
    } catch (err) {
      set({ error: friendlyGitError(err) });
    } finally {
      set((s) => ({ busy: s.busy.filter((p) => p !== file) }));
    }
  },

  unstage: async (file) => {
    const { root } = get();
    if (!root) return;
    set((s) => ({ busy: [...s.busy, file] }));
    try {
      await gitUnstage(root, file);
      set({ error: null });
      await get().refresh();
    } catch (err) {
      set({ error: friendlyGitError(err) });
    } finally {
      set((s) => ({ busy: s.busy.filter((p) => p !== file) }));
    }
  },

  stageAll: async () => {
    const { root, status } = get();
    if (!root) return;
    const files = status.unstaged.map((c) => c.path);
    try {
      for (const file of files) {
        await gitStage(root, file);
      }
      set({ error: null });
    } catch (err) {
      set({ error: friendlyGitError(err) });
    }
    await get().refresh();
  },

  unstageAll: async () => {
    const { root, status } = get();
    if (!root) return;
    const files = status.staged.map((c) => c.path);
    try {
      for (const file of files) {
        await gitUnstage(root, file);
      }
      set({ error: null });
    } catch (err) {
      set({ error: friendlyGitError(err) });
    }
    await get().refresh();
  },

  commit: async () => {
    const { root, commitMessage, status } = get();
    if (!root) return;
    if (!commitMessage.trim()) {
      set({ error: "Enter a commit message first." });
      return;
    }
    if (status.staged.length === 0) {
      set({ error: "Nothing staged — stage a file first." });
      return;
    }

    set({ committing: true });
    try {
      const oid = await gitCommit(root, commitMessage);
      set({
        commitMessage: "",
        error: null,
        lastCommit: oid.slice(0, 7),
        committing: false,
      });
      await get().refresh();
    } catch (err) {
      set({ error: friendlyGitError(err), committing: false });
    }
  },

  dismissLastCommit: () => set({ lastCommit: null }),
}));
