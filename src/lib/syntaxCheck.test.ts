import { describe, expect, it } from "vitest";
import { toMarkers, wantsSyntaxCheck } from "./syntaxCheck";

describe("wantsSyntaxCheck", () => {
  it("checks Python and Rust while no language server is ready", () => {
    expect(wantsSyntaxCheck("python", undefined)).toBe(true);
    expect(wantsSyntaxCheck("rust", "starting")).toBe(true);
    expect(wantsSyntaxCheck("rust", "failed")).toBe(true);
  });

  it("steps aside once the language server is ready", () => {
    expect(wantsSyntaxCheck("python", "ready")).toBe(false);
    expect(wantsSyntaxCheck("rust", "ready")).toBe(false);
  });

  it("leaves languages Monaco already lints alone", () => {
    expect(wantsSyntaxCheck("typescript", undefined)).toBe(false);
    expect(wantsSyntaxCheck("plaintext", undefined)).toBe(false);
  });
});

describe("toMarkers", () => {
  it("maps backend errors onto Monaco markers at error severity", () => {
    const markers = toMarkers([{ line: 2, column: 5, endLine: 2, endColumn: 9, message: "invalid syntax" }], 8);
    expect(markers).toEqual([
      { severity: 8, startLineNumber: 2, startColumn: 5, endLineNumber: 2, endColumn: 9, message: "invalid syntax", source: "syntax" },
    ]);
  });
});
