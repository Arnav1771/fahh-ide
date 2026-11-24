import { describe, expect, it, vi } from "vitest";
import { trackPointerDrag } from "./pointerDrag";

/** Node has EventTarget but no PointerEvent: an Event carrying the fields we read. */
const ev = (type: string, fields: Record<string, unknown> = {}) => Object.assign(new Event(type), fields);
const move = (x: number, buttons = 1) => ev("pointermove", { clientX: x, clientY: 0, buttons });

function start() {
  const doc = new EventTarget();
  const onMove = vi.fn();
  const onEnd = vi.fn();
  trackPointerDrag(doc, 0, 0, { onMove, onEnd });
  return { doc, onMove, onEnd };
}

describe("trackPointerDrag (Explorer drag-to-move)", () => {
  it("a click (down, up, no move) is not a drag, so the click opens the file", () => {
    const { doc, onMove, onEnd } = start();
    doc.dispatchEvent(ev("pointerup"));
    expect(onMove).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith(false, true);
  });

  it("moving with the button held drags and drops", () => {
    const { doc, onMove, onEnd } = start();
    doc.dispatchEvent(move(2)); // under the threshold
    doc.dispatchEvent(move(20));
    doc.dispatchEvent(ev("pointerup"));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith(true, true);
  });

  it("after a pointercancel, hovering does nothing: no drop target follows the mouse, the next click moves nothing", () => {
    const { doc, onMove, onEnd } = start();
    doc.dispatchEvent(move(20));
    doc.dispatchEvent(ev("pointercancel"));
    expect(onEnd).toHaveBeenCalledWith(true, false);
    doc.dispatchEvent(move(60, 0)); // hover
    doc.dispatchEvent(move(90, 0));
    doc.dispatchEvent(ev("pointerup")); // the next click
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("a hover with no button held (pointerup missed) ends it instead of dragging along", () => {
    const { doc, onMove, onEnd } = start();
    doc.dispatchEvent(move(60, 0));
    doc.dispatchEvent(move(90, 0));
    expect(onMove).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith(false, false);
  });

  it("Escape cancels", () => {
    const { doc, onEnd } = start();
    doc.dispatchEvent(move(20));
    doc.dispatchEvent(ev("keydown", { key: "Escape" }));
    expect(onEnd).toHaveBeenCalledWith(true, false);
  });
});
