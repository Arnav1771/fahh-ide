import { create } from "zustand";
import type { StackFrame, Variable } from "../lib/types";

export interface ConsoleLine {
  /** DAP output category: stdout, stderr, console, plus "input" for what you typed. */
  category: string;
  text: string;
}

/** Keep the Debug Console bounded: a chatty loop must not eat the webview's memory. */
const MAX_CONSOLE_LINES = 2000;

interface DebugStore {
  sessionId: number | null;
  /** debug_start is running (the adapter is booting). */
  starting: boolean;
  isDebugging: boolean;
  isPaused: boolean;
  /** Why the last start failed, shown in Run and Debug. */
  error: string | null;
  /** Name of the configuration being debugged. */
  configName: string | null;
  threadId: number | null;
  currentFile: string | null;
  currentLine: number | null;
  /** Map of absolute file path → sorted array of breakpoint line numbers */
  breakpoints: Record<string, number[]>;
  stackFrames: StackFrame[];
  selectedFrameId: number | null;
  variables: Variable[];
  console: ConsoleLine[];

  // ── Actions ──────────────────────────────────────────────────────────────────
  patch: (p: Partial<DebugStore>) => void;
  start: (sessionId: number) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  setCurrentPosition: (file: string, line: number) => void;
  setStackFrames: (frames: StackFrame[]) => void;
  setVariables: (vars: Variable[]) => void;
  log: (category: string, text: string) => void;
  clearConsole: () => void;
  addBreakpoint: (file: string, line: number) => void;
  removeBreakpoint: (file: string, line: number) => void;
  toggleBreakpoint: (file: string, line: number) => void;
  clearBreakpoints: (file?: string) => void;
}

const paused = { currentFile: null, currentLine: null, stackFrames: [], selectedFrameId: null, variables: [] };

export const useDebugStore = create<DebugStore>((set, get) => ({
  sessionId: null,
  starting: false,
  isDebugging: false,
  isPaused: false,
  error: null,
  configName: null,
  threadId: null,
  breakpoints: {},
  console: [],
  ...paused,

  patch: (p) => set(p),

  start: (sessionId) => set({ sessionId, starting: false, isDebugging: true, isPaused: false, error: null, threadId: null, ...paused }),

  stop: () => set({ sessionId: null, starting: false, isDebugging: false, isPaused: false, threadId: null, ...paused }),

  pause: () => set({ isPaused: true }),

  resume: () => set({ isPaused: false, ...paused }),

  setCurrentPosition: (file, line) => set({ currentFile: file, currentLine: line, isPaused: true }),

  setStackFrames: (stackFrames) => set({ stackFrames }),

  setVariables: (variables) => set({ variables }),

  log: (category, text) =>
    set((s) => {
      // Adapters send output in chunks; one console line per text line.
      const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").map((t) => ({ category, text: t }));
      const next = s.console.concat(lines);
      return { console: next.length > MAX_CONSOLE_LINES ? next.slice(-MAX_CONSOLE_LINES) : next };
    }),

  clearConsole: () => set({ console: [] }),

  addBreakpoint: (file, line) =>
    set((state) => {
      const existing = state.breakpoints[file] ?? [];
      if (existing.includes(line)) return state;
      return { breakpoints: { ...state.breakpoints, [file]: [...existing, line].sort((a, b) => a - b) } };
    }),

  removeBreakpoint: (file, line) =>
    set((state) => {
      const updated = (state.breakpoints[file] ?? []).filter((l) => l !== line);
      const next = { ...state.breakpoints };
      if (updated.length === 0) delete next[file];
      else next[file] = updated;
      return { breakpoints: next };
    }),

  toggleBreakpoint: (file, line) =>
    (get().breakpoints[file] ?? []).includes(line) ? get().removeBreakpoint(file, line) : get().addBreakpoint(file, line),

  clearBreakpoints: (file) =>
    set((state) => {
      if (file === undefined) return { breakpoints: {} };
      const next = { ...state.breakpoints };
      delete next[file];
      return { breakpoints: next };
    }),
}));
