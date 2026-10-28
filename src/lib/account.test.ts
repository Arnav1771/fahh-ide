import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { applySynced, nextAnnouncement, snapshot } from "./account";
import { DEFAULT_SETTINGS, useSettingsStore } from "../store/settingsStore";
import { useThemeStore } from "../store/themeStore";

describe("settings sync payload", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    useThemeStore.getState().setTheme("fahh-gold");
  });

  it("carries only known settings and the theme", () => {
    useSettingsStore.getState().set("fontSize", 18);
    const s = snapshot();
    expect(s.v).toBe(1);
    expect(s.settings.fontSize).toBe(18);
    expect(s.theme).toBe("fahh-gold");
    expect(Object.keys(s.settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it("applies a download, clamping bad values and ignoring unknown keys and themes", () => {
    applySynced({ v: 1, settings: { fontSize: 999, wordWrap: true, evil: "x" }, theme: "dracula" });
    const st = useSettingsStore.getState();
    expect(st.fontSize).toBe(40); // clamped
    expect(st.wordWrap).toBe(true);
    expect((st as unknown as Record<string, unknown>).evil).toBeUndefined();
    expect(useThemeStore.getState().activeTheme).toBe("dracula");
    applySynced({ theme: "not-a-theme" });
    expect(useThemeStore.getState().activeTheme).toBe("dracula");
  });

  it("survives junk", () => {
    expect(() => applySynced(null)).not.toThrow();
    expect(() => applySynced("nope")).not.toThrow();
  });
});

describe("what's new", () => {
  const a = (id: number) => ({ id, title: `t${id}`, body: "", url: null });
  it("shows only the newest announcement, and only once", () => {
    expect(nextAnnouncement([a(2), a(5), a(3)], 0)?.id).toBe(5);
    expect(nextAnnouncement([a(2), a(5)], 5)).toBeNull();
    expect(nextAnnouncement([], 0)).toBeNull();
  });
});
