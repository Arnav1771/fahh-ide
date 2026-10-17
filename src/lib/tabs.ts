/** Pure helpers for keeping open tabs in step with what happens on disk. */

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
