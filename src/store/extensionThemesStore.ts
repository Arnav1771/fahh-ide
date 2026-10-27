import { create } from "zustand";
import type { ConvertedTheme } from "../lib/vscodeTheme";

/** Colour themes installed from Open VSX, already converted (see lib/vscodeTheme). */
const KEY = "fahh-extension-themes";

function load(): ConvertedTheme[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((t) => typeof t?.id === "string" && t.id.startsWith("ext-") && t.monaco && t.cssVars) : [];
  } catch {
    return [];
  }
}

interface ExtensionThemesStore {
  themes: ConvertedTheme[];
  /** Replace the themes of one extension (install or update). */
  add: (extId: string, themes: ConvertedTheme[]) => void;
  remove: (extId: string) => void;
}

export const useExtensionThemes = create<ExtensionThemesStore>((set, get) => {
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(get().themes));
    } catch {
      // storage full or blocked: installed for this session only
    }
  };
  return {
    themes: load(),
    add: (extId, themes) => {
      set((s) => ({ themes: [...s.themes.filter((t) => t.extId !== extId), ...themes] }));
      save();
    },
    remove: (extId) => {
      set((s) => ({ themes: s.themes.filter((t) => t.extId !== extId) }));
      save();
    },
  };
});
