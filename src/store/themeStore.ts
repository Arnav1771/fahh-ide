import { create } from "zustand";
import type { ThemeId } from "../lib/types";

const STORAGE_KEY = "fahh-theme";

/** Every theme the app ships. A stored value outside this list is ignored. */
export const THEME_IDS: readonly ThemeId[] = [
  "fahh-gold",
  "fahh-dark",
  "fahh-light",
  "github-dark",
  "dracula",
  "solarized-dark",
];

/** New installs start here. Anyone who already picked a theme keeps it. */
export const DEFAULT_THEME: ThemeId = "fahh-gold";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

export function readPersistedTheme(): ThemeId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isThemeId(raw)) return raw;
  } catch {
    // localStorage unavailable (e.g. SSR / tests)
  }
  return DEFAULT_THEME;
}

interface ThemeStore {
  activeTheme: ThemeId;
  setTheme: (id: ThemeId) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  activeTheme: readPersistedTheme(),

  setTheme: (id) => {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore
    }
    set({ activeTheme: id });
  },
}));
