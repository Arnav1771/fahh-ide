/** Pure helpers for keeping open tabs in step with what happens on disk. */
import { parentDir } from "./openRequest";

const SEP = /[\\/]/;

/** Is `path` the same as `root`, or inside it (when `root` is a folder)? */
export function isUnder(path: string, root: string): boolean {
  if (path === root) return true;
  const r = root.replace(/[\\/]+$/, "");
  return path.length > r.length + 1 && path.startsWith(r) && SEP.test(path.charAt(r.length));
}

/** Where `path` lives after `from` was renamed to `to`; null when unaffected. */
export function remapPath(path: string, from: string, to: string): string | null {
  if (!isUnder(path, from)) return null;
  return to + path.slice(from.length);
}

const LANGUAGES: Record<string, string> = {
  rs: "rust", ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", py: "python",
  json: "json", ipynb: "json", toml: "toml", md: "markdown",
  html: "html", htm: "html", css: "css", svg: "xml", csv: "plaintext", tsv: "plaintext",
  yml: "yaml", yaml: "yaml", c: "c", cpp: "cpp", h: "c", hpp: "cpp",
  sh: "shell", bat: "bat", ps1: "powershell", sql: "sql",
};

/** The Monaco language for a file, by extension. */
export function languageFor(path: string): string {
  return LANGUAGES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext";
}

/** Explorer drag and drop: can `from` go into folder `dir`? Not onto itself, not inside itself, not where it already is. */
export function canDrop(from: string, dir: string): boolean {
  return dir !== from && !isUnder(dir, from) && parentDir(from) !== dir;
}
