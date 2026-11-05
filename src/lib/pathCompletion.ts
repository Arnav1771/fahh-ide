/**
 * Relative path completion inside import strings (and src/href/url()/markdown links),
 * over the workspace tree Fahh already loaded for the explorer. Pure, so it is tested;
 * `editorExtras.ts` turns it into a Monaco provider.
 */
import type { FileEntry } from "./types";

/**
 * The relative path being typed at the cursor, or null when the cursor is not in a
 * path string. `before` is the line's text up to the cursor.
 */
export function pathContext(before: string, language: string): { typed: string } | null {
  const patterns: RegExp[] = [];
  if (language === "typescript" || language === "javascript") {
    patterns.push(/(?:\bfrom\s+|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bimport\s+)(["'`])([^"'`]*)$/);
  } else if (language === "html") {
    patterns.push(/\b(?:src|href)\s*=\s*(["'])([^"']*)$/);
  } else if (language === "css" || language === "scss" || language === "less") {
    patterns.push(/url\(\s*(["']?)([^"')]*)$/, /@import\s+(["'])([^"']*)$/);
  } else if (language === "markdown") {
    patterns.push(/\]\(()([^)\s]*)$/);
  }
  for (const re of patterns) {
    const m = re.exec(before);
    if (!m) continue;
    const typed = m[2];
    // Only relative paths: package names and URLs are someone else's business.
    if (typed.startsWith("./") || typed.startsWith("../") || typed === "." || typed === "..") return { typed };
    return null;
  }
  return null;
}

const SEP = /[\\/]/;

/** Join a folder and a relative path (./ and ../ resolved), in the folder's separator style. */
export function resolveDir(fromDir: string, rel: string): string {
  const sep = fromDir.includes("\\") && !fromDir.includes("/") ? "\\" : "/";
  const unc = fromDir.startsWith("\\\\") || fromDir.startsWith("//");
  const parts = fromDir.split(SEP).filter((p, i) => p !== "" || i === 0);
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > 1) parts.pop();
    } else parts.push(seg);
  }
  const joined = parts.join(sep);
  return unc ? sep + sep + joined.replace(/^[\\/]+/, "") : joined || sep;
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

export function findEntry(tree: FileEntry | null, path: string): FileEntry | null {
  if (!tree) return null;
  const want = norm(path);
  const stack = [tree];
  while (stack.length) {
    const e = stack.pop()!;
    const p = norm(e.path);
    if (p === want) return e;
    if (e.is_dir && e.children && want.startsWith(p + "/")) stack.push(...e.children);
  }
  return null;
}

export interface PathSuggestion {
  label: string;
  insertText: string;
  isDir: boolean;
}

/** What to offer for `typed` (e.g. "../comp") in the file `filePath`. */
export function pathSuggestions(tree: FileEntry | null, filePath: string, typed: string, language: string): PathSuggestion[] {
  const fileDir = filePath.replace(/[\\/][^\\/]*$/, "");
  const slash = typed.lastIndexOf("/");
  const dirPart = slash < 0 ? typed : typed.slice(0, slash + 1);
  const dir = findEntry(tree, resolveDir(fileDir, dirPart));
  if (!dir?.is_dir || !dir.children) return [];
  const self = norm(filePath);
  const stripExt = language === "typescript" || language === "javascript";
  return dir.children
    .filter((c) => norm(c.path) !== self && !c.name.startsWith(".git"))
    .map((c) => {
      const name = !c.is_dir && stripExt ? c.name.replace(/\.(d\.ts|tsx?|jsx?|mjs|cjs)$/, "") : c.name;
      return { label: c.is_dir ? c.name + "/" : c.name, insertText: c.is_dir ? c.name + "/" : name, isDir: c.is_dir };
    });
}
