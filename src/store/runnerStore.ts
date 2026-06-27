import { create } from "zustand";

export interface RunOutputLine {
  line: string;
  stream: "stdout" | "stderr" | "info";
  /** Timestamp when the line arrived (ms since epoch) */
  ts: number;
}

interface RunnerStore {
  isRunning: boolean;
  pid: number | null;
  output: RunOutputLine[];
  language: string | null;
  /** Unix ms when the run started — used for duration display */
  startedAt: number | null;
  /** Final exit code, set when the process exits */
  exitCode: number | null;
  /** Duration in ms, set when the process exits */
  durationMs: number | null;

  // ── Actions ──────────────────────────────────────────────────────────────────
  startRun: (pid: number, language: string) => void;
  stopRun: () => void;
  addOutput: (line: string, stream: RunOutputLine["stream"]) => void;
  clearOutput: () => void;
  setLanguage: (language: string) => void;
  /** Called when the child process exits */
  finishRun: (exitCode: number | null, durationMs: number) => void;
}

export const useRunnerStore = create<RunnerStore>((set) => ({
  isRunning: false,
  pid: null,
  output: [],
  language: null,
  startedAt: null,
  exitCode: null,
  durationMs: null,

  startRun: (pid, language) =>
    set({
      isRunning: true,
      pid,
      language,
      startedAt: Date.now(),
      exitCode: null,
      durationMs: null,
      // Keep previous output visible until explicitly cleared
    }),

  stopRun: () =>
    set({
      isRunning: false,
      pid: null,
      startedAt: null,
    }),

  finishRun: (exitCode, durationMs) =>
    set((state) => ({
      isRunning: false,
      pid: null,
      exitCode,
      durationMs,
      output: [
        ...state.output,
        {
          line: `Process exited with code ${exitCode ?? "?"} in ${durationMs}ms`,
          stream: "info" as const,
          ts: Date.now(),
        },
      ],
    })),

  addOutput: (line, stream) =>
    set((state) => ({
      // Cap at 5000 lines to avoid memory bloat
      output: [
        ...state.output.slice(-4999),
        { line, stream, ts: Date.now() },
      ],
    })),

  clearOutput: () =>
    set({ output: [], exitCode: null, durationMs: null }),

  setLanguage: (language) => set({ language }),
}));
