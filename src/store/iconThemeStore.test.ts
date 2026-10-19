import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useIconThemeStore, readPersistedIconTheme, ICON_THEMES } from "./iconThemeStore";

function fakeStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, val: string) => {
      store[key] = val;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      for (const k in store) delete store[k];
    }),
    key: vi.fn(),
    length: 0,
  };
}

describe("iconThemeStore", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
    useIconThemeStore.setState({ activeIconTheme: "material" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads default icon theme as material", () => {
    expect(readPersistedIconTheme()).toBe("material");
  });

  it("persists and reads changed icon theme", () => {
    const store = useIconThemeStore.getState();
    store.setIconTheme("catppuccin");
    expect(useIconThemeStore.getState().activeIconTheme).toBe("catppuccin");
    expect(localStorage.getItem("fahh-icon-theme")).toBe("catppuccin");
  });

  it("auto-registers and activates theme from extension id/name", () => {
    const store = useIconThemeStore.getState();

    const result1 = store.registerFromExtension("PKief.material-icon-theme", "Material Icon Theme");
    expect(result1).toBe("material");
    expect(useIconThemeStore.getState().activeIconTheme).toBe("material");

    const result2 = store.registerFromExtension("seti-icons.theme", "Seti UI Icons");
    expect(result2).toBe("seti");
    expect(useIconThemeStore.getState().activeIconTheme).toBe("seti");

    const result3 = store.registerFromExtension("catppuccin.catppuccin-vsc-icons", "Catppuccin Icons");
    expect(result3).toBe("catppuccin");
    expect(useIconThemeStore.getState().activeIconTheme).toBe("catppuccin");
  });

  it("returns null for non-icon extensions", () => {
    const store = useIconThemeStore.getState();
    const result = store.registerFromExtension("ms-python.python", "Python");
    expect(result).toBeNull();
  });

  it("exposes all 4 standard icon themes with definitions", () => {
    expect(ICON_THEMES.length).toBe(4);
    const ids = ICON_THEMES.map((t) => t.id);
    expect(ids).toContain("material");
    expect(ids).toContain("seti");
    expect(ids).toContain("catppuccin");
    expect(ids).toContain("minimal");
  });
});
