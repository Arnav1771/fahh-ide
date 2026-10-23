/**
 * Everything that closes, renames or saves an open file. One place, so the tab
 * bar, the explorer, Ctrl+S and the window close all agree on what "unsaved"
 * means and never drop work silently.
 */
import { useEditorStore } from "../store/editorStore";
import { useToastStore } from "../store/toastStore";
import { writeFile } from "./tauri";
import { clearBaseline, setBaseline } from "./saveBaseline";
import { disposeModel, getActiveVersionId } from "./monacoBridge";
import { isUnder } from "./tabs";
import { isPreviewOnly } from "./preview";
import { chooseDialog } from "../store/dialogStore";

const nameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function dirtyPaths(root?: string): string[] {
  return useEditorStore
    .getState()
    .openTabs.filter((t) => t.dirty && (!root || isUnder(t.path, root)))
    .map((t) => t.path);
}

/** Close a tab with no questions asked. */
export function forceClose(path: string): void {
  useEditorStore.getState().closeFile(path);
  clearBaseline(path);
  disposeModel(path);
}

/** A tab that only lives in memory (New File) has no folder in its path and nowhere to save to. */
const isUntitled = (p: string) => !/[\\/]/.test(p);

/** Write one open file to disk (the one on screen goes through saveActive, which tracks undo versions). */
export async function savePath(path: string): Promise<boolean> {
  const { activeTab, fileContents, markDirty } = useEditorStore.getState();
  if (path === activeTab) return saveActive(true);
  try {
    await writeFile(path, fileContents[path] ?? "");
    markDirty(path, false);
    return true;
  } catch (err) {
    useToastStore.getState().show(`Could not save ${nameOf(path)}: ${String(err)}`, "error");
    return false;
  }
}

/**
 * About to close these files: ask about the unsaved ones (Save, Don't Save, Cancel).
 * True when they may close; false when the user cancelled or a save failed.
 */
export async function confirmClose(paths: string[]): Promise<boolean> {
  const tabs = useEditorStore.getState().openTabs;
  const dirty = [...new Set(paths)].filter((p) => tabs.find((t) => t.path === p)?.dirty);
  if (dirty.length === 0) return true;
  const one = dirty.length === 1;
  const canSave = dirty.every((p) => !isUntitled(p) && !isPreviewOnly(p));
  const names = dirty.slice(0, 5).map(nameOf).join(", ") + (dirty.length > 5 ? ` and ${dirty.length - 5} more` : "");
  const r = await chooseDialog({
    title: one ? `Save changes to ${nameOf(dirty[0])}?` : `Save changes to ${dirty.length} files?`,
    message: `${one ? "" : names + "\n\n"}Your changes will be lost if you don't save them.`,
    buttons: [
      ...(canSave ? [{ label: one ? "Save" : "Save All", value: "save", primary: true }] : []),
      { label: "Don't Save", value: "discard", danger: true },
      { label: "Cancel", value: "cancel" },
    ],
  });
  if (r === "save") {
    for (const p of dirty) if (!(await savePath(p))) return false;
    return true;
  }
  return r === "discard";
}

// ─── Recently closed (Ctrl+Shift+T) ──────────────────────────────────────────

const closed: string[] = [];

/** Files the user closed, newest last (untitled buffers have nothing to reopen). */
export function rememberClosed(paths: string[]): void {
  for (const p of paths) {
    if (isUntitled(p)) continue;
    const i = closed.indexOf(p);
    if (i >= 0) closed.splice(i, 1);
    closed.push(p);
  }
  if (closed.length > 50) closed.splice(0, closed.length - 50);
}

/** The most recently closed file that is not open again already; removed from the stack. */
export function takeClosed(): string | undefined {
  const open = new Set(useEditorStore.getState().openTabs.map((t) => t.path));
  while (closed.length) {
    const p = closed.pop()!;
    if (!open.has(p)) return p;
  }
  return undefined;
}

/** Close a tab, asking first when it holds unsaved changes. True when it closed. */
export async function requestClose(path: string): Promise<boolean> {
  return requestCloseMany([path]);
}

/** Close several tabs with one question about the unsaved ones. True when they closed. */
export async function requestCloseMany(paths: string[]): Promise<boolean> {
  if (!(await confirmClose(paths))) return false;
  rememberClosed(paths);
  for (const p of paths) forceClose(p);
  return true;
}

/** A file or folder was deleted on disk: its tabs go too. */
export function closeTabsUnder(root: string): void {
  for (const t of useEditorStore.getState().openTabs) if (isUnder(t.path, root)) forceClose(t.path);
}

/** A file or folder was renamed on disk: its tabs follow. */
export function renameTabs(from: string, to: string): void {
  const old = useEditorStore.getState().openTabs.filter((t) => isUnder(t.path, from)).map((t) => t.path);
  useEditorStore.getState().renamePath(from, to);
  for (const p of old) {
    clearBaseline(p); // the model under the new path starts its own baseline
    disposeModel(p);
  }
}

/** The text for the "close the window?" question; null when nothing is unsaved. */
export function unsavedMessage(): string | null {
  const d = dirtyPaths();
  if (d.length === 0) return null;
  const names = d.slice(0, 5).map(nameOf).join(", ") + (d.length > 5 ? ` and ${d.length - 5} more` : "");
  return `You have unsaved changes in ${names}. Close anyway and lose them?`;
}

/** Save the file on screen, from wherever the keyboard focus is. */
export async function saveActive(silent = false): Promise<boolean> {
  const { activeTab, fileContents, markDirty } = useEditorStore.getState();
  if (!activeTab || isPreviewOnly(activeTab)) return false;
  const name = nameOf(activeTab);
  try {
    const v = getActiveVersionId(); // the text being written, not whatever is typed meanwhile
    await writeFile(activeTab, fileContents[activeTab] ?? "");
    if (v !== null) setBaseline(activeTab, v);
    if (v === null || v === getActiveVersionId()) markDirty(activeTab, false);
    if (!silent) {
      useToastStore.getState().show(`Saved ${name}`);
    }
    return true;
  } catch (err) {
    if (!silent) {
      useToastStore.getState().show(`Could not save ${name}: ${String(err)}`, "error");
    }
    return false;
  }
}
