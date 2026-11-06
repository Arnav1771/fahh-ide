/**
 * Keep the Explorer and the open tabs in step with the disk. The backend watches this
 * window's folder (core/watch.rs) and sends batched `fs://changed` events; only the folders
 * that changed are re-read and spliced into the tree, so expanded folders and the selection
 * stay as they were. Open tabs follow too: a file deleted on disk is marked deleted, a clean
 * tab reloads, and a tab with unsaved edits asks first.
 */
import { listen } from "@tauri-apps/api/event";
import { getFileTree, readFile, unwatchWorkspace, watchWorkspace } from "./tauri";
import { parentDir } from "./openRequest";
import { isUnder } from "./tabs";
import { isPreviewOnly } from "./preview";
import { FILE_SAVED_EVENT } from "./tabActions";
import type { FileEntry } from "./types";
import { useFileStore } from "../store/fileStore";
import { useGitStore } from "../store/gitStore";
import { useEditorStore } from "../store/editorStore";
import { useDialogStore } from "../store/dialogStore";

/** One batch from core/watch.rs: `structure` = created, removed or renamed paths; `content` = files written in place. */
export interface FsChanges {
  root: string;
  structure: string[];
  content: string[];
}

/** The folders to re-read for these changed paths: each path's parent, minus folders inside another one on the list. */
export function affectedDirs(root: string, paths: string[]): string[] {
  const dirs = new Set<string>();
  for (const p of paths) if (p !== root && isUnder(p, root)) dirs.add(parentDir(p));
  const list = [...dirs];
  return list.filter((d) => !list.some((o) => o !== d && isUnder(d, o)));
}

/**
 * `tree` with the folder at `sub.path` replaced by `sub`. Untouched branches keep their
 * identity (React re-renders only the changed folder); null when the folder is not in the tree.
 */
export function spliceTree(tree: FileEntry, sub: FileEntry): FileEntry | null {
  if (tree.path === sub.path) return sub;
  if (!tree.children || !isUnder(sub.path, tree.path)) return null;
  for (let i = 0; i < tree.children.length; i++) {
    const next = spliceTree(tree.children[i], sub);
    if (next) {
      const children = tree.children.slice();
      children[i] = next;
      return { ...tree, children };
    }
  }
  return null;
}

/** Re-read each folder (or its nearest surviving parent) and splice it into the tree. */
async function refreshDirs(root: string, dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    let d = dir;
    let sub: FileEntry | null = null;
    while (!sub) {
      try {
        sub = await getFileTree(d);
      } catch {
        const up = parentDir(d);
        if (d === root || up === d || !isUnder(up, root)) return; // the folder itself is gone: nothing to show
        d = up;
      }
    }
    const s = useFileStore.getState();
    if (s.root !== root || !s.tree) return; // another folder opened meanwhile
    const next = spliceTree(s.tree, sub);
    if (next) s.setTree(next);
  }
}

/** The text each open file last had on disk as far as this window knows (opened, saved or reloaded). */
const known = new Map<string, string>();
export const rememberDiskText = (path: string, text: string) => void known.set(path, text);
const asking = new Set<string>();

async function askReload(path: string): Promise<void> {
  const name = path.split(/[\\/]/).pop() ?? path;
  const r = await useDialogStore.getState().open({
    title: `${name} changed on disk`,
    message: "This tab has unsaved changes. Reload the file and lose them, or keep your version (saving it will overwrite the file).",
    buttons: [
      { label: "Reload from disk", value: "reload", primary: true },
      { label: "Keep my changes", value: "keep" },
    ],
  });
  if (r.button !== "reload") return;
  try {
    const disk = await readFile(path);
    known.set(path, disk);
    useEditorStore.getState().markDirty(path, false); // clean first, so the editor takes the new text as its baseline
    useEditorStore.getState().setContent(path, disk);
  } catch {
    useEditorStore.getState().markDeleted(path, true);
  }
}

/** Open tabs under the changed paths: mark deleted, reload when clean, ask when edited. */
async function syncTabs(paths: string[]): Promise<void> {
  const hit = useEditorStore.getState().openTabs.filter((t) => !isPreviewOnly(t.path) && paths.some((p) => isUnder(t.path, p)));
  for (const { path } of hit) {
    let disk: string | null = null;
    try {
      disk = await readFile(path);
    } catch {
      disk = null;
    }
    const ed = useEditorStore.getState();
    const tab = ed.openTabs.find((t) => t.path === path);
    if (!tab) continue;
    if (disk === null) {
      if (!tab.deleted) ed.markDeleted(path, true);
      continue;
    }
    if (tab.deleted) ed.markDeleted(path, false);
    if (disk === ed.fileContents[path] || disk === known.get(path)) continue; // nothing new (or our own save)
    known.set(path, disk);
    if (!tab.dirty) ed.setContent(path, disk);
    else if (!asking.has(path)) {
      asking.add(path);
      void askReload(path).finally(() => asking.delete(path));
    }
  }
}

async function apply(c: FsChanges): Promise<void> {
  const root = useFileStore.getState().root;
  if (!root || c.root !== root) return; // an event for a folder this window no longer shows
  if (c.structure.length) await refreshDirs(root, affectedDirs(root, c.structure));
  if (useGitStore.getState().root === root) void useGitStore.getState().refresh();
  await syncTabs([...c.structure, ...c.content]);
}

let started = false;
let queue: Promise<void> = Promise.resolve();

/** Once per window: follow the open folder, and apply its changes in order. */
export function initFsWatch(): void {
  if (started) return;
  started = true;
  void listen<FsChanges>("fs://changed", (e) => {
    queue = queue.then(() => apply(e.payload)).catch(() => {});
  }).catch(() => {});
  window.addEventListener(FILE_SAVED_EVENT, (e) => {
    const path = (e as CustomEvent<{ path: string }>).detail?.path;
    const text = path ? useEditorStore.getState().fileContents[path] : undefined;
    if (path && text !== undefined) known.set(path, text);
  });
  let watched: string | null = null;
  const follow = (root: string | null) => {
    if (root === watched) return;
    watched = root;
    // A folder that cannot be watched still refreshes by hand (the Explorer's Refresh button).
    void (root ? watchWorkspace(root) : unwatchWorkspace()).catch(() => {});
  };
  follow(useFileStore.getState().root);
  useFileStore.subscribe((s) => follow(s.root));
}
