/**
 * A VS Code colour theme (from an Open VSX extension) as a Fahh theme: the app's CSS
 * variables from its workbench colours, and a Monaco theme from its editor colours and
 * TextMate token colours.
 */
import { parseJsonc } from "./launchConfig";

export interface MonacoThemeData {
  base: "vs" | "vs-dark" | "hc-black";
  inherit: boolean;
  rules: { token: string; foreground?: string; fontStyle?: string }[];
  colors: Record<string, string>;
}

export interface ConvertedTheme {
  /** `ext-…`: also the Monaco theme name (Monaco allows only [a-z0-9-]). */
  id: `ext-${string}`;
  name: string;
  monacoTheme: string;
  description: string;
  cssVars: Record<string, string>;
  swatches: [string, string, string, string];
  monaco: MonacoThemeData;
  /** The extension it came from (namespace.name). */
  extId: string;
}

interface VsTheme {
  colors?: Record<string, unknown>;
  tokenColors?: unknown;
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "theme";

/** "#abc" / "#abcd" / "#aabbccdd" → "aabbcc" for a Monaco token rule (rules take no alpha). */
function ruleColor(hex: string): string | undefined {
  if (!HEX.test(hex)) return undefined;
  let h = hex.slice(1);
  if (h.length <= 4) h = [...h.slice(0, 3)].map((c) => c + c).join("");
  return h.slice(0, 6).toLowerCase();
}

/** TextMate scope prefix → Monaco (Monarch) token names, most specific first. */
const SCOPE_TOKENS: [string, string[]][] = [
  ["comment", ["comment"]],
  ["string.regexp", ["regexp"]],
  ["constant.character.escape", ["string.escape"]],
  ["string", ["string"]],
  ["constant.numeric", ["number"]],
  ["constant.language", ["keyword"]],
  ["keyword.operator", ["operator"]],
  ["keyword", ["keyword"]],
  ["storage", ["keyword"]],
  ["entity.name.type", ["type", "type.identifier"]],
  ["entity.name.class", ["type", "type.identifier"]],
  ["support.type", ["type"]],
  ["support.class", ["type"]],
  ["entity.name.tag", ["tag"]],
  ["entity.other.attribute-name", ["attribute.name"]],
  ["variable", ["variable", "identifier"]],
  ["punctuation", ["delimiter"]],
];

export function tokensForScope(scope: string): string[] {
  const s = scope.trim().split(/\s+/).pop() ?? ""; // "source.js comment.line" → its last part
  return SCOPE_TOKENS.find(([prefix]) => s === prefix || s.startsWith(`${prefix}.`))?.[1] ?? [];
}

function tokenRules(tokenColors: unknown, defaultFg: string | undefined): MonacoThemeData["rules"] {
  const byToken = new Map<string, MonacoThemeData["rules"][number]>();
  if (defaultFg) byToken.set("", { token: "", foreground: defaultFg });
  if (!Array.isArray(tokenColors)) return [...byToken.values()];
  for (const entry of tokenColors) {
    const settings = (entry as { settings?: { foreground?: unknown; fontStyle?: unknown } })?.settings;
    const rawScope = (entry as { scope?: unknown })?.scope;
    if (!settings || rawScope === undefined) continue;
    const scopes = Array.isArray(rawScope) ? rawScope : String(rawScope).split(",");
    const foreground = typeof settings.foreground === "string" ? ruleColor(settings.foreground) : undefined;
    const fontStyle = typeof settings.fontStyle === "string" ? settings.fontStyle : undefined;
    if (!foreground && fontStyle === undefined) continue;
    for (const sc of scopes) {
      for (const token of tokensForScope(String(sc))) {
        // Later entries are the more specific ones in TextMate themes: they win.
        byToken.set(token, { token, ...(foreground ? { foreground } : {}), ...(fontStyle !== undefined ? { fontStyle } : {}) });
      }
    }
  }
  return [...byToken.values()];
}

export function convertVsCodeTheme(extId: string, label: string, uiTheme: string, json: string, includeJson?: string): ConvertedTheme {
  const theme = (parseJsonc(json) ?? {}) as VsTheme;
  const base = includeJson ? ((parseJsonc(includeJson) ?? {}) as VsTheme) : {};
  const colors: Record<string, string> = {};
  for (const src of [base.colors, theme.colors]) {
    for (const [k, v] of Object.entries(src ?? {})) if (typeof v === "string" && HEX.test(v)) colors[k] = v;
  }
  const tokenColors = [...(Array.isArray(base.tokenColors) ? base.tokenColors : []), ...(Array.isArray(theme.tokenColors) ? theme.tokenColors : [])];
  const light = uiTheme === "vs";
  const pick = (...keys: string[]) => keys.map((k) => colors[k]).find(Boolean);

  const bg = pick("editor.background") ?? (light ? "#ffffff" : "#1e1e1e");
  const text = pick("editor.foreground", "foreground") ?? (light ? "#333333" : "#d4d4d4");
  const sidebar = pick("sideBar.background", "activityBar.background", "panel.background") ?? bg;
  const surface = pick("input.background", "editorWidget.background", "list.hoverBackground", "dropdown.background") ?? sidebar;
  const accent = pick("focusBorder", "button.background", "activityBarBadge.background", "textLink.foreground") ?? (light ? "#007acc" : "#3794ff");
  const cssVars: Record<string, string> = {
    "--fahh-bg": bg,
    "--fahh-sidebar": sidebar,
    "--fahh-surface": surface,
    "--fahh-accent": accent,
    "--fahh-text": text,
    "--fahh-muted": pick("descriptionForeground", "editorLineNumber.foreground", "tab.inactiveForeground") ?? (light ? "#6a737d" : "#858585"),
    "--fahh-error": pick("errorForeground", "editorError.foreground") ?? "#f14c4c",
    "--fahh-warn": pick("editorWarning.foreground", "list.warningForeground") ?? "#cca700",
    "--fahh-success": pick("gitDecoration.addedResourceForeground", "terminal.ansiGreen") ?? "#3fb950",
    "--fahh-info": pick("editorInfo.foreground", "terminal.ansiBlue") ?? "#3794ff",
    "--fahh-titlebar": pick("titleBar.activeBackground") ?? sidebar,
  };

  const id = `ext-${slug(extId)}-${slug(label)}` as const;
  const monacoColors = Object.fromEntries(
    Object.entries(colors).filter(([k]) => /^(editor|scrollbar|minimap|list\.|input\.|dropdown\.|widget\.|focusBorder|foreground|peekView|diffEditor)/.test(k))
  );
  return {
    id,
    name: label,
    monacoTheme: id,
    description: `From ${extId} (Open VSX)`,
    cssVars,
    swatches: [bg, sidebar, surface, accent],
    monaco: { base: light ? "vs" : uiTheme === "hc-black" ? "hc-black" : "vs-dark", inherit: true, rules: tokenRules(tokenColors, ruleColor(text)), colors: monacoColors },
    extId,
  };
}
