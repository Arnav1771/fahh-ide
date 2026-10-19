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

/** Close a tab, asking first when it holds unsaved changes. True when it closed. */
export function requestClose(path: string): boolean {
  const tab = useEditorStore.getState().openTabs.find((t) => t.path === path);
  if (tab?.dirty && !window.confirm(`"${nameOf(path)}" has unsaved changes. Close it and discard them?`)) return false;
  forceClose(path);
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
