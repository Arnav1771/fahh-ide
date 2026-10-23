import { describe, expect, it } from "vitest";
import { markWelcomeSeen, shouldShowWelcome, syntaxError, WELCOME_KEY, WELCOME_STEPS } from "./welcome";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe("welcome", () => {
  it("shows on first launch, then never again", () => {
    const s = memory();
    expect(shouldShowWelcome(s)).toBe(true);
    markWelcomeSeen(s);
    expect(s.m.get(WELCOME_KEY)).toBe("1");
    expect(shouldShowWelcome(s)).toBe(false);
  });

  it("stays out of the way when storage throws", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(shouldShowWelcome(broken)).toBe(false);
    expect(() => markWelcomeSeen(broken)).not.toThrow();
  });
});

describe("welcome tour", () => {
  it("has at most five steps, each with a label and a title", () => {
    expect(WELCOME_STEPS.length).toBeLessThanOrEqual(5);
    expect(new Set(WELCOME_STEPS.map((s) => s.id)).size).toBe(WELCOME_STEPS.length);
    for (const s of WELCOME_STEPS) expect(s.label && s.title).toBeTruthy();
  });

  it("skip (or finish) persists, and reopening does not reset the flag", () => {
    const s = memory();
    expect(shouldShowWelcome(s)).toBe(true); // a fresh profile sees it
    markWelcomeSeen(s); // Skip tour
    expect(shouldShowWelcome(s)).toBe(false); // the next launch does not
    // Help > Welcome opens it without touching storage; closing marks it seen again (idempotent)
    markWelcomeSeen(s);
    expect(s.m.get(WELCOME_KEY)).toBe("1");
  });

  it("the try-it line uses a real parser", () => {
    expect(syntaxError('const greeting = "hello";')).toBeNull();
    expect(syntaxError('const greeting = "hello;')).toMatch(/./);
    expect(syntaxError("const = 1")).toMatch(/./);
    expect(syntaxError("while (true) {}")).toBeNull(); // parsed, never run
  });
});
