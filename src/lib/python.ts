/**
 * The workspace Python (Run, Debug, notebooks) and the notebook kernel protocol.
 * Resolution itself is the Rust `python_interpreter` command (setting, then .venv / venv,
 * then PATH); the kernel runner is src-tauri/assets/fahh_kernel.py. Everything below
 * `workspacePython` is pure and unit-tested.
 */
import { pythonInterpreter } from "./tauri";
import { parseOutput, type NotebookOutput } from "./notebook";
import { useFileStore } from "../store/fileStore";
import { useSettingsStore } from "../store/settingsStore";

export interface PythonPick {
  program: string;
  /** "setting", ".venv", "venv", or the PATH program name. */
  label: string;
}

/** The Python the open folder should use. Without Tauri (browser preview) it is plain `python`. */
export async function workspacePython(): Promise<PythonPick> {
  try {
    return await pythonInterpreter(useFileStore.getState().root, useSettingsStore.getState().pythonPath);
  } catch {
    return { program: "python", label: "python" };
  }
}

/**
 * The program as typed in a terminal opened at `root`: `.venv\Scripts\python` rather than
 * the absolute path, and quoted when it has spaces.
 */
export function shellProgram(program: string, root: string | null): string {
  let p = program;
  if (root) {
    const r = root.replace(/[\\/]+$/, "");
    if (p.startsWith(r) && /[\\/]/.test(p.charAt(r.length))) p = p.slice(r.length + 1);
  }
  p = p.replace(/\.exe$/i, "");
  // ponytail: plain quotes; PowerShell needs `& "..."` for a quoted path with spaces.
  return /\s/.test(p) ? `"${p}"` : p;
}

/** The one package a notebook kernel needs (it brings jupyter_client), as VS Code asks for. */
export const ipykernelInstallCommand = (program: string, root: string | null) => `${shellProgram(program, root)} -m pip install ipykernel`;

/** The last `n` non-empty lines, for an error summary. */
export const lastLines = (lines: string[], n = 8) => lines.filter((l) => l.trim()).slice(-n);

// ─── Kernel runner protocol (fahh_kernel.py) ─────────────────────────────────

export type KernelEvent =
  | { type: "ready"; version: string }
  | { type: "missing"; module: string }
  | { type: "busy"; cell: number }
  | { type: "output"; cell: number; output: NotebookOutput }
  | { type: "clear"; cell: number }
  | { type: "done"; cell: number; count: number | null; status: "ok" | "error" }
  | { type: "cancelled"; cells: number[] }
  | { type: "restarted" }
  | { type: "fatal"; message: string };

/** One stdout line of the runner; null for anything else (a stray print from the kernel). */
export function parseKernelLine(line: string): KernelEvent | null {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const cell = Number(o.cell);
  switch (o.type) {
    case "ready":
      return { type: "ready", version: String(o.version ?? "") };
    case "missing":
      return { type: "missing", module: String(o.module ?? "ipykernel") };
    case "busy":
    case "clear":
      return { type: o.type, cell };
    case "output": {
      const output = parseOutput(o.output);
      return output ? { type: "output", cell, output } : null;
    }
    case "done":
      return { type: "done", cell, count: typeof o.count === "number" ? o.count : null, status: o.status === "error" ? "error" : "ok" };
    case "cancelled":
      return { type: "cancelled", cells: Array.isArray(o.cells) ? o.cells.map(Number) : [] };
    case "restarted":
      return { type: "restarted" };
    case "fatal":
      return { type: "fatal", message: String(o.message ?? "") };
    default:
      return null;
  }
}

/** A cell's run in this session; it overrides what the file says for that cell. */
export interface CellRun {
  status: "queued" | "busy" | "ok" | "error";
  count: number | null;
  outputs: NotebookOutput[];
}

export type CellRuns = Record<number, CellRun>;

/** Mark cells queued (Run cell / Run all) before their commands go out. */
export const queueCells = (runs: CellRuns, cells: number[]): CellRuns => {
  const next = { ...runs };
  for (const c of cells) next[c] = { status: "queued", count: runs[c]?.count ?? null, outputs: runs[c]?.outputs ?? [] };
  return next;
};

/** Fold one runner event into the cells' state. */
export function applyKernelEvent(runs: CellRuns, ev: KernelEvent): CellRuns {
  switch (ev.type) {
    case "busy":
      return { ...runs, [ev.cell]: { status: "busy", count: null, outputs: [] } };
    case "output": {
      const r = runs[ev.cell] ?? { status: "busy", count: null, outputs: [] };
      return { ...runs, [ev.cell]: { ...r, outputs: [...r.outputs, ev.output] } };
    }
    case "clear": {
      const r = runs[ev.cell];
      return r ? { ...runs, [ev.cell]: { ...r, outputs: [] } } : runs;
    }
    case "done": {
      const r = runs[ev.cell] ?? { status: "busy", count: null, outputs: [] };
      return { ...runs, [ev.cell]: { ...r, status: ev.status, count: ev.count } };
    }
    case "cancelled": {
      // Back to what the file shows.
      const next = { ...runs };
      for (const c of ev.cells) if (next[c]?.status === "queued") delete next[c];
      return next;
    }
    default:
      return runs;
  }
}

/** Every queued or running cell dropped: the kernel stopped or was restarted mid-run. */
export const settleRuns = (runs: CellRuns): CellRuns =>
  Object.fromEntries(Object.entries(runs).filter(([, r]) => r.status !== "queued").map(([k, r]) => [k, r.status === "busy" ? { ...r, status: "error" as const } : r]));

/** True while any cell is queued or running. */
export const kernelBusy = (runs: CellRuns) => Object.values(runs).some((r) => r.status === "queued" || r.status === "busy");

/** localStorage key for the kernel picked for one notebook. */
export const kernelKey = (notebookPath: string) => `fahh-nb-kernel:${notebookPath}`;
