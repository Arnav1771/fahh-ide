import { describe, expect, it } from "vitest";
import {
  DEFAULT_COOLDOWN_MS,
  cooldownMsFromSecs,
  createCooldown,
} from "./cooldown";

/** A clock we control, so the 3-second rule is tested without waiting 3s. */
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("createCooldown — the product's core rule", () => {
  it("defaults to the documented 3 seconds", () => {
    expect(DEFAULT_COOLDOWN_MS).toBe(3000);
  });

  it("fires the first time it is ever called", () => {
    const clock = fakeClock();
    const cd = createCooldown(3000, { now: clock.now });
    expect(cd.tryTrigger()).toBe(true);
  });

  it("swallows every trigger inside the window", () => {
    const clock = fakeClock();
    const cd = createCooldown(3000, { now: clock.now });

    expect(cd.tryTrigger()).toBe(true);
    // A cascade of 40 diagnostics from one bad import.
    for (let i = 0; i < 40; i++) {
      expect(cd.tryTrigger()).toBe(false);
    }
  });

  it("still blocks at 2999 ms and fires again at exactly 3000 ms", () => {
    const clock = fakeClock();
    const cd = createCooldown(3000, { now: clock.now });

    expect(cd.tryTrigger()).toBe(true);
    clock.advance(2999);
    expect(cd.tryTrigger()).toBe(false);
    clock.advance(1);
    expect(cd.tryTrigger()).toBe(true);
  });

  it("does not extend the window when a blocked trigger comes in", () => {
    const clock = fakeClock();
    const cd = createCooldown(3000, { now: clock.now });

    expect(cd.tryTrigger()).toBe(true);
    clock.advance(2000);
    expect(cd.tryTrigger()).toBe(false); // blocked, must NOT restart the clock
    clock.advance(1000);
    expect(cd.tryTrigger()).toBe(true); // 3000 ms after the first fire
  });

  it("reports the time left in the window", () => {
    const clock = fakeClock();
    const cd = createCooldown(3000, { now: clock.now });

    expect(cd.remainingMs()).toBe(0); // never triggered
    cd.tryTrigger();
    expect(cd.remainingMs()).toBe(3000);
    clock.advance(1200);
    expect(cd.remainingMs()).toBe(1800);
    clock.advance(5000);
    expect(cd.remainingMs()).toBe(0);
  });

  it("reset() makes the next trigger fire immediately", () => {
    const clock = fakeClock();
    const cd = createCooldown(3000, { now: clock.now });

    cd.tryTrigger();
    expect(cd.tryTrigger()).toBe(false);
    cd.reset();
    expect(cd.tryTrigger()).toBe(true);
  });

  it("a zero cooldown fires every single time", () => {
    const clock = fakeClock();
    const cd = createCooldown(0, { now: clock.now });

    expect(cd.tryTrigger()).toBe(true);
    expect(cd.tryTrigger()).toBe(true);
    expect(cd.tryTrigger()).toBe(true);
  });

  it("treats a negative or non-finite cooldown as zero rather than throwing", () => {
    expect(createCooldown(-500).tryTrigger()).toBe(true);
    expect(createCooldown(Number.NaN).tryTrigger()).toBe(true);
  });

  it("works with a clock that starts at a real epoch value", () => {
    const clock = fakeClock(1_760_000_000_000);
    const cd = createCooldown(3000, { now: clock.now });
    expect(cd.tryTrigger()).toBe(true);
    expect(cd.tryTrigger()).toBe(false);
  });
});

describe("cooldownMsFromSecs", () => {
  it("converts the config value to milliseconds", () => {
    expect(cooldownMsFromSecs(5)).toBe(5000);
    expect(cooldownMsFromSecs(0.5)).toBe(500);
  });

  it("allows an explicit 0 to disable the cooldown", () => {
    expect(cooldownMsFromSecs(0)).toBe(0);
  });

  it("falls back to the default for missing or nonsense values", () => {
    expect(cooldownMsFromSecs(undefined)).toBe(DEFAULT_COOLDOWN_MS);
    expect(cooldownMsFromSecs(null)).toBe(DEFAULT_COOLDOWN_MS);
    expect(cooldownMsFromSecs(-3)).toBe(DEFAULT_COOLDOWN_MS);
    expect(cooldownMsFromSecs(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_COOLDOWN_MS
    );
  });
});
