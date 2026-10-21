import { create } from "zustand";

export type IconThemeId = "material" | "fahh" | "minimal";

export interface IconThemeDef {
  id: IconThemeId;
  name: string;
  description: string;
}

export const ICON_THEMES: IconThemeDef[] = [
  {
    id: "material",
    name: "Material",
    description: "Full-colour file and folder icons from Material Icon Theme (MIT, by Philipp Kief).",
  },
  {
    id: "fahh",
    name: "Fahh Colour",
    description: "Lucide line glyphs tinted by file type.",
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Monochrome Lucide line glyphs.",
  },
];

const STORAGE_KEY = "fahh-icon-theme";

export function readPersistedIconTheme(): IconThemeId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (ICON_THEMES.some((t) => t.id === raw)) return raw as IconThemeId;
  } catch {
    // localStorage unavailable (SSR / tests)
  }
  // Also where the retired "seti" / "catppuccin" choices land.
  return "material";
}

interface IconThemeStore {
  activeIconTheme: IconThemeId;
  setIconTheme: (id: IconThemeId) => void;
}

export const useIconThemeStore = create<IconThemeStore>((set) => ({
  activeIconTheme: readPersistedIconTheme(),

  setIconTheme: (id: IconThemeId) => {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore
    }
    set({ activeIconTheme: id });
  },
}));
