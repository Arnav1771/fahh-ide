import { create } from "zustand";

/**
 * Agent mode: the window is one conversation with Fahh Local plus its sessions, like a chat
 * app. Editor mode: the usual workbench. The dock stays mounted (hidden) in agent mode, so
 * switching back loses nothing. Anything that needs the editor (a view, opening a file)
 * switches back on its own.
 */
export type LayoutMode = "editor" | "agent";

const KEY = "fahh-layout-mode";

function load(): LayoutMode {
  try {
    return localStorage.getItem(KEY) === "agent" ? "agent" : "editor";
  } catch {
    return "editor";
  }
}

interface LayoutModeStore {
  mode: LayoutMode;
  setMode: (mode: LayoutMode) => void;
}

export const useLayoutModeStore = create<LayoutModeStore>((set, get) => ({
  mode: load(),
  setMode: (mode) => {
    if (get().mode === mode) return;
    set({ mode });
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      // storage blocked: the mode still applies for this session
    }
    // The dock was display:none; let it measure itself again.
    if (mode === "editor" && typeof window !== "undefined") window.setTimeout(() => window.dispatchEvent(new Event("fahh-layout")), 0);
  },
}));

/** Called by anything that needs the editor on screen. */
export function ensureEditorMode(): void {
  useLayoutModeStore.getState().setMode("editor");
}
