/** The TODO view's data: TODO / FIXME / HACK comments found by the workspace search. */
import type { SearchMatch } from "./types";

export const TODO_TAGS = ["TODO", "FIXME", "HACK"] as const;
export type TodoTag = (typeof TODO_TAGS)[number];

/** Case-sensitive, whole word, so "todos" or "Todoist" are not hits. */
export const TODO_QUERY = "\\b(TODO|FIXME|HACK)\\b";

export interface TodoItem {
  file: string;
  line: number;
  column: number;
  tag: TodoTag;
  /** The note after the tag, without comment punctuation. */
  text: string;
}

export function todoFromMatch(m: SearchMatch): TodoItem | null {
  const tag = /\b(TODO|FIXME|HACK)\b/.exec(m.line_text.slice(m.match_start))?.[1] as TodoTag | undefined;
  if (!tag) return null;
  const after = m.line_text.slice(m.match_start + tag.length);
  const text = after
    .replace(/^\s*(\([^)]*\))?\s*[:\-–]?\s*/, "")
    .replace(/\s*(\*\/|-->|#}|%>)\s*$/, "")
    .trim();
  return { file: m.file, line: m.line_number, column: m.match_start + 1, tag, text };
}

/** Group by file, files in name order, items in line order. */
export function groupTodos(matches: SearchMatch[]): { file: string; items: TodoItem[] }[] {
  const byFile = new Map<string, TodoItem[]>();
  for (const m of matches) {
    const t = todoFromMatch(m);
    if (!t) continue;
    byFile.set(t.file, [...(byFile.get(t.file) ?? []), t]);
  }
  return [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, items]) => ({ file, items: items.sort((a, b) => a.line - b.line || a.column - b.column) }));
}

/** A path relative to the workspace for display. */
export function relativeTo(root: string | null, path: string): string {
  if (!root) return path;
  const r = root.replace(/[\\/]+$/, "");
  return path.startsWith(r) && /[\\/]/.test(path.charAt(r.length)) ? path.slice(r.length + 1) : path;
}
