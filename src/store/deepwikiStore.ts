import { create } from "zustand";
import { readFile, searchWorkspace } from "../lib/tauri";
import { classify, docFor } from "../lib/deepwiki";
import { useFileStore } from "./fileStore";
import type { SearchMatch } from "../lib/types";

interface DeepWikiStore {
  symbol: string | null;
  loading: boolean;
  error: string | null;
  definitions: SearchMatch[];
  usages: SearchMatch[];
  /** Documentation of the first definition (its doc comment or docstring). */
  doc: string;
  /** Symbols looked up, newest first, for back/forward. */
  history: string[];
  lookup: (symbol: string) => Promise<void>;
}

const MAX_RESULTS = 500;

export const useDeepWikiStore = create<DeepWikiStore>((set, get) => ({
  symbol: null,
  loading: false,
  error: null,
  definitions: [],
  usages: [],
  doc: "",
  history: [],

  lookup: async (raw) => {
    const symbol = raw.trim();
    if (!symbol) return;
    const root = useFileStore.getState().root;
    set({ symbol, loading: true, error: null, definitions: [], usages: [], doc: "", history: [symbol, ...get().history.filter((s) => s !== symbol)].slice(0, 20) });
    if (!root) {
      set({ loading: false, error: "Open a folder: DeepWiki searches the workspace." });
      return;
    }
    try {
      const res = await searchWorkspace(root, symbol, { wholeWord: true, caseSensitive: true, maxResults: MAX_RESULTS });
      if (get().symbol !== symbol) return; // a newer lookup started
      const { definitions, usages } = classify(res.matches, symbol);
      let doc = "";
      if (definitions[0]) doc = docFor(await readFile(definitions[0].file).catch(() => ""), definitions[0].line_number);
      if (get().symbol !== symbol) return;
      set({ loading: false, definitions, usages, doc });
    } catch (e) {
      if (get().symbol === symbol) set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));

/** Look a symbol up and show the DeepWiki view (the editor's "See Wiki"). */
export async function seeWiki(symbol: string): Promise<void> {
  const { revealView } = await import("../lib/workbench");
  revealView("deepwiki");
  await useDeepWikiStore.getState().lookup(symbol);
}
