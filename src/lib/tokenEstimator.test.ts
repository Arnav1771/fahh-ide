import { describe, expect, it } from "vitest";
import { calculateContextTokens, estimateTokens } from "./tokenEstimator";

describe("tokenEstimator", () => {
  it("returns 0 for empty or null strings", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  it("estimates token counts proportional to text length", () => {
    expect(estimateTokens("Hello world")).toBeGreaterThan(0);
    // 38 characters should be ~10 tokens
    const s38 = "a".repeat(38);
    expect(estimateTokens(s38)).toBe(10);
  });

  it("calculates context breakdown across prompt, active file, selection, and diagnostics", () => {
    const res = calculateContextTokens({
      prompt: "Add tests for this component",
      activeFileContent: "export function Test() { return <div>hello</div>; }",
      selection: "<div>hello</div>",
      diagnosticsCount: 2,
    });

    expect(res.promptTokens).toBeGreaterThan(0);
    expect(res.activeFileTokens).toBeGreaterThan(0);
    expect(res.selectionTokens).toBeGreaterThan(0);
    expect(res.diagnosticsTokens).toBe(30);
    expect(res.totalTokens).toBe(
      res.promptTokens + res.activeFileTokens + res.selectionTokens + res.diagnosticsTokens
    );
  });

  it("formats token totals into readable strings", () => {
    const small = calculateContextTokens({ prompt: "hi" });
    expect(small.formatted).toMatch(/^\d+$/);

    const large = calculateContextTokens({ prompt: "x".repeat(4000) });
    expect(large.formatted).toMatch(/^[0-9.]+k$/);
  });
});
