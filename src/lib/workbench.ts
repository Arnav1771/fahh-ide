/**
 * The workbench: what the layout does, as plain functions, so the palette, the
 * menu bar, the activity bar and the keyboard all call the same thing.
 * The dockview instance is handed over once by <Workbench> (setDockApi).
 */
import type { DockviewApi, DockviewGroupPanel, IDockviewPanel } from "dockview-react";
import { useEditorStore } from "../store/editorStore";
import { useSettingsStore } from "../store/settingsStore";
import { ensureEditorMode } from "../store/layoutModeStore";
import { confirmClose, forceClose, rememberClosed } from "./tabActions";
import { readFile } from "./tauri";
import { isPreviewOnly } from "./preview";
import { languageFor } from "./tabs";
import {
  EDITOR_PREFIX,
  HOME_PREFIX,
  VIEW_PREFIX,
  decodeLayout,
  editorsToHome,
  encodeLayout,
  layoutKey,
  legacySizes,
  savedEditorPaths,
  zoneFor,
  type SavedLayout,
  type Zone,
} from "./dockLayout";
import { getView, listViews, type ViewDef } from "./viewRegistry";

let api: DockviewApi | null = null;
let hidden: Record<string, string[]> = {};
let root: string | null = null;
let saveTimer: number | undefined;
const store = () => (typeof localStorage === "undefined" ? undefined : localStorage);
const SECONDARY_W = 340;

const nameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;
const pathOf = (p: IDockviewPanel): string | undefined => (p.params as { path?: string } | undefined)?.path;
const isEditorPanel = (p: IDockviewPanel) => p.id.startsWith(EDITOR_PREFIX);
const isHome = (p: IDockviewPanel) => p.id.startsWith(HOME_PREFIX);
const isEditorGroup = (g: DockviewGroupPanel) => g.panels.some((p) => isEditorPanel(p) || isHome(p));
const isShown = (g: DockviewGroupPanel) => g.api.isVisible && g.element.getBoundingClientRect().width > 0;
/** Tell the activity bar (and anyone else) that what is on screen changed. */
const announce = () => window.dispatchEvent(new Event("fahh-dock-active"));

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
  // While tabs are being restored the dock still shows the previous workspace: saving now would overwrite this one.
  if (!api || restoring) return;
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

let loadSeq = 0;
let restoring = false;

/**
 * Open the layout saved for this workspace, or the default when there is none (or it is unreadable).
 * With a folder open and "Restore session" on, its editor tabs come back into their groups,
 * each one only when its file can still be read; the others become Welcome placeholders.
 */
export function loadLayout(forRoot: string | null, keepIfNone = false): void {
  if (!api) return;
  root = forRoot;
  const seq = ++loadSeq;
  restoring = false;
  const raw = store()?.getItem(layoutKey(forRoot));
  const saved = decodeLayout(raw);
  if (raw && !saved) console.warn("saved layout unreadable, using the default");
  if (!saved) {
    if (keepIfNone && api.panels.length) return saveLayoutNow();
    return buildDefault();
  }
  const paths = forRoot !== null && useSettingsStore.getState().restoreSession ? savedEditorPaths(saved.dock) : [];
  if (!paths.length) return applySaved(saved, new Set());
  restoring = true;
  void Promise.all(
    paths.map((p) => readFile(p).then((c) => [p, isPreviewOnly(p) ? "" : c] as const, () => null))
  ).then((read) => {
    if (seq !== loadSeq || !api) return; // another folder was opened meanwhile (it owns `restoring` now)
    restoring = false;
    const found = read.filter((r): r is readonly [string, string] => r !== null);
    const st = useEditorStore.getState();
    const fresh = found.filter(([p]) => !st.openTabs.some((t) => t.path === p));
    const activeId = activeEditorOf(saved.dock);
    const active = found.find(([p]) => EDITOR_PREFIX + p === activeId)?.[0] ?? found[0]?.[0] ?? st.activeTab;
    // One store update, held back from the dock until the saved layout is in.
    mutating++;
    useEditorStore.setState({
      openTabs: [...st.openTabs, ...fresh.map(([p]) => ({ path: p, language: isPreviewOnly(p) ? "image" : languageFor(p), dirty: false }))],
      fileContents: { ...st.fileContents, ...Object.fromEntries(fresh) },
      activeTab: active,
    });
    mutating--;
    pending = false;
    applySaved(saved, new Set(found.map(([p]) => p)));
  });
}

/** The editor panel on screen in the saved active group. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function activeEditorOf(dock: any): string | undefined {
  let found: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (n: any) => {
    if (!n) return;
    if (Array.isArray(n.data)) return n.data.forEach(walk);
    if (n.data?.id === dock.activeGroup) found = n.data.activeView;
  };
  walk(dock.grid?.root);
  return found;
}

function applySaved(saved: SavedLayout, files: Set<string>): void {
  if (!api) return;
  try {
    api.fromJSON(editorsToHome(saved.dock, (p) => files.has(p)));
    hidden = saved.extras.hidden;
    for (const p of [...api.panels]) if (p.id.startsWith(VIEW_PREFIX) && !getView(p.id.slice(VIEW_PREFIX.length))) api.removePanel(p);
    for (const ids of Object.values(hidden)) for (const id of ids) api.getGroup(id)?.api.setVisible(false);
    if (!api.panels.length) throw new Error("empty layout");
    syncEditors();
  } catch (e) {
    console.warn("saved layout unusable, using the default:", e);
    buildDefault();
  }
  announce();
}

/** View > Reset Layout. */
export function resetLayout(): void {
  buildDefault();
  saveLayoutNow();
}

function buildDefault(): void {
  if (!api) return;
  hidden = {};
  api.clear();
  const sizes = legacySizes(store()); // the pre-dock bar sizes carry over into the first layout
  api.addPanel({ id: `${HOME_PREFIX}1`, component: "home", tabComponent: "home", title: "Welcome" });
  // Views that live in the editor area (Settings) open on demand, not in the default layout.
  for (const loc of ["sidebar", "secondary", "panel"] as const) {
    for (const v of listViews().filter((d) => d.defaultLocation === loc)) addView(v, sizes);
  }
  for (const id of ["explorer", "terminal", "agent"]) api.getPanel(VIEW_PREFIX + id)?.api.setActive();
  // initialWidth / initialHeight lose to the proportional split: set the bars' sizes outright.
  for (const [id, zone] of [["explorer", "primary"], ["agent", "secondary"], ["terminal", "panel"]] as const) {
    const g = api.getPanel(VIEW_PREFIX + id)?.group;
    if (g) setBarSize(g, zone, sizes);
  }
  syncEditors();
  announce();
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
  if (isEditorGroup(g)) return "editor";
  if (g.panels.some((p) => p.id === VIEW_PREFIX + "terminal")) return "panel"; // Ctrl+` follows Terminal wherever it is docked
  return zoneFor(g.element.getBoundingClientRect(), editorsRect());
}
const groupsIn = (zone: Zone) => (api?.groups ?? []).filter((g) => isShown(g) && zoneOfGroup(g) === zone);

function setBarSize(g: DockviewGroupPanel, zone: Zone, sizes = legacySizes(store())): void {
  if (zone === "primary") g.api.setSize({ width: sizes.sidebar });
  else if (zone === "secondary") g.api.setSize({ width: SECONDARY_W });
  else if (zone === "panel") g.api.setSize({ height: sizes.bottom });
}

/** A new, empty group at the edge where `zone` lives. */
function newGroupIn(zone: Zone): DockviewGroupPanel | undefined {
  if (!api) return;
  if (zone === "primary") return api.addGroup({ direction: "left" });
  if (zone === "secondary") return api.addGroup({ direction: "right" });
  const ed = targetEditorGroup();
  if (zone === "panel") return ed ? api.addGroup({ referenceGroup: ed, direction: "below" }) : api.addGroup({ direction: "below" });
  return ed ?? api.addGroup({ direction: "right" });
}

function addView(def: ViewDef, sizes = legacySizes(store())): IDockviewPanel | undefined {
  if (!api) return;
  const zone = ZONE_OF[def.defaultLocation];
  // "always": a hidden tab keeps its DOM, so the terminal, the agent chat and the tree keep their state.
  const base = { id: VIEW_PREFIX + def.id, component: "view", tabComponent: "view", title: def.title, params: { viewId: def.id }, renderer: "always" as const };
  const hiddenId = hidden[zone]?.find((id) => api!.getGroup(id));
  const into = hiddenId ? api.groups.find((g) => g.id === hiddenId) : zone === "editor" ? targetEditorGroup() : groupsIn(zone)[0];
  if (into) {
    if (hiddenId) showZone(zone);
    return api.addPanel({ ...base, position: { referenceGroup: into } });
  }
  const anyEditor = api.groups.find(isEditorGroup);
  if (zone === "primary") return api.addPanel({ ...base, initialWidth: sizes.sidebar, position: { direction: "left" } });
  if (zone === "secondary") return api.addPanel({ ...base, initialWidth: SECONDARY_W, position: { direction: "right" } });
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
    for (const [id, z] of sizeBeforeHide) {
      const g = api?.groups.find((x) => x.id === id);
      if (g && isShown(g) && !was.has(id)) put(g, z.zone, z.width, z.height);
    }
  }
}

/** Show a view: add it where it belongs if it was closed, un-hide its bar, bring it to the front. */
export function revealView(id: string): void {
  ensureEditorMode();
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
  if (fresh && fresh.group.panels.length === 1) setBarSize(fresh.group, ZONE_OF[def.defaultLocation]);
  scheduleSave();
  announce();
}

const isOnScreen = (id: string) => {
  const p = api?.getPanel(VIEW_PREFIX + id);
  return !!p && p.api.isVisible && isShown(p.group);
};

/** Activity bar and Ctrl+L: show the view, or hide its bar when it is already on screen. */
export function toggleView(id: string): void {
  ensureEditorMode();
  const p = api?.getPanel(VIEW_PREFIX + id);
  if (p && isOnScreen(id)) {
    const zone = zoneOfGroup(p.group);
    if (zone !== "editor") return toggleZone(zone);
  }
  revealView(id);
}

/** Ids of the views on screen right now (for the activity bar highlight). */
export const visibleViewIds = (): string[] =>
  listViews()
    .map((v) => v.id)
    .filter(isOnScreen);

/**
 * The keyboard path for drag and drop: "View: Move Explorer to Right Side Bar".
 * Joins the first group already in that zone, or opens a new bar there.
 */
export function moveView(id: string, zone: Zone): void {
  const def = getView(id);
  if (!api || !def) return;
  let panel = api.getPanel(VIEW_PREFIX + id) ?? addView(def);
  if (!panel) return;
  showZone(zone);
  keepBarSizes(() => {
    if (!api || !panel) return;
    const from = panel.group;
    const into = zone === "editor" ? targetEditorGroup() : groupsIn(zone).find((g) => g !== from);
    if (into && into !== from) {
      panel.api.moveTo({ group: into });
    } else if (!into && !(zoneOfGroup(from) === zone && from.panels.length === 1)) {
      const g = newGroupIn(zone);
      if (!g) return;
      panel.api.moveTo({ group: g });
      setBarSize(g, zone);
    }
  });
  panel = api.getPanel(VIEW_PREFIX + id);
  panel?.api.setActive();
  scheduleSave();
  announce();
}

// ─── Side bars and the panel ─────────────────────────────────────────────────

function showZone(zone: Zone): void {
  for (const id of hidden[zone] ?? []) api?.getGroup(id)?.api.setVisible(true);
  hidden[zone] = [];
}

/** Ctrl+B (primary), Ctrl+Alt+B (secondary), Ctrl+` (panel). */
export function toggleZone(zone: Zone): void {
  if (!api || zone === "editor") return;
  keepBarSizes(() => toggleZoneNow(zone));
  scheduleSave();
  announce();
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
    // Nothing there yet: open the view that usually lives there.
    const loc = zone === "primary" ? "sidebar" : zone === "secondary" ? "secondary" : "panel";
    const v = zone === "panel" ? getView("terminal") : listViews().find((d) => d.defaultLocation === loc);
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

/**
 * Close editor tabs together. A file whose last tab is among them closes for good, after one
 * question about the unsaved ones (Save / Don't Save / Cancel); a split copy just goes.
 * False when the user cancelled.
 */
export async function closeEditorPanels(panels: IDockviewPanel[]): Promise<boolean> {
  if (!api) return false;
  const closing = new Set(panels.filter(isEditorPanel));
  const paths = [...new Set([...closing].map(pathOf).filter((p): p is string => !!p))];
  const last = paths.filter((p) => panelsFor(p).every((x) => closing.has(x)));
  if (!(await confirmClose(last))) return false;
  for (const p of closing) {
    const path = pathOf(p);
    if (path && !last.includes(path) && api.getPanel(p.id)) p.api.close();
  }
  rememberClosed(last);
  for (const p of last) forceClose(p); // the store drops the tabs and syncEditors removes the panels
  syncEditors();
  return true;
}

/** Close one editor tab (only that split when the file is open twice). */
export const closeEditorPanel = (panel: IDockviewPanel) => closeEditorPanels([panel]);

/** Ctrl+W: the active editor tab. */
export function closeActiveEditor(): Promise<boolean> {
  const p = api?.activePanel;
  if (p && isEditorPanel(p)) return closeEditorPanel(p);
  const tab = useEditorStore.getState().activeTab;
  const mine = tab ? panelsFor(tab) : [];
  return mine.length ? closeEditorPanel(mine[0]) : Promise.resolve(false);
}

/** Every editor in a group (the group's close button, and Close All on a tab). */
export const closeEditorGroup = (group: DockviewGroupPanel) => closeEditorPanels(group.panels);

/** Tab menu: Close Others (in the same group). */
export const closeOtherEditors = (panel: IDockviewPanel) => closeEditorPanels(panel.group.panels.filter((p) => p !== panel));

/** Tab menu: Close to the Right (in the same group, by tab order). */
export function closeEditorsToRight(panel: IDockviewPanel): Promise<boolean> {
  const ps = panel.group.panels;
  return closeEditorPanels(ps.slice(ps.indexOf(panel) + 1));
}

/** File > Close All Tabs and Ctrl+K Ctrl+W: every editor in every group. */
export const closeAllEditors = () => closeEditorPanels(api?.panels ?? []);

/** Make this file's tab the active one (its tab in the current group when it has one there). */
export function activateFile(path: string): boolean {
  const mine = panelsFor(path);
  if (!mine.length) return false;
  (mine.find((p) => p.group === api?.activeGroup) ?? mine[0]).api.setActive();
  return true;
}

/** Ctrl+\ : the active editor again in a new group beside it (same file, same model). */
export function splitActiveEditor(direction: "right" | "below" = "right"): void {
  if (!api) return;
  let p = api.activePanel;
  if (!p || !isEditorPanel(p)) {
    const tab = useEditorStore.getState().activeTab;
    p = tab ? panelsFor(tab)[0] : undefined;
  }
  const path = p ? pathOf(p) : undefined;
  if (!p || !path) return;
  let n = 2;
  while (api.getPanel(`${EDITOR_PREFIX}${path}#${n}`)) n++;
  api.addPanel({ ...editorPanelOptions(path, `${EDITOR_PREFIX}${path}#${n}`), position: { referenceGroup: p.group, direction } }).api.setActive();
}
