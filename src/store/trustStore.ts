import { create } from "zustand";
import { workspaceTrustGet, workspaceTrustSet } from "../lib/tauri";
import { chooseDialog } from "./dialogStore";

/**
 * Workspace trust for the open folder. Until the folder is trusted Fahh runs none of its
 * code: no language servers (the backend refuses them too), no probing of its .venv, no
 * tasks. Editing, search, git and the terminal work as usual ("Restricted mode").
 */
interface TrustStore {
  root: string | null;
  /** null: not answered yet for this folder. */
  trusted: boolean | null;
  load: (root: string | null) => Promise<void>;
  set: (trusted: boolean) => Promise<void>;
  /** Ask (once per folder) and resolve with the answer. */
  ask: () => Promise<boolean>;
}

export const TRUST_QUESTION = {
  title: "Do you trust the authors of the files in this folder?",
  message:
    "Fahh can run code from this folder: language servers (which run build scripts and plugins), its Python environments, and its tasks. " +
    "Trust it only if you know where it came from. In Restricted mode you can still read, edit, search and use git and the terminal.",
  buttons: [
    { label: "Trust folder", value: "trust", primary: true },
    { label: "Restricted mode", value: "restricted" },
  ],
};

export const useTrustStore = create<TrustStore>((set, get) => ({
  root: null,
  trusted: null,
  load: async (root) => {
    set({ root, trusted: null });
    if (!root) return;
    const t = await workspaceTrustGet(root).catch(() => null);
    if (get().root === root) set({ trusted: t ?? null });
  },
  set: async (trusted) => {
    const root = get().root;
    if (!root) return;
    await workspaceTrustSet(root, trusted);
    if (get().root === root) set({ trusted });
  },
  ask: async () => {
    const answer = await chooseDialog(TRUST_QUESTION);
    // Dismissed: Restricted for now, asked again next time the folder opens.
    if (answer === null) return false;
    await get().set(answer === "trust");
    return answer === "trust";
  },
}));

/** True when this folder's code may run (asks first if nobody answered yet). */
export async function ensureTrusted(): Promise<boolean> {
  const s = useTrustStore.getState();
  if (!s.root) return true;
  if (s.trusted !== null) return s.trusted;
  return s.ask();
}
