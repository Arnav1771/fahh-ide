import { useThemeStore } from "../../store/themeStore";
import type { ThemeId } from "../../lib/types";

// ─── Theme definitions ────────────────────────────────────────────────────────

interface ThemeDef {
  id: ThemeId;
  name: string;
  /** Monaco editor theme name */
  monacoTheme: string;
  /** CSS variable overrides applied to :root */
  cssVars: Record<string, string>;
  /** Preview colour swatches: [bg, sidebar, surface, accent] */
  swatches: [string, string, string, string];
  description: string;
}

export const THEME_DEFINITIONS: ThemeDef[] = [
  {
    id: "fahh-dark",
    name: "Fahh Dark",
    monacoTheme: "vs-dark",
    description: "The default dark theme with a purple accent.",
    cssVars: {
      "--fahh-bg": "#0e0e12",
      "--fahh-sidebar": "#16161d",
      "--fahh-surface": "#1e1e2a",
      "--fahh-accent": "#a78bfa",
      "--fahh-text": "#e2e8f0",
      "--fahh-muted": "#64748b",
      "--fahh-error": "#f87171",
      "--fahh-warn": "#fbbf24",
      "--fahh-success": "#34d399",
      "--fahh-info": "#60a5fa",
    },
    swatches: ["#0e0e12", "#16161d", "#1e1e2a", "#a78bfa"],
  },
  {
    id: "fahh-light",
    name: "Fahh Light",
    monacoTheme: "vs",
    description: "Clean light theme for well-lit environments.",
    cssVars: {
      "--fahh-bg": "#f8fafc",
      "--fahh-sidebar": "#f1f5f9",
      "--fahh-surface": "#e2e8f0",
      "--fahh-accent": "#7c3aed",
      "--fahh-text": "#0f172a",
      "--fahh-muted": "#94a3b8",
      "--fahh-error": "#dc2626",
      "--fahh-warn": "#d97706",
      "--fahh-success": "#059669",
      "--fahh-info": "#2563eb",
    },
    swatches: ["#f8fafc", "#f1f5f9", "#e2e8f0", "#7c3aed"],
  },
  {
    id: "github-dark",
    name: "GitHub Dark",
    monacoTheme: "vs-dark",
    description: "Familiar GitHub dark palette.",
    cssVars: {
      "--fahh-bg": "#0d1117",
      "--fahh-sidebar": "#161b22",
      "--fahh-surface": "#21262d",
      "--fahh-accent": "#58a6ff",
      "--fahh-text": "#c9d1d9",
      "--fahh-muted": "#6e7681",
      "--fahh-error": "#f85149",
      "--fahh-warn": "#e3b341",
      "--fahh-success": "#3fb950",
      "--fahh-info": "#79c0ff",
    },
    swatches: ["#0d1117", "#161b22", "#21262d", "#58a6ff"],
  },
  {
    id: "dracula",
    name: "Dracula",
    monacoTheme: "vs-dark",
    description: "The beloved Dracula colour scheme.",
    cssVars: {
      "--fahh-bg": "#282a36",
      "--fahh-sidebar": "#21222c",
      "--fahh-surface": "#343746",
      "--fahh-accent": "#bd93f9",
      "--fahh-text": "#f8f8f2",
      "--fahh-muted": "#6272a4",
      "--fahh-error": "#ff5555",
      "--fahh-warn": "#ffb86c",
      "--fahh-success": "#50fa7b",
      "--fahh-info": "#8be9fd",
    },
    swatches: ["#282a36", "#21222c", "#343746", "#bd93f9"],
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    monacoTheme: "vs-dark",
    description: "Precision colours for machines and people.",
    cssVars: {
      "--fahh-bg": "#002b36",
      "--fahh-sidebar": "#073642",
      "--fahh-surface": "#073642",
      "--fahh-accent": "#268bd2",
      "--fahh-text": "#839496",
      "--fahh-muted": "#586e75",
      "--fahh-error": "#dc322f",
      "--fahh-warn": "#b58900",
      "--fahh-success": "#859900",
      "--fahh-info": "#2aa198",
    },
    swatches: ["#002b36", "#073642", "#073642", "#268bd2"],
  },
];

// ─── CSS variable application ─────────────────────────────────────────────────

export function applyThemeCssVars(def: ThemeDef): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(def.cssVars)) {
    root.style.setProperty(key, value);
  }
  // Notify Monaco (and any other listener) that the theme changed so they can
  // update their own theme API — CSS variables alone don't reach Monaco's
  // internal renderer in the native Tauri build.
  window.dispatchEvent(
    new CustomEvent("fahh-theme-change", { detail: def })
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ThemePanel() {
  const { activeTheme, setTheme } = useThemeStore();

  const handleSelect = (def: ThemeDef) => {
    setTheme(def.id);
    applyThemeCssVars(def);
  };

  return (
    <div className="flex flex-col gap-1 p-3">
      <p className="text-[10px] uppercase tracking-widest text-fahh-muted mb-2 font-semibold">
        Colour Theme
      </p>

      {THEME_DEFINITIONS.map((def) => {
        const isActive = def.id === activeTheme;
        const [bg, sidebar, surface, accent] = def.swatches;

        return (
          <button
            key={def.id}
            onClick={() => handleSelect(def)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border transition-all text-left ${
              isActive
                ? "border-fahh-accent bg-fahh-accent/10"
                : "border-fahh-surface bg-fahh-surface hover:border-fahh-muted"
            }`}
          >
            {/* Swatch preview */}
            <div className="flex gap-0.5 shrink-0 rounded overflow-hidden border border-white/10">
              {[bg, sidebar, surface, accent].map((colour, i) => (
                <span
                  key={i}
                  style={{ backgroundColor: colour }}
                  className="w-4 h-6 block"
                />
              ))}
            </div>

            {/* Name + description */}
            <div className="flex-1 min-w-0">
              <p
                className={`text-xs font-semibold truncate ${
                  isActive ? "text-fahh-accent" : "text-fahh-text"
                }`}
              >
                {def.name}
              </p>
              <p className="text-[10px] text-fahh-muted truncate">{def.description}</p>
            </div>

            {/* Active checkmark */}
            {isActive && (
              <span className="text-fahh-accent text-sm shrink-0">✓</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
