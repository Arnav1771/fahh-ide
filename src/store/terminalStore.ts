import { create } from "zustand";
import { kill } from "../lib/ptySessions";

/** One terminal tab: a shell on a pseudo-terminal (see lib/ptySessions). */
export interface TerminalSession {
  id: string;
  title: string;
  /** Profile id (PowerShell, cmd, Git Bash, WSL, bash…); "" uses the default profile. */
  profile: string;
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

  createSession: (profile?: string, title?: string) => string;
  closeSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  splitTerminal: (profile?: string) => string;
  setSplitLayout: (layout: TerminalSplitLayout) => void;
  closeSplitPane: (id: string) => void;
  setCwd: (cwd: string) => void;
}

let counter = 0;
const newSession = (profile = "", title?: string): TerminalSession => {
  counter += 1;
  return { id: `term-${Date.now()}-${counter}`, title: title ?? (profile || "terminal"), profile };
};

const first = newSession();

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  sessions: [first],
  activeSessionId: first.id,
  splitSessionIds: [first.id],
  isSplitView: false,
  splitLayout: "horizontal",
  cwd: "",

  createSession: (profile, title) => {
    const s = newSession(profile, title);
    set((st) => ({ sessions: [...st.sessions, s], activeSessionId: s.id }));
    return s.id;
  },

  splitTerminal: (profile) => {
    const { activeSessionId, splitSessionIds, isSplitView } = get();
    const id = get().createSession(profile);
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
    let sessions = st.sessions.filter((s) => s.id !== id);
    // The panel always has a terminal: closing the last one starts a fresh shell.
    if (sessions.length === 0) sessions = [newSession()];
    const activeSessionId = sessions.some((s) => s.id === st.activeSessionId) ? st.activeSessionId : sessions[sessions.length - 1].id;
    const split = st.splitSessionIds.filter((s) => s !== id && sessions.some((x) => x.id === s));
    set({
      sessions,
      activeSessionId,
      splitSessionIds: split.length ? split : [activeSessionId],
      isSplitView: st.isSplitView && split.length > 1,
    });
  },

  setActiveSession: (id) => {
    if (get().sessions.some((s) => s.id === id)) set({ activeSessionId: id });
  },

  renameSession: (id, title) => set((st) => ({ sessions: st.sessions.map((s) => (s.id === id ? { ...s, title } : s)) })),

  setCwd: (cwd) => set({ cwd }),
}));
