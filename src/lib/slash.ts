/**
 * Slash commands for the panel's "/" menu. The command table is the JSON file
 * the fahh-agent CLI also reads (src-tauri/src/agent/slash.rs), so both
 * surfaces have the same names, aliases and descriptions.
 */
import table from "./slash-commands.json";
import type { AgentMode } from "./types";

export interface SlashDef {
  name: string;
  aliases: string[];
  group: string;
  /** A lucide-react icon name. */
  icon: string;
  desc: string;
  args: string | null;
}

export const SLASH_COMMANDS: SlashDef[] = table as SlashDef[];

export interface ParsedSlash {
  /** Canonical name, aliases resolved. */
  name: string;
  arg: string;
}

const byWord = (word: string) => SLASH_COMMANDS.find((d) => d.name === word || d.aliases.includes(word));

/** `null`: not a command (a normal prompt). A string result is an error to show. */
export function parseSlash(line: string): ParsedSlash | string | null {
  const t = line.trim();
  if (!t.startsWith("/")) return null;
  const rest = t.slice(1);
  const m = rest.match(/^(\S*)\s*([\s\S]*)$/);
  const word = (m?.[1] ?? "").toLowerCase();
  if (!word || word.includes("/")) return null; // "/usr/bin/x" or a lone slash is a prompt
  const def = byWord(word);
  return def ? { name: def.name, arg: (m?.[2] ?? "").trim() } : `Unknown command /${word}. Type / to see them.`;
}

/** What the menu shows while the user types "/xyz": names and aliases starting with it, then containing it. */
export function filterSlash(query: string): SlashDef[] {
  const q = query.replace(/^\//, "").toLowerCase();
  if (!q) return SLASH_COMMANDS;
  const starts = (d: SlashDef) => d.name.startsWith(q) || d.aliases.some((a) => a.startsWith(q));
  const has = (d: SlashDef) => d.name.includes(q) || d.aliases.some((a) => a.includes(q)) || d.desc.toLowerCase().includes(q);
  return [...SLASH_COMMANDS.filter(starts), ...SLASH_COMMANDS.filter((d) => !starts(d) && has(d))];
}

/** Menu sections in table order. */
export function groupSlash(defs: SlashDef[]): { group: string; items: SlashDef[] }[] {
  const out: { group: string; items: SlashDef[] }[] = [];
  for (const d of defs) {
    const g = out.find((x) => x.group === d.group);
    if (g) g.items.push(d);
    else out.push({ group: d.group, items: [d] });
  }
  return out;
}

/** The menu is open while the whole input is a single "/word" (no space yet). */
export function menuQuery(input: string): string | null {
  return /^\/[^\s/]*$/.test(input) ? input.slice(1) : null;
}

/** Usage text for the input after a command is picked. */
export function insertion(def: SlashDef): string {
  return `/${def.name}${def.args ? " " : ""}`;
}

const MODE_NAMES: Record<string, AgentMode> = {
  ask: "ask", normal: "ask", code: "ask", default: "ask",
  "auto-edit": "auto-edit", "accept-edits": "auto-edit", acceptedits: "auto-edit", edits: "auto-edit",
  smart: "smart",
  plan: "plan",
  bypass: "bypass", yolo: "bypass", dangerous: "bypass",
  qa: "qa", "read-only": "qa", readonly: "qa",
};

export function parseMode(name: string): AgentMode | null {
  return MODE_NAMES[name.trim().toLowerCase()] ?? null;
}

export const MODE_LABEL: Record<AgentMode, string> = {
  ask: "normal",
  "auto-edit": "accept-edits",
  smart: "smart",
  plan: "plan",
  bypass: "bypass",
  qa: "ask (read-only)",
};
