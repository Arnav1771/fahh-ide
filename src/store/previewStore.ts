import { create } from "zustand";

/**
 * How each file is shown, VS Code style:
 *   off   the text editor only (the default for Markdown, HTML, SVG, CSV)
 *   side  text editor with the preview to its right   (Ctrl+K V)
 *   only  the preview in place of the text editor      (Ctrl+Shift+V)
 * Raster images are always "only": they are not text.
 */
export type PreviewMode = "off" | "side" | "only";

interface PreviewStore {
  modes: Record<string, PreviewMode>;
  /** HTML previews run scripts only when you allow it, per file. */
  scripts: Record<string, boolean>;
  /** The editor's top visible line (1-based), for scroll sync. */
  topLine: number;
  /** The latest local dev-server address printed in the terminal or a run (http://localhost:5173). */
  localUrl: string | null;
  setLocalUrl: (url: string) => void;
  setMode: (path: string, mode: PreviewMode) => void;
  /** Ctrl+K V: open to the side, or close it again. */
  toggleSide: (path: string) => void;
  /** Ctrl+Shift+V: swap the text editor for the preview, and back. */
  toggleInPlace: (path: string) => void;
  allowScripts: (path: string, allowed: boolean) => void;
  setTopLine: (line: number) => void;
}

export const usePreviewStore = create<PreviewStore>((set) => ({
  modes: {},
  scripts: {},
  topLine: 1,
  localUrl: null,
  setLocalUrl: (url) => set((s) => (s.localUrl === url ? s : { localUrl: url })),
  setMode: (path, mode) => set((s) => ({ modes: { ...s.modes, [path]: mode } })),
  toggleSide: (path) =>
    set((s) => ({ modes: { ...s.modes, [path]: s.modes[path] === "side" ? "off" : "side" } })),
  toggleInPlace: (path) =>
    set((s) => ({ modes: { ...s.modes, [path]: s.modes[path] === "only" ? "off" : "only" } })),
  allowScripts: (path, allowed) => set((s) => ({ scripts: { ...s.scripts, [path]: allowed } })),
  setTopLine: (line) => set((s) => (s.topLine === line ? s : { topLine: line })),
}));
