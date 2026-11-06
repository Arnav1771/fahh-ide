/**
 * The xterm colours for the active app theme (docked and canvas terminals alike): background,
 * text and cursor from the theme's tokens, and a 16-colour ANSI palette picked for a light or a
 * dark page. xterm's default palette assumes a dark page: on Fahh Light its white, bright white
 * and yellow were invisible, so the terminal looked blank.
 */

/** Relative luminance of a #rrggbb colour (WCAG). */
export function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export const isLightColour = (hex: string) => /^#[0-9a-f]{6}$/i.test(hex) && luminance(hex) > 0.4;

/** Every colour reads at 4.5:1 or more on a light page (#f8fafc). */
export const LIGHT_ANSI = {
  black: "#1e293b", red: "#b91c1c", green: "#166534", yellow: "#854d0e",
  blue: "#1d4ed8", magenta: "#a21caf", cyan: "#0e7490", white: "#475569",
  brightBlack: "#576476", brightRed: "#c2410c", brightGreen: "#15803d", brightYellow: "#a16207",
  brightBlue: "#2563eb", brightMagenta: "#9333ea", brightCyan: "#0f766e", brightWhite: "#334155",
};

/** Every colour but black reads at 4.5:1 or more on a dark page (#0a0907 to #2b2d3a). */
export const DARK_ANSI = {
  black: "#3b3f4a", red: "#f87171", green: "#4ade80", yellow: "#facc15",
  blue: "#60a5fa", magenta: "#e879f9", cyan: "#22d3ee", white: "#d1d5db",
  brightBlack: "#9ca3af", brightRed: "#fca5a5", brightGreen: "#86efac", brightYellow: "#fde047",
  brightBlue: "#93c5fd", brightMagenta: "#f0abfc", brightCyan: "#67e8f9", brightWhite: "#f9fafb",
};

export function xtermTheme(bg: string, fg: string, accent: string) {
  const light = isLightColour(bg);
  return {
    ...(light ? LIGHT_ANSI : DARK_ANSI),
    background: bg,
    foreground: fg,
    cursor: accent,
    cursorAccent: bg,
    // #rrggbbaa: xterm parses that itself (not color-mix)
    selectionBackground: /^#[0-9a-f]{6}$/i.test(accent) ? accent + (light ? "38" : "59") : "rgba(128, 128, 128, 0.35)",
    selectionForeground: fg,
  };
}

/** The theme from the CSS variables on <html> (applyThemeCssVars sets them). */
export function xtermThemeFromCss() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return xtermTheme(v("--fahh-bg", "#0a0907"), v("--fahh-text", "#f0ebe0"), v("--fahh-accent", "#d4a03c"));
}
