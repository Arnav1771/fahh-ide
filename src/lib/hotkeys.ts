/**
 * Global shortcut rules that need to know where focus is. Pure, so they run under vitest.
 */

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
}

interface Targetish {
  closest?: (selector: string) => unknown;
}

/**
 * Ctrl+L already means something where the user is typing code: "select line" in
 * Monaco (the VS Code convention) and "clear screen" in the terminal. The agent
 * toggle leaves it alone there.
 */
export function keepsOwnCtrlL(target: Targetish | null | undefined): boolean {
  return !!target?.closest?.(".monaco-editor, .xterm");
}

/** Ctrl/Cmd+L (not inside the editor or terminal) or Ctrl/Cmd+Shift+A (anywhere) toggles Fahh Local. */
export function isAgentToggle(e: KeyLike, target: Targetish | null | undefined): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  const k = e.key.toLowerCase();
  if (e.shiftKey) return k === "a";
  return k === "l" && !keepsOwnCtrlL(target);
}
