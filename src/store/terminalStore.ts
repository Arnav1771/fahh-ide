import { create } from "zustand";
import { kill } from "../lib/ptySessions";

/** One terminal tab: a shell on a pseudo-terminal (see lib/ptySessions). */
export interface TerminalSession {
  id: string;
  title: string;
  /** Profile id (PowerShell, cmd, Git Bash, WSL, bash…); "" uses the default profile. */
  profile: string;
  /** Folder to start in; unset: the open workspace. */
  cwd?: string;
}

export type TerminalSplitLayout = "horizontal" | "vertical";

interface TerminalStore {
  sessions: TerminalSession[];
  activeSessionId: string;
  splitSessionIds: string[];
  isSplitView: boolean;
  splitLayout: TerminalSplitLayout;
  /** Folder new terminals start in (the open workspace). */
  cwd: string;

  createSession: (profile?: string, title?: string, cwd?: string) => string;
  closeSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  splitTerminal: (profile?: string) => string;
  setSplitLayout: (layout: TerminalSplitLayout) => void;
  closeSplitPane: (id: string) => void;
  setCwd: (cwd: string) => void;
}

let counter = 0;
const newSession = (profile = "", title?: string, cwd?: string): TerminalSession => {
  counter += 1;
  return { id: `term-${Date.now()}-${counter}`, title: title ?? (profile || "terminal"), profile, ...(cwd ? { cwd } : {}) };
};

const first = newSession();

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  sessions: [first],
  activeSessionId: first.id,
  splitSessionIds: [first.id],
  isSplitView: false,
  splitLayout: "horizontal",
  cwd: "",

  createSession: (profile, title, cwd) => {
    const s = newSession(profile, title, cwd);
    // A new terminal shows on its own (VS Code does the same); splitTerminal() splits it back in.
    set((st) => ({ sessions: [...st.sessions, s], activeSessionId: s.id, isSplitView: false, splitSessionIds: [s.id] }));
    return s.id;
  },

  splitTerminal: (profile) => {
    const { activeSessionId, splitSessionIds, isSplitView, sessions } = get();
    const id = get().createSession(profile);
    if (!sessions.some((s) => s.id === activeSessionId)) return id; // nothing to split beside
    set({
      isSplitView: true,
      splitSessionIds: isSplitView && splitSessionIds.includes(activeSessionId) ? [...splitSessionIds, id] : [activeSessionId, id],
    });
    return id;
  },

  setSplitLayout: (splitLayout) => set({ splitLayout }),

  closeSplitPane: (id) => get().closeSession(id),

  closeSession: (id) => {
    kill(id);
    const st = get();
    const sessions = st.sessions.filter((s) => s.id !== id);
    // Closing the last one leaves the panel empty with "New Terminal" (VS Code). It used to start
    // a fresh shell at once, so Kill looked like it did nothing.
    const split = st.splitSessionIds.filter((s) => s !== id && sessions.some((x) => x.id === s));
    const activeSessionId = sessions.some((s) => s.id === st.activeSessionId)
      ? st.activeSessionId
      : (split[split.length - 1] ?? sessions[sessions.length - 1]?.id ?? "");
    set({
      sessions,
      activeSessionId,
      splitSessionIds: split.length ? split : activeSessionId ? [activeSessionId] : [],
      isSplitView: st.isSplitView && split.length > 1,
    });
  },

  setActiveSession: (id) => {
    if (get().sessions.some((s) => s.id === id)) set({ activeSessionId: id });
  },

  renameSession: (id, title) => set((st) => ({ sessions: st.sessions.map((s) => (s.id === id ? { ...s, title } : s)) })),

  setCwd: (cwd) => set({ cwd }),
}));
