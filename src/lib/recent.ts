/**
 * File > Open Recent: the folders and workspace files opened lately, newest first.
 * Kept in localStorage like the rest of the settings (the Rust config only holds tool state).
 */
export interface RecentEntry {
  path: string;
  kind: "folder" | "workspace";
}

export const RECENT_KEY = "fahh-recent";
export const RECENT_MAX = 10;

const changed = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("fahh-recent-change"));
};
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const defaultStore = (): Store | undefined => (typeof localStorage === "undefined" ? undefined : localStorage);

/** Read the list; anything damaged or unexpected is dropped. */
export function loadRecent(store: Store | undefined = defaultStore()): RecentEntry[] {
  try {
    const v = JSON.parse(store?.getItem(RECENT_KEY) ?? "[]");
    if (!Array.isArray(v)) return [];
    return v
      .filter((e) => e && typeof e.path === "string" && e.path && (e.kind === "folder" || e.kind === "workspace"))
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

/** The list with `entry` at the top (moved there when it was already listed), at most RECENT_MAX long. */
export function withRecent(list: RecentEntry[], entry: RecentEntry): RecentEntry[] {
  return [entry, ...list.filter((e) => e.path !== entry.path)].slice(0, RECENT_MAX);
}

export function addRecent(entry: RecentEntry, store: Store | undefined = defaultStore()): RecentEntry[] {
  const next = withRecent(loadRecent(store), entry);
  try {
    store?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage blocked: the list just does not persist
  }
  changed();
  return next;
}

export function clearRecent(store: Store | undefined = defaultStore()): void {
  try {
    store?.removeItem(RECENT_KEY);
  } catch {
    // ignore
  }
  changed();
}
