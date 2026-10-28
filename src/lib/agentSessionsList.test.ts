import { describe, it, expect } from "vitest";
import { ago } from "./agentSessionsList";

describe("session ages", () => {
  const now = Date.UTC(2026, 9, 27, 12, 0, 0);
  it("reads seconds or milliseconds", () => {
    expect(ago(now / 1000 - 30, now)).toBe("just now");
    expect(ago(now - 5 * 60_000, now)).toBe("5m ago");
  });
  it("rounds to the unit people say", () => {
    expect(ago(now - 3 * 3600_000, now)).toBe("3h ago");
    expect(ago(now - 4 * 86400_000, now)).toBe("4d ago");
    expect(ago(now - 21 * 86400_000, now)).toBe("3 wks ago");
    expect(ago(now - 90 * 86400_000, now)).toBe("3 mo ago");
  });
});
