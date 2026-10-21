import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useIconThemeStore, readPersistedIconTheme, ICON_THEMES } from "./iconThemeStore";

function fakeStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, val: string) => {
      store[key] = val;
    }),
    removeItem: vi.fn(),
    clear: vi.fn(),
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

  it("defaults to material", () => {
    expect(readPersistedIconTheme()).toBe("material");
  });

  it("persists the chosen icon theme", () => {
    useIconThemeStore.getState().setIconTheme("minimal");
    expect(useIconThemeStore.getState().activeIconTheme).toBe("minimal");
    expect(localStorage.getItem("fahh-icon-theme")).toBe("minimal");
    expect(readPersistedIconTheme()).toBe("minimal");
  });

  it("moves retired theme ids back to material", () => {
    vi.stubGlobal("localStorage", fakeStorage({ "fahh-icon-theme": "catppuccin" }));
    expect(readPersistedIconTheme()).toBe("material");
  });

  it("lists exactly the themes it can render", () => {
    expect(ICON_THEMES.map((t) => t.id)).toEqual(["material", "fahh", "minimal"]);
  });
});
