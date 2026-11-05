import { describe, expect, it } from "vitest";
import { unscaleClientPoint } from "./scaledPointer";

// xterm.js 5.5's getCoords (browser/input/Mouse.ts): offset from the element's rect, minus
// padding, divided by the unscaled CSS cell size, 1-based.
const CELL_W = 7.2;
const CELL_H = 17;
function xtermCell(p: { clientX: number; clientY: number }, rect: { left: number; top: number }, pad = { left: 0, top: 0 }) {
  return {
    col: Math.ceil((p.clientX - rect.left - pad.left) / CELL_W),
    row: Math.ceil((p.clientY - rect.top - pad.top) / CELL_H),
  };
}

/** An 800x400 terminal at canvas position (120, 90), canvas panned by (-37, 55), at `zoom`. */
function scene(zoom: number) {
  const left = -37 + 120 * zoom;
  const top = 55 + 90 * zoom;
  const rect = { left, top, width: 800 * zoom, height: 400 * zoom };
  // the screen point at the middle of (col, row), 1-based, as the user sees it
  const at = (col: number, row: number) => ({
    clientX: left + (col - 0.5) * CELL_W * zoom,
    clientY: top + (row - 0.5) * CELL_H * zoom,
  });
  return { rect, at };
}

describe("unscaleClientPoint", () => {
  for (const zoom of [0.5, 0.8, 1, 1.5]) {
    it(`maps a point to the cell under it at zoom ${zoom * 100}%`, () => {
      const { rect, at } = scene(zoom);
      for (const [col, row] of [[1, 1], [12, 10], [80, 23], [111, 1]]) {
        const p = unscaleClientPoint(at(col, row), rect, 800, 400);
        expect(xtermCell(p, rect)).toEqual({ col, row });
      }
    });
  }

  it("reproduces the bug without it: zoom 80% puts row 10 on row 8", () => {
    const { rect, at } = scene(0.8);
    expect(xtermCell(at(12, 10), rect).row).toBe(8);
  });

  it("keeps padding right (xterm subtracts it in unscaled px)", () => {
    const zoom = 0.5;
    const { rect } = scene(zoom);
    const pad = { left: 8, top: 4 };
    const p = { clientX: rect.left + (pad.left + 4.5 * CELL_W) * zoom, clientY: rect.top + (pad.top + 2.5 * CELL_H) * zoom };
    expect(xtermCell(unscaleClientPoint(p, rect, 800, 400), rect, pad)).toEqual({ col: 5, row: 3 });
  });

  it("is the identity at scale 1 and for an unmeasured element", () => {
    const rect = { left: 10, top: 20, width: 300, height: 200 };
    expect(unscaleClientPoint({ clientX: 55, clientY: 66 }, rect, 300, 200)).toEqual({ clientX: 55, clientY: 66 });
    expect(unscaleClientPoint({ clientX: 55, clientY: 66 }, rect, 0, 0)).toEqual({ clientX: 55, clientY: 66 });
  });
});
