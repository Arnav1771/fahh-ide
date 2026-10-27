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

/** Does the event match a shortcut written like "Ctrl+Shift+E" or "F9"? Ctrl also matches Cmd. */
export function matchesKeys(e: KeyLike, keys: string): boolean {
  const parts = keys.split("+").map((p) => p.trim().toLowerCase());
  const key = parts.pop();
  if (!key) return false;
  const want = { ctrl: parts.includes("ctrl"), shift: parts.includes("shift"), alt: parts.includes("alt") };
  return (
    (e.ctrlKey || e.metaKey) === want.ctrl &&
    e.shiftKey === want.shift &&
    !!e.altKey === want.alt &&
    e.key.toLowerCase() === key
  );
}

export type DebugKeyAction = "startOrContinue" | "stop" | "restart" | "pause" | "stepOver" | "stepInto" | "stepOut" | "toggleBreakpoint";

/**
 * VS Code's debug keys. Stepping and stopping only act during a session, so F10/F11
 * keep doing nothing (or whatever the focused widget wants) otherwise.
 */
export function debugKeyAction(e: KeyLike, debugging: boolean): DebugKeyAction | null {
  if (e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  switch (e.key) {
    case "F5":
      if (mod && e.shiftKey) return debugging ? "restart" : null;
      if (mod) return null; // Ctrl+F5: run without debugging
      return e.shiftKey ? (debugging ? "stop" : null) : "startOrContinue";
    case "F6":
      return !mod && !e.shiftKey && debugging ? "pause" : null;
    case "F9":
      return !mod && !e.shiftKey ? "toggleBreakpoint" : null;
    case "F10":
      return !mod && !e.shiftKey && debugging ? "stepOver" : null;
    case "F11":
      if (mod || !debugging) return null;
      return e.shiftKey ? "stepOut" : "stepInto";
    default:
      return null;
  }
}
