/**
 * The command palette's search: fuzzy, forgiving, and stable.
 *
 * A query matches when its characters appear in order in "group label"
 * (so "thdr" finds "Theme: Dracula"). Matches score higher when they start a
 * word, run consecutively, or begin the label; ties keep the original order,
 * so the list never jumps around while you type.
 */

export interface PaletteCommand {
  id: string;
  label: string;
  /** Shown before the label, e.g. "View", "Theme", "Fahh". */
  group: string;
  /** Keycaps, e.g. ["Ctrl", "`"]. */
  keys?: string[];
  /** Extra words that should find this command. */
  keywords?: string;
  run: () => void;
}

/** Score of `query` against `text`, or -1 when it does not match. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().replace(/\s+/g, "");
  const t = text.toLowerCase();
  if (!q) return 0;
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return -1;
    const wordStart = found === 0 || /[\s:/._-]/.test(t[found - 1]);
    run = found === ti ? run + 1 : 0;
    score += 1 + (wordStart ? 6 : 0) + run * 3 - Math.min(found - ti, 8) * 0.25;
    ti = found + 1;
  }
  if (t.startsWith(q)) score += 10;
  return score;
}

/**
 * Keywords are matched as whole words (by prefix), never letter by letter:
 * fuzzy-matching "workspace project" would let almost any query through.
 */
function keywordScore(query: string, keywords: string | undefined): number {
  if (!keywords) return -1;
  const words = keywords.toLowerCase().split(/\s+/).filter(Boolean);
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const all = tokens.every((t) => words.some((w) => w.startsWith(t)));
  return all ? 6 + tokens.join("").length : -1;
}

export function rankCommands<T extends PaletteCommand>(query: string, commands: readonly T[]): T[] {
  if (!query.trim()) return [...commands];
  return commands
    .map((c, i) => {
      const onLabel = fuzzyScore(query, c.label);
      const best = Math.max(
        onLabel < 0 ? -1 : onLabel + 2, // a label match beats the same match on "group: label"
        fuzzyScore(query, `${c.group}: ${c.label}`),
        keywordScore(query, c.keywords)
      );
      return { c, i, score: best };
    })
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.c);
}
