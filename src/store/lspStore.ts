import { create } from "zustand";

/** Where each language server stands, for the status bar (VS Code's language status item). */
export type LspState = "starting" | "ready" | "failed";

export interface LspStatus {
  state: LspState;
  /** Why it failed, or the server's name when it is up. */
  detail?: string;
}

interface LspStore {
  servers: Record<string, LspStatus>;
  set: (language: string, state: LspState, detail?: string) => void;
}

export const useLspStore = create<LspStore>((set) => ({
  servers: {},
  set: (language, state, detail) =>
    set((s) => ({ servers: { ...s.servers, [language]: { state, detail } } })),
}));
