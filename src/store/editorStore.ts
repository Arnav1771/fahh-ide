import { create } from "zustand";
import type { Document } from "../lib/types";
import { remapPath } from "../lib/tabs";

interface EditorStore {
  openTabs: Document[];
  activeTab: string | null;
  fileContents: Record<string, string>;
  openFile: (doc: Document, content: string) => void;
  closeFile: (path: string) => void;
  setActiveTab: (path: string) => void;
  setContent: (path: string, content: string) => void;
  markDirty: (path: string, dirty: boolean) => void;
  /** A file or folder was renamed on disk: move every open tab under it. */
  renamePath: (from: string, to: string) => void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  openTabs: [],
  activeTab: null,
  fileContents: {},

  openFile: (doc, content) =>
    set((state) => {
      const exists = state.openTabs.find((t) => t.path === doc.path);
      return {
        openTabs: exists ? state.openTabs : [...state.openTabs, doc],
        activeTab: doc.path,
        fileContents: { ...state.fileContents, [doc.path]: content },
      };
    }),

  closeFile: (path) =>
    set((state) => {
      const tabs = state.openTabs.filter((t) => t.path !== path);
      const contents = { ...state.fileContents };
      delete contents[path];
      const active =
        state.activeTab === path
          ? tabs.length > 0
            ? tabs[tabs.length - 1].path
            : null
          : state.activeTab;
      return { openTabs: tabs, activeTab: active, fileContents: contents };
    }),

  setActiveTab: (path) => set({ activeTab: path }),

  setContent: (path, content) =>
    set((state) => ({
      fileContents: { ...state.fileContents, [path]: content },
    })),

  markDirty: (path, dirty) =>
    set((state) => ({
      openTabs: state.openTabs.map((t) =>
        t.path === path ? { ...t, dirty } : t
      ),
    })),

  renamePath: (from, to) =>
    set((state) => {
      const map = (p: string) => remapPath(p, from, to) ?? p;
      const contents: Record<string, string> = {};
      for (const [p, c] of Object.entries(state.fileContents)) contents[map(p)] = c;
      return {
        openTabs: state.openTabs.map((t) => ({ ...t, path: map(t.path) })),
        activeTab: state.activeTab ? map(state.activeTab) : null,
        fileContents: contents,
      };
    }),
}));
