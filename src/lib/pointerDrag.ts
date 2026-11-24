/**
 * A pointer drag that starts on pointerdown and follows the mouse while the button is held.
 *
 * It must end on every way a press can end, not only pointerup: a pointercancel (the webview
 * started its own native drag, e.g. of selected text), Escape, or a move with no button held
 * (the release happened outside the window, so pointerup never came). Before, a missed
 * pointerup left the listeners on the document, and plain hovering then "dragged": the row
 * under the mouse lit up as the drop target and the next click moved the file there.
 */
export interface PointerDragHandlers {
  /** Every move past the threshold while the button is held. */
  onMove(ev: PointerEvent): void;
  /** Once: whether a drag happened, and whether it should be dropped (false = cancelled). */
  onEnd(dragged: boolean, drop: boolean): void;
}

export function trackPointerDrag(doc: EventTarget, x0: number, y0: number, h: PointerDragHandlers, threshold = 5): void {
  let dragging = false;
  const move = (ev: Event) => {
    const e = ev as PointerEvent;
    if (e.buttons === 0) return end(false); // released where we could not see it: drop nothing
    if (!dragging && Math.hypot(e.clientX - x0, e.clientY - y0) < threshold) return;
    dragging = true;
    h.onMove(e);
  };
  const up = () => end(true);
  const cancel = () => end(false);
  const esc = (ev: Event) => {
    if ((ev as KeyboardEvent).key === "Escape") end(false);
  };
  const end = (drop: boolean) => {
    doc.removeEventListener("pointermove", move);
    doc.removeEventListener("pointerup", up);
    doc.removeEventListener("pointercancel", cancel);
    doc.removeEventListener("keydown", esc, true);
    h.onEnd(dragging, drop);
  };
  doc.addEventListener("pointermove", move);
  doc.addEventListener("pointerup", up);
  doc.addEventListener("pointercancel", cancel);
  doc.addEventListener("keydown", esc, true);
}
