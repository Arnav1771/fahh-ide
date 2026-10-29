/**
 * File locations in terminal output that become clickable: compiler, linter and test output
 * (`src/app.ts:12:5`, `main.rs:7`, `C:\x\y.py(3,1)`) and Python tracebacks (`File "x.py", line 12`).
 */
export interface FileLink {
  /** 0-based column range in the line, end exclusive. */
  start: number;
  end: number;
  path: string;
  line?: number;
  column?: number;
}

const PY = /File "([^"]+)", line (\d+)/g;
// A path with an extension, then :line(:col) or (line,col). Without a line number it must contain a slash.
const LOC = /((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\w.@+-]+[\\/])*[\w.@+-]+\.[A-Za-z][\w]{0,7})(?::(\d+)(?::(\d+))?|\((\d+)(?:,\s*(\d+))?\))?/g;

export function findFileLinks(text: string): FileLink[] {
  const out: FileLink[] = [];
  const taken = (s: number, e: number) => out.some((l) => s < l.end && e > l.start);
  // URLs belong to the web-link handler
  const urls = [...text.matchAll(/\w+:\/\/\S+/g)].map((u) => [u.index ?? 0, (u.index ?? 0) + u[0].length] as const);
  for (const m of text.matchAll(PY)) {
    const start = (m.index ?? 0) + m[0].indexOf(m[1]);
    out.push({ start, end: start + m[1].length, path: m[1], line: +m[2] });
  }
  for (const m of text.matchAll(LOC)) {
    const [whole, path, l1, c1, l2, c2] = m;
    const line = l1 ?? l2;
    if (!line && !/[\\/]/.test(path)) continue;
    const start = m.index ?? 0;
    if (taken(start, start + whole.length) || urls.some(([s, e]) => start < e && start + whole.length > s)) continue;
    out.push({ start, end: start + whole.length, path, line: line ? +line : undefined, column: (c1 ?? c2) ? +(c1 ?? c2)! : undefined });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Absolute path for a link: as is when absolute, else under the open folder. */
export function resolveLinkPath(path: string, root: string | null): string {
  if (/^([A-Za-z]:[\\/]|[\\/])/.test(path) || !root) return path;
  const sep = root.includes("\\") ? "\\" : "/";
  return root.replace(/[\\/]+$/, "") + sep + path.replace(/^\.[\\/]/, "").replace(/[\\/]/g, sep);
}
