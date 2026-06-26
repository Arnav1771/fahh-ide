import { create } from "zustand";
import type { Document } from "../lib/types";

interface EditorStore {
  openTabs: Document[];
  activeTab: string | null;
  fileContents: Record<string, string>;
  openFile: (doc: Document, content: string) => void;
  closeFile: (path: string) => void;
  setActiveTab: (path: string) => void;
  setContent: (path: string, content: string) => void;
  markDirty: (path: string, dirty: boolean) => void;
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
}));
