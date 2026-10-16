const MAX = 100;

/** Add a command; empty input and immediate repeats are skipped. */
export function pushHistory(history: string[], cmd: string): string[] {
  const c = cmd.trim();
  if (!c || history[history.length - 1] === c) return history;
  return [...history, c].slice(-MAX);
}

/**
 * Up/Down through history. `idx` is the position (history.length means "the line being typed").
 * Returns the new position and the text to show, or null to leave the input alone.
 */
export function stepHistory(
  history: string[],
  idx: number,
  dir: "up" | "down",
  draft: string
): { idx: number; value: string } | null {
  if (dir === "up") {
    if (history.length === 0 || idx <= 0) return null;
    return { idx: idx - 1, value: history[idx - 1] };
  }
  if (idx >= history.length) return null;
  const next = idx + 1;
  return { idx: next, value: next === history.length ? draft : history[next] };
}
