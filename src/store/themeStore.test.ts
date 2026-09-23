import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME, THEME_IDS, isThemeId, readPersistedTheme } from "./themeStore";

function fakeStorage(value: string | null) {
  return { getItem: vi.fn(() => value), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(), length: 0 };
}

describe("theme persistence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts new installs on Fahh Gold", () => {
    vi.stubGlobal("localStorage", fakeStorage(null));
    expect(DEFAULT_THEME).toBe("fahh-gold");
    expect(readPersistedTheme()).toBe("fahh-gold");
  });

  it("keeps a theme someone already chose, including the old default", () => {
    for (const id of ["fahh-dark", "fahh-light", "github-dark", "dracula", "solarized-dark", "fahh-gold"]) {
      vi.stubGlobal("localStorage", fakeStorage(id));
      expect(readPersistedTheme()).toBe(id);
    }
  });

  it("ignores a stored value that is not a theme", () => {
    vi.stubGlobal("localStorage", fakeStorage("hot-pink"));
    expect(readPersistedTheme()).toBe(DEFAULT_THEME);
  });

  it("falls back when storage throws", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); } });
    expect(readPersistedTheme()).toBe(DEFAULT_THEME);
  });

  it("lists every theme exactly once", () => {
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length);
    expect(THEME_IDS.length).toBe(6);
    expect(isThemeId("fahh-gold")).toBe(true);
    expect(isThemeId(42)).toBe(false);
  });
});
