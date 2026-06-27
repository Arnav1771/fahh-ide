import { create } from "zustand";
import type { ThemeId } from "../lib/types";

const STORAGE_KEY = "fahh-theme";

function readPersistedTheme(): ThemeId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (
      raw === "fahh-dark" ||
      raw === "fahh-light" ||
      raw === "github-dark" ||
      raw === "dracula" ||
      raw === "solarized-dark"
    ) {
      return raw;
    }
  } catch {
    // localStorage unavailable (e.g. SSR / tests)
  }
  return "fahh-dark";
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
