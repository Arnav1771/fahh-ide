/**
 * The workspace Python (Run, Debug, notebooks) and the notebook "Run all" helpers.
 * The helpers are pure and unit-tested; resolution itself is the Rust
 * `python_interpreter` command (setting, then .venv / venv, then PATH).
 */
import { pythonInterpreter } from "./tauri";
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

/** What Run all needs in the interpreter; `jupyter` comes with nbconvert. */
export const JUPYTER_PACKAGES = ["nbconvert", "ipykernel"];

export const pipInstallCommand = (program: string, root: string | null, packages = JUPYTER_PACKAGES) =>
  `${shellProgram(program, root)} -m pip install ${packages.join(" ")}`;

/** True when nbconvert failed because jupyter, nbconvert or ipykernel is not installed in that interpreter. */
export function jupyterMissing(stderr: string): boolean {
  return (
    /No module named '?(jupyter|jupyter_core|nbconvert|nbclient|nbformat|ipykernel)\b/.test(stderr) ||
    /Jupyter command `?jupyter-nbconvert`? not found/i.test(stderr) ||
    /No such kernel named/i.test(stderr)
  );
}

/** The last `n` non-empty lines, for an error summary. */
export const lastLines = (lines: string[], n = 8) => lines.filter((l) => l.trim()).slice(-n);
