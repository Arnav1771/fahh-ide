import { create } from "zustand";

export type IconThemeId = "material" | "seti" | "catppuccin" | "minimal";

export interface IconThemeDef {
  id: IconThemeId;
  name: string;
  description: string;
  previewIcons: string[]; // e.g. ["TS", "RS", "PY", "React"]
}

export const ICON_THEMES: IconThemeDef[] = [
  {
    id: "material",
    name: "Material Icon Theme",
    description: "Vibrant, high-contrast file and folder icons for 50+ languages and frameworks.",
    previewIcons: ["TypeScript", "Rust", "Python", "React", "Docker"],
  },
  {
    id: "seti",
    name: "Seti UI Icons",
    description: "Classic VS Code & Atom developer icon aesthetic with distinctive badge colors.",
    previewIcons: ["TS", "JS", "HTML", "CSS", "JSON"],
  },
  {
    id: "catppuccin",
    name: "Catppuccin Pastel",
    description: "Soothing pastel tones designed for low eye strain and warm gothic palettes.",
    previewIcons: ["Rust", "Go", "Python", "Markdown", "Git"],
  },
  {
    id: "minimal",
    name: "Modern Minimal",
    description: "Clean monochrome Lucide glyphs with subtle category accent coloring.",
    previewIcons: ["Code", "Text", "Config", "Data", "Media"],
  },
];

const STORAGE_KEY = "fahh-icon-theme";

export function readPersistedIconTheme(): IconThemeId {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "material" || raw === "seti" || raw === "catppuccin" || raw === "minimal") {
        return raw;
      }
    }
  } catch {
    // SSR / test environments
  }
  return "material"; // Default to rich Material Icons
}

interface IconThemeStore {
  activeIconTheme: IconThemeId;
  setIconTheme: (id: IconThemeId) => void;
  /** Check if a marketplace extension is an icon theme and auto-apply */
  registerFromExtension: (extensionId: string, extensionName: string) => IconThemeId | null;
}

export const useIconThemeStore = create<IconThemeStore>((set) => ({
  activeIconTheme: readPersistedIconTheme(),

  setIconTheme: (id: IconThemeId) => {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, id);
      }
    } catch {
      // ignore
    }
    set({ activeIconTheme: id });
  },

  registerFromExtension: (extensionId: string, extensionName: string) => {
    const lower = `${extensionId} ${extensionName}`.toLowerCase();
    let detectedTheme: IconThemeId | null = null;

    if (lower.includes("material") || lower.includes("vscode-icons")) {
      detectedTheme = "material";
    } else if (lower.includes("seti")) {
      detectedTheme = "seti";
    } else if (lower.includes("catppuccin") || lower.includes("pastel")) {
      detectedTheme = "catppuccin";
    } else if (lower.includes("icon")) {
      detectedTheme = "material"; // Default any installed icon pack to rich Material icons
    }

    if (detectedTheme) {
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(STORAGE_KEY, detectedTheme);
        }
      } catch {
        // ignore
      }
      set({ activeIconTheme: detectedTheme });
    }

    return detectedTheme;
  },
}));
