/**
 * Workspace files saved by VS Code (`.code-workspace`) and by Fahh (`.fahh-workspace`).
 *
 * VS Code writes JSON with comments and trailing commas, and its folder paths are
 * relative to the workspace file (`{ "path": ".." }`) or URIs
 * (`vscode-remote://wsl+ubuntu/home/me/proj`, `file:///c%3A/proj`).
 */
import { parentDir } from "./openRequest";
import { resolvePath } from "./preview";
import { toWslUnc } from "./wslPath";

/** JSON with // and /* *\/ comments and trailing commas (JSONC), as VS Code writes it. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else {
      out += c;
    }
  }
  // Trailing commas before } or ] (outside strings: strings were copied verbatim above,
  // so re-scan with a string-aware pass).
  let clean = "";
  inString = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (inString) {
      clean += c;
      if (c === "\\") clean += out[++i] ?? "";
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    if (c === ",") {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j])) j++;
      if (out[j] === "}" || out[j] === "]") continue;
    }
    clean += c;
  }
  return JSON.parse(clean);
}

const isAbsolute = (p: string) => /^([A-Za-z]:[\\/]|\\\\|\/)/.test(p);

/** A VS Code folder URI as a path this machine can open, or null if unsupported. */
export function uriToPath(uri: string): string | null {
  const wsl = /^vscode-remote:\/\/wsl(?:\+|%2B)([^/]+)(\/.*)?$/i.exec(uri);
  if (wsl) return toWslUnc(decodeURIComponent(wsl[1]), decodeURIComponent(wsl[2] ?? "/"));
  const file = /^file:\/\/(\/?)(.*)$/i.exec(uri);
  if (file) {
    const p = decodeURIComponent(file[2]);
    if (/^[A-Za-z]:/.test(p)) return p.replace(/\//g, "\\");
    return file[1] + p; // file:///home/x -> /home/x
  }
  return null;
}

/** Every folder in a workspace file, as absolute paths (unsupported entries skipped). */
export function workspaceFolders(parsed: unknown, workspaceFile?: string): string[] {
  const ws = (parsed ?? {}) as { root?: unknown; folders?: unknown };
  const base = workspaceFile ? parentDir(workspaceFile) : "";
  const out: string[] = [];
  const add = (p: string | null) => {
    if (p && !out.includes(p)) out.push(p);
  };
  if (typeof ws.root === "string" && ws.root) add(ws.root);
  if (Array.isArray(ws.folders)) {
    for (const f of ws.folders as Array<{ path?: unknown; uri?: unknown }>) {
      if (typeof f?.path === "string" && f.path) {
        add(isAbsolute(f.path) || !base ? f.path : resolvePath(base, f.path));
      } else if (typeof f?.uri === "string") {
        add(uriToPath(f.uri));
      }
    }
  }
  return out;
}
