import { describe, expect, it } from "vitest";
import { DARK_ANSI, LIGHT_ANSI, contrast, xtermTheme } from "./termTheme";
import { THEME_DEFINITIONS } from "../components/ThemePanel";

describe("xtermTheme", () => {
  it("every shipped theme gets readable ANSI colours (4.5:1; black exempt on dark pages)", () => {
    for (const t of THEME_DEFINITIONS) {
      const th = xtermTheme(t.cssVars["--fahh-bg"], t.cssVars["--fahh-text"], t.cssVars["--fahh-accent"]);
      const palette = th.background === t.cssVars["--fahh-bg"] && (th as Record<string, string>).white === LIGHT_ANSI.white ? LIGHT_ANSI : DARK_ANSI;
      for (const [name, c] of Object.entries(palette)) {
        if (palette === DARK_ANSI && name === "black") continue;
        expect(contrast(c, th.background), `${t.id} ${name}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(th.foreground, th.background), `${t.id} text`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("picks the light palette for Fahh Light and the dark one for Fahh Gold", () => {
    expect(xtermTheme("#f8fafc", "#0f172a", "#7c3aed").white).toBe(LIGHT_ANSI.white);
    expect(xtermTheme("#0a0907", "#f0ebe0", "#d4a03c").white).toBe(DARK_ANSI.white);
    expect(xtermTheme("#f8fafc", "#0f172a", "#7c3aed").selectionBackground).toBe("#7c3aed38");
  });
});
