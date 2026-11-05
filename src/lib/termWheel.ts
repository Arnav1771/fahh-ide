/**
 * Shift+wheel always scrolls a terminal's scrollback, even while the program in it (vim, htop,
 * a TUI) has turned on mouse reporting and would otherwise get the wheel. Lines to scroll, or
 * null to leave the wheel to xterm. Chromium on Windows turns Shift+wheel into a horizontal
 * scroll, so the delta can arrive as deltaX.
 */
export function scrollbackWheelLines(ev: { shiftKey: boolean; deltaX: number; deltaY: number }): number | null {
  if (!ev.shiftKey) return null;
  const d = ev.deltaY || ev.deltaX;
  return d ? Math.sign(d) * 3 : null;
}
