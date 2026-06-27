import { create } from "zustand";
import type { StackFrame, Variable } from "../lib/types";

interface DebugStore {
  sessionId: number | null;
  isDebugging: boolean;
  isPaused: boolean;
  currentFile: string | null;
  currentLine: number | null;
  /** Map of absolute file path → sorted array of breakpoint line numbers */
  breakpoints: Record<string, number[]>;
  stackFrames: StackFrame[];
  variables: Variable[];

  // ── Actions ──────────────────────────────────────────────────────────────────
  start: (sessionId: number) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  setCurrentPosition: (file: string, line: number) => void;
  setStackFrames: (frames: StackFrame[]) => void;
  setVariables: (vars: Variable[]) => void;
  addBreakpoint: (file: string, line: number) => void;
  removeBreakpoint: (file: string, line: number) => void;
  clearBreakpoints: (file?: string) => void;
}

export const useDebugStore = create<DebugStore>((set) => ({
  sessionId: null,
  isDebugging: false,
  isPaused: false,
  currentFile: null,
  currentLine: null,
  breakpoints: {},
  stackFrames: [],
  variables: [],

  start: (sessionId) =>
    set({
      sessionId,
      isDebugging: true,
      isPaused: false,
      currentFile: null,
      currentLine: null,
      stackFrames: [],
      variables: [],
    }),

  stop: () =>
    set({
      sessionId: null,
      isDebugging: false,
      isPaused: false,
      currentFile: null,
      currentLine: null,
      stackFrames: [],
      variables: [],
    }),

  pause: () => set({ isPaused: true }),

  resume: () =>
    set({
      isPaused: false,
      currentFile: null,
      currentLine: null,
      stackFrames: [],
      variables: [],
    }),

  setCurrentPosition: (file, line) =>
    set({ currentFile: file, currentLine: line, isPaused: true }),

  setStackFrames: (stackFrames) => set({ stackFrames }),

  setVariables: (variables) => set({ variables }),

  addBreakpoint: (file, line) =>
    set((state) => {
      const existing = state.breakpoints[file] ?? [];
      if (existing.includes(line)) return state;
      return {
        breakpoints: {
          ...state.breakpoints,
          [file]: [...existing, line].sort((a, b) => a - b),
        },
      };
    }),

  removeBreakpoint: (file, line) =>
    set((state) => {
      const existing = state.breakpoints[file] ?? [];
      const updated = existing.filter((l) => l !== line);
      const next = { ...state.breakpoints };
      if (updated.length === 0) {
        delete next[file];
      } else {
        next[file] = updated;
      }
      return { breakpoints: next };
    }),

  clearBreakpoints: (file) =>
    set((state) => {
      if (file === undefined) return { breakpoints: {} };
      const next = { ...state.breakpoints };
      delete next[file];
      return { breakpoints: next };
    }),
}));
