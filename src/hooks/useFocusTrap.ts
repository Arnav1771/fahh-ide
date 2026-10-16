import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Index to focus next when Tab (or Shift+Tab) is pressed on item `i` of `n`; wraps at both ends. */
export function nextTabIndex(i: number, n: number, shift: boolean): number {
  if (n <= 0) return -1;
  return shift ? (i <= 0 ? n - 1 : i - 1) : i >= n - 1 ? 0 : i + 1;
}

/**
 * While a modal is open: focus moves into it, Tab cycles inside it, Esc calls
 * `onEscape`, and on close focus goes back to whatever had it before.
 */
export function useFocusTrap(ref: RefObject<HTMLElement>, onEscape?: () => void): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const before = document.activeElement as HTMLElement | null;
    const items = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!root.contains(document.activeElement)) (items()[0] ?? root).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onEscape) {
        e.preventDefault();
        e.stopPropagation();
        onEscape();
      } else if (e.key === "Tab") {
        const list = items();
        if (list.length === 0) return e.preventDefault();
        const i = list.indexOf(document.activeElement as HTMLElement);
        // Only wrap at the ends; the browser handles Tab in the middle.
        if (i === -1 || (e.shiftKey ? i === 0 : i === list.length - 1)) {
          e.preventDefault();
          list[nextTabIndex(i, list.length, e.shiftKey)].focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (before && document.contains(before)) before.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
