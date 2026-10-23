/**
 * Pure helpers for moving around open files: the most-recently-used order (Ctrl+Tab),
 * the recently closed stack (Ctrl+Shift+T) and back / forward history (Alt+Left / Alt+Right).
 * No stores and no DOM, so they are tested on their own.
 */

/** `path` moved to the front of the MRU list. */
export function touchMru(list: string[], path: string, max = 50): string[] {
  return [path, ...list.filter((p) => p !== path)].slice(0, max);
}

/** The next index when cycling `n` items from `i` (wraps both ways). */
export function cycleIndex(i: number, n: number, back: boolean): number {
  if (n <= 0) return -1;
  return ((back ? i - 1 : i + 1) % n + n) % n;
}

export interface Loc {
  path: string;
  line: number;
  column: number;
}

/** Cursor moves shorter than this (in lines) inside one file update the current entry instead of adding one. */
export const JUMP_LINES = 10;

/**
 * Back / forward history. Typing and small cursor moves keep updating the current entry,
 * so Back returns to where you last were in that file; a file switch or a long jump
 * (go to definition, a Problems or search click) starts a new entry.
 */
export class NavHistory {
  private entries: Loc[] = [];
  private index = -1;
  constructor(private readonly max = 100) {}

  record(loc: Loc): void {
    const cur = this.entries[this.index];
    if (cur && cur.path === loc.path && Math.abs(cur.line - loc.line) < JUMP_LINES) {
      this.entries[this.index] = loc;
      return;
    }
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(loc);
    if (this.entries.length > this.max) this.entries.shift();
    this.index = this.entries.length - 1;
  }

  /** Drop every entry for a file that no longer exists (deleted), keeping the position sensible. */
  forget(path: string): void {
    const before = this.entries.slice(0, this.index + 1).filter((e) => e.path === path).length;
    this.entries = this.entries.filter((e) => e.path !== path);
    this.index = Math.min(this.index - before, this.entries.length - 1);
    if (this.index < 0 && this.entries.length) this.index = 0;
  }

  canBack(): boolean {
    return this.index > 0;
  }
  canForward(): boolean {
    return this.index < this.entries.length - 1;
  }
  back(): Loc | null {
    if (!this.canBack()) return null;
    return this.entries[--this.index];
  }
  forward(): Loc | null {
    if (!this.canForward()) return null;
    return this.entries[++this.index];
  }
  current(): Loc | null {
    return this.entries[this.index] ?? null;
  }
}
