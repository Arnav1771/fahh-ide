import { describe, it, expect } from "vitest";
import { scrollbackWheelLines } from "./termWheel";

describe("scrollbackWheelLines", () => {
  it("leaves a plain wheel to xterm", () => {
    expect(scrollbackWheelLines({ shiftKey: false, deltaX: 0, deltaY: -100 })).toBeNull();
  });
  it("scrolls the scrollback on Shift+wheel, vertical or turned horizontal", () => {
    expect(scrollbackWheelLines({ shiftKey: true, deltaX: 0, deltaY: -100 })).toBe(-3);
    expect(scrollbackWheelLines({ shiftKey: true, deltaX: 120, deltaY: 0 })).toBe(3);
    expect(scrollbackWheelLines({ shiftKey: true, deltaX: 0, deltaY: 0 })).toBeNull();
  });
});
