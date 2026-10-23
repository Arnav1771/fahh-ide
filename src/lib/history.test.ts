import { describe, expect, it } from "vitest";
import { JUMP_LINES, NavHistory, cycleIndex, touchMru } from "./history";

describe("MRU order (Ctrl+Tab)", () => {
  it("moves a file to the front without duplicates, capped", () => {
    let m: string[] = [];
    for (const p of ["a", "b", "c", "a"]) m = touchMru(m, p);
    expect(m).toEqual(["a", "c", "b"]);
    expect(touchMru(["x", "y", "z"], "w", 3)).toEqual(["w", "x", "y"]);
  });
  it("cycles both ways and wraps", () => {
    expect(cycleIndex(0, 3, false)).toBe(1);
    expect(cycleIndex(2, 3, false)).toBe(0);
    expect(cycleIndex(0, 3, true)).toBe(2);
    expect(cycleIndex(0, 0, false)).toBe(-1);
  });
});

describe("back / forward history", () => {
  const at = (path: string, line: number) => ({ path, line, column: 1 });

  it("goes back through file switches and long jumps, then forward again", () => {
    const h = new NavHistory();
    h.record(at("a", 1));
    h.record(at("b", 1));
    h.record(at("b", 3)); // a small move updates the current step
    h.record(at("b", 3 + JUMP_LINES + 50)); // go to definition: a new step
    expect(h.canForward()).toBe(false);
    expect(h.back()).toEqual(at("b", 3));
    expect(h.back()).toEqual(at("a", 1));
    expect(h.back()).toBeNull();
    expect(h.forward()).toEqual(at("b", 3));
    expect(h.forward()).toEqual(at("b", 3 + JUMP_LINES + 50));
    expect(h.forward()).toBeNull();
  });

  it("a new step after going back drops the forward steps", () => {
    const h = new NavHistory();
    h.record(at("a", 1));
    h.record(at("b", 1));
    h.record(at("c", 1));
    h.back();
    h.back();
    h.record(at("d", 1));
    expect(h.canForward()).toBe(false);
    expect(h.back()).toEqual(at("a", 1));
  });

  it("keeps at most `max` steps", () => {
    const h = new NavHistory(3);
    for (const p of ["a", "b", "c", "d"]) h.record(at(p, 1));
    expect(h.back()?.path).toBe("c");
    expect(h.back()?.path).toBe("b");
    expect(h.back()).toBeNull();
  });

  it("forgets a deleted file and stays on a sensible step", () => {
    const h = new NavHistory();
    for (const p of ["a", "gone", "b", "gone", "c"]) h.record(at(p, 1));
    h.back(); // on "gone"
    h.forget("gone");
    expect(h.current()?.path).toBe("b");
    expect(h.back()?.path).toBe("a");
    expect(h.forward()?.path).toBe("b");
    expect(h.forward()?.path).toBe("c");
  });
});
