import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_KEY, parseSettings } from "./settingsStore";

describe("parseSettings", () => {
  it("gives the defaults for nothing, damage or the wrong shape", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("{nope")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("[1,2]")).toEqual(DEFAULT_SETTINGS);
  });
  it("keeps good values, clamps numbers and resets bad ones", () => {
    const s = parseSettings(
      JSON.stringify({ fontSize: 99, tabSize: 0, fahhVolume: -5, terminalFontSize: 13.6, minimap: false, wordWrap: "yes", fontFamily: "  Fira Code  ", extra: 1 })
    );
    expect(s.fontSize).toBe(40);
    expect(s.tabSize).toBe(1);
    expect(s.fahhVolume).toBe(0);
    expect(s.terminalFontSize).toBe(14);
    expect(s.minimap).toBe(false);
    expect(s.wordWrap).toBe(DEFAULT_SETTINGS.wordWrap);
    expect(s.fontFamily).toBe("Fira Code");
    expect(s).not.toHaveProperty("extra");
  });
});

describe("the settings store", () => {
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) });
    vi.resetModules();
  });

  it("saves every change and reads it back on the next start", async () => {
    const { useSettingsStore } = await import("./settingsStore");
    useSettingsStore.getState().set("fontSize", 18);
    useSettingsStore.getState().set("minimap", false);
    useSettingsStore.getState().set("tabSize", 50); // clamped like a loaded value
    expect(JSON.parse(mem.get(SETTINGS_KEY)!)).toMatchObject({ fontSize: 18, minimap: false, tabSize: 8 });
    vi.resetModules();
    const again = (await import("./settingsStore")).useSettingsStore.getState();
    expect(again.fontSize).toBe(18);
    expect(again.minimap).toBe(false);
    expect(again.tabSize).toBe(8);
    again.reset();
    expect(JSON.parse(mem.get(SETTINGS_KEY)!)).toEqual(DEFAULT_SETTINGS);
  });
});
