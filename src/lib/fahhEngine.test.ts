import { describe, expect, it } from "vitest";
import { comboVoice, createFahhEngine, formatStreak } from "./fahhEngine";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("fahhEngine", () => {
  it("fires when the error count goes up, not when it stays or falls", () => {
    const c = clock();
    const e = createFahhEngine({ now: c.now, cooldownMs: 0 });
    expect(e.update(1)).toEqual({ type: "fahh", errors: 1, combo: 1 });
    expect(e.update(1)).toBeNull();
    c.advance(100);
    expect(e.update(3)?.type).toBe("fahh");
    expect(e.update(2)).toBeNull();
  });

  it("awards a clean when the last error is fixed", () => {
    const c = clock();
    const e = createFahhEngine({ now: c.now, cooldownMs: 0 });
    e.update(2);
    expect(e.cleanSince()).toBeNull();
    c.advance(5000);
    expect(e.update(0)).toEqual({ type: "clean", streakStartedAt: c.now() });
    expect(e.cleanSince()).toBe(c.now());
    expect(e.combo()).toBe(0);
    expect(e.update(0)).toBeNull();
  });

  it("respects the cooldown: a burst of new errors is one fahh", () => {
    const c = clock();
    const e = createFahhEngine({ now: c.now, cooldownMs: 3000 });
    expect(e.update(1)?.type).toBe("fahh");
    c.advance(500);
    expect(e.update(2)).toBeNull();
    c.advance(3000);
    expect(e.update(3)?.type).toBe("fahh");
  });

  it("counts a combo inside the window and resets it after", () => {
    const c = clock();
    const e = createFahhEngine({ now: c.now, cooldownMs: 0, comboWindowMs: 10_000 });
    e.update(1);
    c.advance(4000);
    expect(e.update(2)).toMatchObject({ combo: 2 });
    c.advance(4000);
    expect(e.update(3)).toMatchObject({ combo: 3 });
    expect(e.combo()).toBe(3);
    c.advance(11_000);
    expect(e.combo()).toBe(0);
    expect(e.update(4)).toMatchObject({ combo: 1 });
  });

  it("switching files never fires and never awards a fake clean", () => {
    const c = clock();
    const e = createFahhEngine({ now: c.now, cooldownMs: 0 });
    e.rebase(5);
    expect(e.update(5)).toBeNull();
    e.rebase(0);
    expect(e.update(0)).toBeNull();
    expect(e.cleanSince()).not.toBeNull();
  });

  it("a failed build or run fahhs through the same cooldown", () => {
    const c = clock();
    const e = createFahhEngine({ now: c.now, cooldownMs: 3000 });
    expect(e.external()?.type).toBe("fahh");
    expect(e.update(1)).toBeNull();
  });
});

describe("formatStreak and comboVoice", () => {
  it("formats the clean streak", () => {
    expect(formatStreak(4_200)).toBe("4s");
    expect(formatStreak(12 * 60_000)).toBe("12m");
    expect(formatStreak(3 * 3_600_000 + 5 * 60_000)).toBe("3h 05m");
  });

  it("gets heavier with the combo, within limits", () => {
    expect(comboVoice(1)).toEqual({ gain: 1, rate: 1 });
    expect(comboVoice(3).gain).toBeGreaterThan(1);
    expect(comboVoice(3).rate).toBeLessThan(1);
    expect(comboVoice(50)).toEqual(comboVoice(6));
  });
});
