/**
 * Which preview a file gets, and the small pure helpers the previews share.
 *
 * Modelled on VS Code's editor resolver: Markdown/HTML/CSV previews are an
 * *option* next to the text editor (Ctrl+K V opens one to the side,
 * Ctrl+Shift+V swaps in place); raster images are binary, so their preview is
 * the only editor (VS Code's media-preview is "builtin" for them too).
 *
 * No React, Monaco or Tauri imports, so everything here is unit-tested in Node.
 */

export type PreviewKind = "markdown" | "html" | "image" | "svg" | "csv" | "browser";

/** A tab whose "path" is a web address opens in the built-in browser. */
export function isUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

/**
 * What someone types in the address bar, as a URL: "5173" or ":5173" is a local
 * port, "localhost:3000" or "127.0.0.1:8000/docs" gets http://, anything with a
 * scheme is kept. Pure.
 */
export function normalizeUrl(input: string): string {
  const s = input.trim();
  if (/^:?\d{2,5}(\/.*)?$/.test(s)) return `http://localhost:${s.replace(/^:/, "")}`;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  return `http://${s}`;
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{2,5})?(?:\/[^\s"'<>)\]]*)?/gi;

/**
 * Local dev-server addresses printed in terminal or run output ("Local:
 * http://localhost:5173/"), colour codes stripped, 0.0.0.0 shown as localhost,
 * in order, without repeats. Pure.
 */
export function findLocalUrls(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.replace(ANSI, "").matchAll(LOCAL_URL)) {
    seen.add(m[0].replace("0.0.0.0", "localhost").replace(/[.,;:]+$/, ""));
  }
  return [...seen];
}

const BY_EXT: Record<string, PreviewKind> = {
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  html: "html",
  htm: "html",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  ico: "image",
  avif: "image",
  svg: "svg",
  csv: "csv",
  tsv: "csv",
};

export function extOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function previewKindFor(path: string): PreviewKind | null {
  if (isUrl(path)) return "browser";
  return BY_EXT[extOf(path)] ?? null;
}

/** Binary files and web pages cannot be opened as text: their preview is the editor. */
export function isPreviewOnly(path: string): boolean {
  const kind = previewKindFor(path);
  return kind === "image" || kind === "browser";
}

export function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : path;
}

/** Resolve `rel` (e.g. "img/logo.png", "../a.png") against a folder. */
export function resolvePath(dir: string, rel: string): string {
  if (/^([a-z]+:|\/|[A-Za-z]:[\\/]|\\\\)/i.test(rel)) return rel; // already absolute or a URL
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  const parts = dir.split(/[\\/]/);
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > 1) parts.pop();
    } else parts.push(seg);
  }
  return parts.join(sep);
}

/**
 * A small RFC 4180 CSV reader: quoted fields, "" escapes, newlines inside
 * quotes, CRLF. Stops after `maxRows` so a huge file cannot freeze the UI.
 */
export function parseCsv(text: string, delimiter = ",", maxRows = 2000): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      if (rows.length >= maxRows) return { rows, truncated: i < text.length - 1 };
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return { rows, truncated: false };
}

/**
 * Scroll sync, as VS Code's markdown preview does it: given the source line
 * each rendered block starts at (`data-line`, ascending) and the editor's top
 * visible line, which block to align with and how far into it.
 */
export function syncTarget(blockLines: readonly number[], line: number): { index: number; fraction: number } | null {
  if (blockLines.length === 0) return null;
  let i = 0;
  while (i + 1 < blockLines.length && blockLines[i + 1] <= line) i++;
  const start = blockLines[i];
  const next = blockLines[i + 1];
  if (line < start) return { index: 0, fraction: 0 };
  if (next === undefined || next === start) return { index: i, fraction: 0 };
  return { index: i, fraction: Math.min(1, Math.max(0, (line - start) / (next - start))) };
}

/** VS Code's image zoom steps, clamped 0.1×–20×. */
export const ZOOM_LEVELS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.5, 2, 3, 5, 7, 10, 15, 20] as const;

export function nextZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_LEVELS.find((z) => z > current + 1e-9) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  return [...ZOOM_LEVELS].reverse().find((z) => z < current - 1e-9) ?? ZOOM_LEVELS[0];
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
