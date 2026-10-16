/**
 * `fahh <folder>` / `fahh <file>[:line]` from a shell. The Rust side resolves the path
 * (relative to the caller's directory) and sends an OpenRequest; this decides what the UI does.
 */
import type { OpenRequest } from "./types";

export interface OpenDeps {
  openFolder: (path: string) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  hasFolder: () => boolean;
  /** False while no editor is mounted yet. */
  goToLine: (line: number) => boolean;
  notify: (text: string, kind?: "ok" | "error") => void;
  /** Is this file the one the editor is showing yet? */
  isActive: (path: string) => boolean;
  delay?: (ms: number) => Promise<void>;
}

/** The folder a file lives in. */
export const parentDir = (path: string): string => {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (i <= 0) return path.slice(0, i + 1) || path;
  const dir = path.slice(0, i);
  return /^[A-Za-z]:$/.test(dir) ? dir + path[i] : dir; // keep "C:\" a root
};

export async function handleOpenRequest(req: OpenRequest, d: OpenDeps): Promise<void> {
  const name = req.path.split(/[\\/]/).filter(Boolean).pop() ?? req.path;
  try {
    if (req.kind === "missing") return d.notify(`fahh: ${req.path} does not exist`, "error");
    if (req.kind === "dir") return await d.openFolder(req.path);
    // A file: make its folder the workspace if none is open, so the explorer is not empty.
    if (!d.hasFolder()) await d.openFolder(parentDir(req.path));
    await d.openFile(req.path);
    if (req.line) {
      const wait = d.delay ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
      // The editor mounts and swaps models a moment after the tab opens; jump once it is there,
      // then once more after it has settled on the file.
      for (let i = 0; i < 30 && !(d.isActive(req.path) && d.goToLine(req.line)); i++) await wait(100);
      await wait(250);
      d.goToLine(req.line);
    }
  } catch (err) {
    d.notify(`Could not open ${name}: ${String(err)}`, "error");
  }
}
