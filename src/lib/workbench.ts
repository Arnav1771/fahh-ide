/**
 * The workbench: what the layout does, as plain functions, so the palette, the
 * activity bar, the status bar and the keyboard all call the same thing.
 * The dockview instance is handed over once by <Workbench> (setDockApi).
 */
import type { DockviewApi, DockviewGroupPanel, IDockviewPanel } from "dockview-react";
import { useEditorStore } from "../store/editorStore";
import { requestClose } from "./tabActions";
import { EDITOR_PREFIX, HOME_PREFIX, decodeLayout, encodeLayout, layoutKey, legacySizes, zoneFor, type Zone } from "./dockLayout";
import { getView, listViews, type ViewDef } from "./viewRegistry";

const VIEW_PREFIX = "v:";
let api: DockviewApi | null = null;
let hidden: Record<string, string[]> = {};
let root: string | null = null;
let saveTimer: number | undefined;
const store = () => (typeof localStorage === "undefined" ? undefined : localStorage);

const nameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;
const pathOf = (p: IDockviewPanel): string | undefined => (p.params as { path?: string } | undefined)?.path;
const isEditorPanel = (p: IDockviewPanel) => p.id.startsWith(EDITOR_PREFIX);
const isHome = (p: IDockviewPanel) => p.id.startsWith(HOME_PREFIX);
const isEditorGroup = (g: DockviewGroupPanel) => g.panels.some((p) => isEditorPanel(p) || isHome(p));
const isShown = (g: DockviewGroupPanel) => g.api.isVisible && g.element.getBoundingClientRect().width > 0;

// Dockview moves a dragged tab in several steps (out of one group, into another). Syncing the
// editor store in the middle would see the file "missing" and open it a second time, so wait.
let mutating = 0;
let pending = false;
let unwatch: Array<{ dispose(): void }> = [];

export const setDockApi = (a: DockviewApi | null) => {
  api = a;
  unwatch.forEach((d) => d.dispose());
  mutating = 0;
  unwatch = a
    ? [
        a.onWillMutateLayout(() => void mutating++),
        a.onDidMutateLayout(() => {
          mutating = Math.max(0, mutating - 1);
          if (!mutating && pending) {
            pending = false;
            syncEditors();
          }
        }),
      ]
    : [];
  // The dev build exposes the dock so browser QA can read the layout.
  if (import.meta.env.DEV) (window as unknown as { __fahhDock?: DockviewApi | null }).__fahhDock = a;
};
export const getDockApi = () => api;

// ─── Saving and loading ──────────────────────────────────────────────────────

export function saveLayoutNow(): void {
  window.clearTimeout(saveTimer);
  if (!api) return;
  try {
    const json = encodeLayout(api.toJSON(), { hidden });
    store()?.setItem(layoutKey(root), json);
    // The no-folder key always holds the latest layout: that is what a fresh launch (no folder open yet) starts from.
    if (root !== null) store()?.setItem(layoutKey(null), json);
  } catch (e) {
    console.warn("layout not saved:", e); // e.g. storage blocked: the layout just will not persist
  }
}
export function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveLayoutNow, 250);
}

/** Open the layout saved for this workspace, or the default when there is none (or it is unreadable). */
export function loadLayout(forRoot: string | null, keepIfNone = false): void {
  if (!api) return;
  root = forRoot;
  const raw = store()?.getItem(layoutKey(forRoot));
  const saved = decodeLayout(raw);
  if (raw && !saved) console.warn("saved layout unreadable, using the default");
  if (!saved) {
    if (keepIfNone && api.panels.length) return saveLayoutNow();
    return buildDefault();
  }
  try {
    api.fromJSON(saved.dock);
    hidden = saved.extras.hidden;
    for (const p of [...api.panels]) if (p.id.startsWith(VIEW_PREFIX) && !getView(p.id.slice(VIEW_PREFIX.length))) api.removePanel(p);
    for (const ids of Object.values(hidden)) for (const id of ids) api.getGroup(id)?.api.setVisible(false);
    if (!api.panels.length) throw new Error("empty layout");
    syncEditors();
  } catch (e) {
    console.warn("saved layout unusable, using the default:", e);
    buildDefault();
  }
}

/** View: Reset Layout. */
export function resetLayout(): void {
  buildDefault();
  saveLayoutNow();
}

function buildDefault(): void {
  if (!api) return;
  hidden = {};
  api.clear();
  const sizes = legacySizes(store()); // the v0.5.1 bar sizes carry over into the first layout
  api.addPanel({ id: `${HOME_PREFIX}1`, component: "home", tabComponent: "home", title: "Welcome" });
  const defs = listViews().filter((v) => v.defaultOpen !== false);
  for (const loc of ["sidebar", "secondary", "panel", "editor"] as const) {
    for (const v of defs.filter((d) => d.defaultLocation === loc)) addView(v, sizes);
  }
  for (const id of ["explorer", "terminal"]) api.getPanel(VIEW_PREFIX + id)?.api.setActive();
  syncEditors();
}

// ─── Views ───────────────────────────────────────────────────────────────────

const ZONE_OF: Record<ViewDef["defaultLocation"], Zone> = { sidebar: "primary", secondary: "secondary", panel: "panel", editor: "editor" };

function editorsRect() {
  const rs = (api?.groups ?? []).filter((g) => isEditorGroup(g) && isShown(g)).map((g) => g.element.getBoundingClientRect());
  if (!rs.length) return null;
  return {
    left: Math.min(...rs.map((r) => r.left)),
    right: Math.max(...rs.map((r) => r.right)),
    top: Math.min(...rs.map((r) => r.top)),
    bottom: Math.max(...rs.map((r) => r.bottom)),
  };
}
export function zoneOfGroup(g: DockviewGroupPanel): Zone {
  if (g.panels.some((p) => p.id === VIEW_PREFIX + "terminal")) return "panel"; // the panel is wherever Terminal lives
  return isEditorGroup(g) ? "editor" : zoneFor(g.element.getBoundingClientRect(), editorsRect());
}
const groupsIn = (zone: Zone) => (api?.groups ?? []).filter((g) => isShown(g) && zoneOfGroup(g) === zone);

function addView(def: ViewDef, sizes = legacySizes(store())): IDockviewPanel | undefined {
  if (!api) return;
  const zone = ZONE_OF[def.defaultLocation];
  const base = { id: VIEW_PREFIX + def.id, component: "view", tabComponent: "view", title: def.title, params: { viewId: def.id }, renderer: "always" as const };
  const hiddenId = hidden[zone]?.find((id) => api!.getGroup(id));
  const into = hiddenId ? api.groups.find((g) => g.id === hiddenId) : zone === "editor" ? targetEditorGroup() : groupsIn(zone)[0];
  if (into) {
    if (hiddenId) showZone(zone);
    return api.addPanel({ ...base, position: { referenceGroup: into } });
  }
  const anyEditor = api.groups.find(isEditorGroup);
  if (zone === "primary") return api.addPanel({ ...base, initialWidth: sizes.sidebar, position: { direction: "left" } });
  if (zone === "secondary") return api.addPanel({ ...base, initialWidth: 300, position: { direction: "right" } });
  if (zone === "panel") {
    return api.addPanel({
      ...base,
      initialHeight: sizes.bottom,
      position: anyEditor ? { referenceGroup: anyEditor, direction: "below" } : { direction: "below" },
    });
  }
  return api.addPanel(base);
}

// A group comes back at the size it had when it was hidden.
const sizeBeforeHide = new Map<string, { zone: Zone; width: number; height: number }>();

/**
 * Run a layout change, then put every side bar and the panel back at the size it had,
 * so the editors take up the slack (dockview would otherwise share it out proportionally).
 */
function keepBarSizes(op: () => void): void {
  const bars = (api?.groups ?? [])
    .filter((g) => isShown(g) && !isEditorGroup(g))
    .map((g) => ({ g, zone: zoneOfGroup(g), r: g.element.getBoundingClientRect() }));
  const was = new Set(bars.map(({ g }) => g.id));
  op();
  const put = (g: DockviewGroupPanel, zone: Zone, w: number, h: number) => {
    if (zone === "primary" || zone === "secondary") g.api.setSize({ width: Math.round(w) });
    else if (zone === "panel") g.api.setSize({ height: Math.round(h) });
  };
  // Twice: with several bars on one side, the first pass can shift a neighbour.
  for (let pass = 0; pass < 2; pass++) {
    for (const { g, zone, r } of bars) if (isShown(g)) put(g, zone, r.width, r.height);
    // Groups that were hidden and are back come at the size they had.
    for (const [id, z] of sizeBeforeHide) {
      const g = api?.groups.find((x) => x.id === id);
      if (g && isShown(g) && !was.has(id)) put(g, z.zone, z.width, z.height);
    }
  }
}

/** Show a view: add it where it belongs if it was closed, un-hide its bar, bring it to the front. */
export function revealView(id: string): void {
  const def = getView(id);
  if (!api || !def) return;
  let fresh: IDockviewPanel | undefined;
  keepBarSizes(() => {
    if (!api) return;
    let panel = api.getPanel(VIEW_PREFIX + id);
    if (!panel) panel = fresh = addView(def);
    if (!panel) return;
    for (const z of Object.keys(hidden)) if (hidden[z]?.includes(panel.group.id)) showZone(z as Zone);
    if (api.hasMaximizedGroup() && !panel.group.api.isMaximized()) api.exitMaximizedGroup();
    panel.api.setActive();
  });
  // A bar opened for the first time starts at its usual size (the others were put back above).
  if (fresh && fresh.group.panels.length === 1) {
    const zone = ZONE_OF[def.defaultLocation];
    if (zone === "primary") fresh.group.api.setSize({ width: legacySizes(store()).sidebar });
    else if (zone === "secondary") fresh.group.api.setSize({ width: 300 });
    else if (zone === "panel") fresh.group.api.setSize({ height: legacySizes(store()).bottom });
  }
  scheduleSave();
}

/** The view on screen in a group (for the activity bar highlight). */
export const activeViewId = (): string | undefined => {
  const p = api?.activePanel;
  return p?.id.startsWith(VIEW_PREFIX) ? p.id.slice(VIEW_PREFIX.length) : undefined;
};

// ─── Side bars and the panel ─────────────────────────────────────────────────

function showZone(zone: Zone): void {
  for (const id of hidden[zone] ?? []) api?.getGroup(id)?.api.setVisible(true);
  hidden[zone] = [];
}

/** Ctrl+B (primary), Ctrl+Alt+B (secondary), Ctrl+` (panel). */
export function toggleZone(zone: Zone): void {
  if (!api) return;
  keepBarSizes(() => toggleZoneNow(zone));
  scheduleSave();
}

function toggleZoneNow(zone: Zone): void {
  if (!api) return;
  const open = groupsIn(zone);
  if (open.length) {
    if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
    hidden[zone] = open.map((g) => g.id);
    for (const g of open) {
      const r = g.element.getBoundingClientRect(); // all read before any is hidden: hiding one resizes its neighbours
      sizeBeforeHide.set(g.id, { zone, width: Math.round(r.width), height: Math.round(r.height) });
    }
    open.forEach((g) => g.api.setVisible(false));
  } else if (hidden[zone]?.some((id) => api!.getGroup(id))) {
    showZone(zone);
  } else {
    // Nothing there yet: open the first view that belongs in that bar.
    const loc = zone === "primary" ? "sidebar" : zone === "secondary" ? "secondary" : "panel";
    const v = listViews().find((d) => d.defaultLocation === loc);
    if (v) revealView(v.id);
  }
}

/** Maximize the bottom panel (or whichever view group has focus); again to restore. */
export function toggleMaximizePanel(): void {
  if (!api) return;
  if (api.hasMaximizedGroup()) return api.exitMaximizedGroup();
  const active = api.activeGroup;
  const g = active && !isEditorGroup(active) ? active : groupsIn("panel")[0];
  g?.api.maximize();
}

/** Move the panel (the group Terminal lives in) to the bottom, or beside the editors on the left or right. */
export function movePanel(to: "bottom" | "left" | "right"): void {
  if (!api) return;
  const g = api.getPanel(VIEW_PREFIX + "terminal")?.group ?? groupsIn("panel")[0];
  if (!g) return;
  showZone("panel");
  const eds = api.groups.filter((x) => x !== g && isEditorGroup(x) && isShown(x));
  const left = (x: DockviewGroupPanel) => x.element.getBoundingClientRect().left;
  eds.sort((x, y) => left(x) - left(y));
  const anchor = to === "right" ? eds[eds.length - 1] : eds[0];
  if (anchor) g.api.moveTo({ group: anchor, position: to });
  scheduleSave();
}

// ─── Editors ─────────────────────────────────────────────────────────────────

function targetEditorGroup(): DockviewGroupPanel | undefined {
  if (!api) return;
  const a = api.activeGroup;
  if (a && isEditorGroup(a)) return a;
  return api.groups.find((g) => isEditorGroup(g) && isShown(g)) ?? api.groups.find(isEditorGroup);
}

const panelsFor = (path: string) => (api?.panels ?? []).filter((p) => isEditorPanel(p) && pathOf(p) === path);

function editorPanelOptions(path: string, id: string) {
  return { id, component: "editor", tabComponent: "editor", title: nameOf(path), params: { path } };
}

/** Make the dock show exactly the files the editor store has open. Safe to call at any time. */
export function syncEditors(): void {
  if (!api) return;
  if (mutating) {
    pending = true;
    return;
  }
  const { openTabs, activeTab } = useEditorStore.getState();
  const open = new Set(openTabs.map((t) => t.path));
  // Closed or renamed files lose their tabs; a Welcome placeholder takes the place of the last one.
  for (const p of api.panels.filter((x) => isEditorPanel(x) && !open.has(pathOf(x) ?? ""))) {
    const left = api.panels.filter((x) => isEditorPanel(x) && x !== p).length;
    if (!left && !api.panels.some(isHome)) {
      api.addPanel({ id: `${HOME_PREFIX}${Date.now()}`, component: "home", tabComponent: "home", title: "Welcome", position: { referenceGroup: p.group } });
    }
    api.removePanel(p);
  }
  for (const t of openTabs) {
    if (panelsFor(t.path).length) continue;
    const g = targetEditorGroup();
    const opts = editorPanelOptions(t.path, EDITOR_PREFIX + t.path);
    const added = api.addPanel(g ? { ...opts, position: { referenceGroup: g } } : { ...opts, position: { direction: "right" } });
    for (const h of added.group.panels.filter(isHome)) api.removePanel(h);
  }
  if (activeTab) {
    const mine = panelsFor(activeTab);
    if (mine.length && !(api.activePanel && mine.includes(api.activePanel))) {
      (mine.find((p) => p.group === api!.activeGroup) ?? mine[0]).api.setActive();
    }
  }
}

/** Close an editor tab: the last tab of a file asks first when it has unsaved changes. */
export function closeEditorPanel(panel: IDockviewPanel): boolean {
  const path = pathOf(panel);
  if (!path) return false;
  if (panelsFor(path).length > 1) {
    panel.api.close();
    return true;
  }
  const done = requestClose(path); // the store drops the tab and syncEditors removes the panel
  if (done) syncEditors();
  return done;
}

/** Close every editor in a group, stopping at the first "no" to an unsaved-changes question. */
export function closeEditorGroup(group: DockviewGroupPanel): void {
  for (const p of [...group.panels]) if (isEditorPanel(p) && !closeEditorPanel(p)) return;
}

/** Ctrl+\ : the active editor again in a new group to its right (same file, same model). */
export function splitActiveEditor(direction: "right" | "below" = "right"): void {
  const p = api?.activePanel;
  const path = p && isEditorPanel(p) ? pathOf(p) : undefined;
  if (!api || !p || !path) return;
  let n = 2;
  while (api.getPanel(`${EDITOR_PREFIX}${path}#${n}`)) n++;
  api.addPanel({ ...editorPanelOptions(path, `${EDITOR_PREFIX}${path}#${n}`), position: { referenceGroup: p.group, direction } }).api.setActive();
}
