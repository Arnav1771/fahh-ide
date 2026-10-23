/**
 * Pure helpers for the workbench layout: what is saved, how it is read back, and
 * which side of the editors a group sits on. No dockview import, so tests need no DOM.
 */
import { loadSize } from "./panelSize";

export const LAYOUT_VERSION = 2;
/** Editor tabs are saved with the layout and come back when their files still exist; the rest become Welcome placeholders. */
export const EDITOR_PREFIX = "ed:";
export const HOME_PREFIX = "home:";
export const VIEW_PREFIX = "v:";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export interface Extras {
  /** Group ids hidden by a toggle, per zone, so the toggle can bring them back. */
  hidden: Record<string, string[]>;
}
export interface SavedLayout {
  dock: Json;
  extras: Extras;
}

export const layoutKey = (root: string | null): string => `fahh-layout:v${LAYOUT_VERSION}:${root ?? ""}`;

const uniq = <T,>(a: T[]) => [...new Set(a)];

/** A file on disk (New File buffers have no folder in their path and cannot come back). */
export const isDiskPath = (p: unknown): p is string => typeof p === "string" && /[\\/]/.test(p);

/** The files the saved editor tabs show, each once. */
export function savedEditorPaths(dock: Json): string[] {
  const out: string[] = [];
  for (const p of Object.values<Json>(dock?.panels ?? {})) {
    const path = p?.contentComponent === "editor" ? p.params?.path : undefined;
    if (isDiskPath(path) && !out.includes(path)) out.push(path);
  }
  return out;
}

/**
 * Replace editor panels with a Welcome placeholder (one per group, and none in a group that
 * still has an editor), keeping the split structure. `keep` says which files stay as tabs.
 */
export function editorsToHome(input: Json, keep: (path: string) => boolean = () => false): Json {
  const dock = JSON.parse(JSON.stringify(input));
  const map = new Map<string, string>();
  const panels: Record<string, Json> = {};
  let n = 0;
  for (const [id, p] of Object.entries<Json>(dock.panels ?? {})) {
    if (p?.contentComponent === "editor" && !keep(p.params?.path)) {
      const h = `${HOME_PREFIX}${++n}`;
      map.set(id, h);
      panels[h] = { id: h, contentComponent: "home", tabComponent: "home", title: "Welcome", params: {} };
    } else panels[id] = p;
  }
  const walk = (node: Json) => {
    if (!node) return;
    if (Array.isArray(node.data)) return node.data.forEach(walk);
    const d = node.data;
    if (!d || !Array.isArray(d.views)) return;
    const mapped: string[] = uniq(d.views.map((v: string) => map.get(v) ?? v));
    const hasEditor = mapped.some((v) => panels[v]?.contentComponent === "editor");
    const firstHome = hasEditor ? undefined : mapped.find((v) => v.startsWith(HOME_PREFIX));
    const views = mapped.filter((v) => !v.startsWith(HOME_PREFIX) || v === firstHome);
    for (const v of mapped) if (!views.includes(v)) delete panels[v];
    d.views = views;
    const act = d.activeView ? map.get(d.activeView) ?? d.activeView : undefined;
    d.activeView = act && views.includes(act) ? act : views[0];
  };
  walk(dock.grid?.root);
  dock.panels = panels;
  delete dock.floatingGroups;
  delete dock.popoutGroups;
  return dock;
}

export function encodeLayout(dock: Json, extras: Extras): string {
  return JSON.stringify({ v: LAYOUT_VERSION, dock: editorsToHome(dock, isDiskPath), extras });
}

/** Read a saved layout; null (use the default) for anything missing, older, newer or damaged. */
export function decodeLayout(raw: string | null | undefined): SavedLayout | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || o.v !== LAYOUT_VERSION || !o.dock?.grid?.root || typeof o.dock.panels !== "object") return null;
    const hidden = o.extras?.hidden && typeof o.extras.hidden === "object" ? o.extras.hidden : {};
    return { dock: o.dock, extras: { hidden } };
  } catch {
    return null;
  }
}

type Rect = { left: number; right: number; top: number; bottom: number };
export type Zone = "primary" | "secondary" | "panel" | "editor";

/** Which bar a view group is, judged by where it sits next to the editor groups. */
export function zoneFor(r: Rect, editors: Rect | null): Zone {
  if (!editors) return "primary";
  const tol = 2;
  if (r.right <= editors.left + tol) return "primary";
  if (r.left >= editors.right - tol) return "secondary";
  if (r.top >= editors.bottom - tol || r.bottom <= editors.top + tol) return "panel";
  return "editor";
}

/** The pre-dock bar sizes (lib/panelSize keys); the first layout starts from them. */
export function legacySizes(store?: Pick<Storage, "getItem">): { sidebar: number; bottom: number } {
  return {
    sidebar: loadSize("fahh-sidebar-w", 240, 160, 560, store),
    bottom: loadSize("fahh-bottom-h", 208, 80, 600, store),
  };
}
