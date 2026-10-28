/**
 * Keep the Explorer in step with the disk: the backend watches the open folder
 * (core/watch.rs) and reports changes made outside the Explorer; the tree is re-read,
 * at most every 300 ms.
 */
import { listen } from "@tauri-apps/api/event";
import { getFileTree, watchWorkspace } from "./tauri";
import { useFileStore } from "../store/fileStore";

let timer: number | undefined;
let started = false;

export function refreshTreeSoon(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const root = useFileStore.getState().root;
    if (!root) return;
    void getFileTree(root)
      .then((tree) => {
        // A different folder may have opened meanwhile.
        if (useFileStore.getState().root === root) useFileStore.getState().setTree(tree);
      })
      .catch(() => {});
  }, 300);
}

/** Once per app: follow the open folder, and refresh on changes. */
export function initFsWatch(): void {
  if (started) return;
  started = true;
  void listen<string[]>("fs://changed", () => refreshTreeSoon()).catch(() => {});
  let watched: string | null = null;
  const follow = (root: string | null) => {
    if (!root || root === watched) return;
    watched = root;
    void watchWorkspace(root).catch(() => {}); // e.g. a folder that cannot be watched: refresh still works by hand
  };
  follow(useFileStore.getState().root);
  useFileStore.subscribe((s) => follow(s.root));
}
