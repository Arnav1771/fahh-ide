import { create } from "zustand";
import type { FileEntry } from "../lib/types";

interface FileStore {
  root: string | null;
  tree: FileEntry | null;
  setRoot: (root: string) => void;
  setTree: (tree: FileEntry) => void;
}

export const useFileStore = create<FileStore>((set) => ({
  root: null,
  tree: null,
  setRoot: (root) => set({ root }),
  setTree: (tree) => set({ tree }),
}));
