import { describe, expect, it } from "vitest";
import { firstFamily, fontStack, isFontInstalled, presetOf } from "./fonts";
import { DEFAULT_SETTINGS } from "../store/settingsStore";

describe("editor font picker", () => {
  it("maps a picked font back to its entry", () => {
    expect(presetOf(fontStack("Fira Code"))).toBe("Fira Code");
    expect(presetOf(`"Fira Code", monospace`)).toBe("Fira Code");
    expect(presetOf("consolas")).toBe("Consolas");
  });

  it("treats free-form lists as custom, so they are kept as typed", () => {
    expect(presetOf("Fira Code, Consolas, monospace")).toBeNull();
  });

  it("reads the first family of a list", () => {
    expect(firstFamily(`"Source Code Pro", monospace`)).toBe("Source Code Pro");
    expect(firstFamily(DEFAULT_SETTINGS.fontFamily)).toBe("JetBrains Mono");
  });

  it("calls a font installed when it measures differently from a fallback", () => {
    const widths: Record<string, number> = { "16px monospace": 10, "16px serif": 8, "16px sans-serif": 9 };
    const installed = (f: string) => widths[f] ?? (f.includes("Real") ? 11 : widths[`16px ${f.split(", ")[1]}`]);
    expect(isFontInstalled("Real Mono", installed)).toBe(true);
    expect(isFontInstalled("Missing Mono", installed)).toBe(false);
    expect(isFontInstalled("Any", null)).toBeNull();
  });
});
