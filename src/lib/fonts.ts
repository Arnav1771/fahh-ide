/** Editor font choices for Settings. The setting itself stays a CSS font list (any string works). */
export const MONO_FONTS = [
  "JetBrains Mono",
  "Fira Code",
  "Cascadia Code",
  "Cascadia Mono",
  "Consolas",
  "Source Code Pro",
  "IBM Plex Mono",
  "Ubuntu Mono",
  "DejaVu Sans Mono",
  "Hack",
  "Menlo",
  "Monaco",
  "SF Mono",
  "Courier New",
] as const;

/** The font list stored for a picked font: the font, then the generic fallback. */
export const fontStack = (name: string) => `${name}, monospace`;

const norm = (list: string) =>
  list
    .split(",")
    .map((f) => f.trim().replace(/^["']|["']$/g, "").toLowerCase())
    .filter(Boolean)
    .join(",");

/** Which listed font a stored font list is, or null when it is a custom list. */
export function presetOf(value: string): string | null {
  const v = norm(value);
  return MONO_FONTS.find((f) => norm(fontStack(f)) === v || norm(f) === v) ?? null;
}

/** The first family in a font list, unquoted. */
export const firstFamily = (list: string) => list.split(",")[0]?.trim().replace(/^["']|["']$/g, "") ?? "";

/**
 * Whether a font is installed: text set in it measures differently from the generic fallbacks.
 * (document.fonts.check answers true for any system font name, installed or not.) Null when
 * there is no canvas to measure with.
 */
export function isFontInstalled(name: string, measure: ((font: string) => number) | null = canvasMeasure()): boolean | null {
  if (!measure) return null;
  return (["monospace", "serif", "sans-serif"] as const).some((g) => measure(`16px "${name}", ${g}`) !== measure(`16px ${g}`));
}

function canvasMeasure(): ((font: string) => number) | null {
  const ctx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  return (font) => {
    ctx.font = font;
    return ctx.measureText("mmmmmmmmmmlli10OO@#").width;
  };
}
