/**
 * Outline: the declarations in a file, found the same way DeepWiki finds definitions
 * (a line that starts with a declaring keyword), so it works for every language
 * without a language server. Markdown files list their headings.
 */
import { KEYWORDS } from "./deepwiki";

export interface OutlineItem {
  name: string;
  /** The declaring keyword (`class`, `def`, `fn`, …) or `h1`–`h6`. */
  kind: string;
  /** 1-based. */
  line: number;
  depth: number;
}

// ponytail: line-based, so a declaration split across lines or inside a string can be missed
// or misread; switch to LSP documentSymbol when a language server is running.
const DECL = new RegExp(
  `^(\\s*)(?:export\\s+)?(?:default\\s+)?(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?(?:static\\s+)?(?:abstract\\s+)?(?:unsafe\\s+)?(${KEYWORDS})\\s+([A-Za-z_$][\\w$]*)`
);
const VARIABLE = /^(const|let|var|val)$/;

export function outline(text: string, language = ""): OutlineItem[] {
  const lines = text.split(/\r?\n/);
  const items: OutlineItem[] = [];
  if (language === "markdown" || language === "md") {
    let fenced = false;
    lines.forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
      const h = !fenced && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
      if (h) items.push({ name: h[2], kind: "h" + h[1].length, line: i + 1, depth: h[1].length - 1 });
    });
    return items;
  }
  const indents: number[] = [];
  lines.forEach((l, i) => {
    const m = DECL.exec(l);
    if (!m) return;
    const indent = m[1].replace(/\t/g, "    ").length;
    // Local variables inside functions are noise; keep only top-level ones.
    if (VARIABLE.test(m[2]) && indent > 0) return;
    while (indents.length && indents[indents.length - 1] >= indent) indents.pop();
    items.push({ name: m[3], kind: m[2].replace(/\*$/, ""), line: i + 1, depth: indents.length });
    indents.push(indent);
  });
  return items;
}

/** The item the cursor is in: the last one starting at or above `line`. */
export function currentItem(items: OutlineItem[], line: number): OutlineItem | undefined {
  let found: OutlineItem | undefined;
  for (const it of items) if (it.line <= line) found = it;
  return found;
}
