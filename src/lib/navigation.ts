/**
 * Getting around open files: Ctrl+Tab in most-recently-used order, Alt+Left / Alt+Right
 * through where you have been, Ctrl+Shift+T for the last closed tab, and one way to
 * "open this file at this line" for search results, Problems and history.
 */
import { useEditorStore } from "../store/editorStore";
import { ensureEditorMode } from "../store/layoutModeStore";
import { useToastStore } from "../store/toastStore";
import { NavHistory, cycleIndex, touchMru, type Loc } from "./history";
import { getActiveDocument, revealLine } from "./monacoBridge";
import { activateFile } from "./workbench";
import { takeClosed } from "./tabActions";
import { openFilePath } from "../hooks/useWorkspace";
import { readFile } from "./tauri";

const nav = new NavHistory();
let mru: string[] = [];
let cycle: { list: string[]; i: number } | null = null;
/** Set while history itself is moving the editor, so the move is not recorded as a new step. */
let navigating = false;
/** The last cursor seen in each file, so switching back to a tab records where you were in it. */
const lastPos = new Map<string, { line: number; column: number }>();

const announce = () => window.dispatchEvent(new Event("fahh-nav-change"));
const isOpen = (p: string) => useEditorStore.getState().openTabs.some((t) => t.path === p);

/** Call once (App): follows the active tab for the MRU order and the history. */
export function initNavigation(): () => void {
  let last: string | null = null;
  return useEditorStore.subscribe((s) => {
    if (s.activeTab === last) return;
    last = s.activeTab;
    if (!s.activeTab) return;
    if (!cycle) mru = touchMru(mru, s.activeTab);
    if (!navigating) {
      const p = lastPos.get(s.activeTab) ?? { line: 1, column: 1 };
      nav.record({ path: s.activeTab, ...p });
      announce();
    }
  });
}

/** The editor on screen moved its cursor (EditorPane). Long jumps become history steps. */
export function recordCursor(path: string, line: number, column: number): void {
  lastPos.set(path, { line, column });
  if (navigating) return;
  nav.record({ path, line, column });
  announce();
}

export const canGoBack = () => nav.canBack();
export const canGoForward = () => nav.canForward();

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Bring a file to the front: its tab if open, else opened from disk. */
async function show(path: string): Promise<void> {
  if (isOpen(path)) {
    if (!activateFile(path)) useEditorStore.getState().setActiveTab(path);
  } else {
    await openFilePath(path);
  }
}

/** Open (or switch to) a file and put the cursor on a line once its editor is up. */
export async function openAt(path: string, line?: number, column = 1): Promise<void> {
  ensureEditorMode();
  await show(path);
  if (!line) return;
  // The editor mounts (or takes focus) a moment after the tab does: jump once it is the one on screen.
  for (let i = 0; i < 30 && !(getActiveDocument() === path && revealLine(line, column)); i++) await wait(50);
}

async function go(loc: Loc | null): Promise<void> {
  if (!loc) return;
  if (!isOpen(loc.path)) {
    try {
      await readFile(loc.path);
    } catch {
      nav.forget(loc.path); // gone from disk: skip it next time
      useToastStore.getState().show(`${loc.path.split(/[\\/]/).pop()} no longer exists`, "error");
      announce();
      return;
    }
  }
  navigating = true;
  try {
    await openAt(loc.path, loc.line, loc.column);
  } finally {
    navigating = false;
    announce();
  }
}

/** Alt+Left. */
export const goBack = () => go(nav.back());
/** Alt+Right. */
export const goForward = () => go(nav.forward());

/** Ctrl+Tab / Ctrl+Shift+Tab, while Ctrl is held: walk the open tabs in MRU order. */
export function cycleTabs(back: boolean): void {
  const open = useEditorStore.getState().openTabs.map((t) => t.path);
  if (!cycle) {
    const active = useEditorStore.getState().activeTab;
    const list = [...mru.filter((p) => open.includes(p)), ...open.filter((p) => !mru.includes(p))];
    if (active && list[0] !== active) list.unshift(...list.splice(list.indexOf(active), 1));
    cycle = { list, i: 0 };
  }
  if (cycle.list.length < 2) return;
  cycle.i = cycleIndex(cycle.i, cycle.list.length, back);
  void show(cycle.list[cycle.i]);
}

/** Ctrl released: the tab you landed on becomes the most recent. */
export function endCycle(): void {
  if (!cycle) return;
  cycle = null;
  const a = useEditorStore.getState().activeTab;
  if (a) mru = touchMru(mru, a);
}

/** Ctrl+Shift+T: reopen the last closed tab (skipping files that are gone). */
export async function reopenClosedTab(): Promise<void> {
  for (let p = takeClosed(); p; p = takeClosed()) {
    try {
      await readFile(p);
    } catch {
      continue;
    }
    await openFilePath(p);
    return;
  }
  useToastStore.getState().show("No closed tab to reopen");
}
