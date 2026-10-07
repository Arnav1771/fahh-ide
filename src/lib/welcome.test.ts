import { describe, expect, it } from "vitest";
import { markWelcomeSeen, shouldShowWelcome, WELCOME_KEY } from "./welcome";

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
