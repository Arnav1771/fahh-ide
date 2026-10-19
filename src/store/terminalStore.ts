import { create } from "zustand";
import { pushHistory } from "../lib/termHistory";
import { detectShell, shellName } from "../lib/shellCwd";

export interface TerminalLine {
  text: string;
  type: "stdout" | "stderr" | "info";
}

export interface TerminalSession {
  id: string;
  title: string;
  shell: string;
  lines: TerminalLine[];
  cwd: string;
  history: string[];
}

const defaultShell = detectShell();
const initialTitle = `1: ${shellName(defaultShell).toLowerCase()}`;

const createInitialSession = (): TerminalSession => ({
  id: "term-1",
  title: initialTitle,
  shell: defaultShell,
  lines: [],
  cwd: "",
  history: [],
});

export type TerminalSplitLayout = "horizontal" | "vertical";

interface TerminalStore {
  sessions: TerminalSession[];
  activeSessionId: string;

  // Split pane support (side-by-side terminal panes like VS Code):
  splitSessionIds: string[];
  isSplitView: boolean;
  splitLayout: TerminalSplitLayout;

  // Active session shortcuts:
  lines: TerminalLine[];
  cwd: string;
  history: string[];

  // Session management:
  createSession: (customShell?: string, title?: string) => string;
  closeSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;

  // Split view management:
  splitTerminal: (customShell?: string) => string;
  toggleSplitView: () => void;
  setSplitLayout: (layout: TerminalSplitLayout) => void;
  closeSplitPane: (id: string) => void;

  // Output & state for active or specific session:
  remember: (cmd: string, sessionId?: string) => void;
  addLine: (text: string, type?: TerminalLine["type"], sessionId?: string) => void;
  clearLines: (sessionId?: string) => void;
  setCwd: (cwd: string, sessionId?: string) => void;
}

const initialSession = createInitialSession();

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  sessions: [initialSession],
  activeSessionId: initialSession.id,

  splitSessionIds: [initialSession.id],
  isSplitView: false,
  splitLayout: "horizontal",

  lines: initialSession.lines,
  cwd: initialSession.cwd,
  history: initialSession.history,

  createSession: (customShell, title) => {
    const state = get();
    const count = state.sessions.length + 1;
    const shell = customShell ?? detectShell();
    const sessionTitle =
      title ?? (customShell ? `${count}: ${customShell}` : `${count}: ${shellName(detectShell())}`);
    const newSession: TerminalSession = {
      id: `term-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      title: sessionTitle,
      shell,
      lines: [],
      cwd: state.cwd || "",
      history: [],
    };

    set({
      sessions: [...state.sessions, newSession],
      activeSessionId: newSession.id,
      lines: newSession.lines,
      cwd: newSession.cwd,
      history: newSession.history,
    });
    return newSession.id;
  },

  splitTerminal: (customShell) => {
    const state = get();
    const newId = state.createSession(customShell);
    set((prev) => {
      const nextSplitIds = prev.splitSessionIds.includes(prev.activeSessionId)
        ? [...prev.splitSessionIds, newId]
        : [prev.activeSessionId, newId];
      return {
        splitSessionIds: nextSplitIds,
        isSplitView: true,
      };
    });
    return newId;
  },

  toggleSplitView: () => {
    const state = get();
    if (!state.isSplitView) {
      if (state.sessions.length > 1) {
        const other = state.sessions.find((s) => s.id !== state.activeSessionId);
        set({
          isSplitView: true,
          splitSessionIds: [state.activeSessionId, other!.id],
        });
      } else {
        state.splitTerminal();
      }
    } else {
      set({ isSplitView: false });
    }
  },

  setSplitLayout: (layout) => {
    set({ splitLayout: layout });
  },

  closeSplitPane: (id) => {
    const state = get();
    const nextSplit = state.splitSessionIds.filter((sId) => sId !== id);
    if (nextSplit.length <= 1) {
      set({
        splitSessionIds: nextSplit.length === 1 ? nextSplit : [state.sessions[0].id],
        isSplitView: false,
        activeSessionId: nextSplit[0] ?? state.sessions[0].id,
      });
    } else {
      set({
        splitSessionIds: nextSplit,
        activeSessionId: state.activeSessionId === id ? nextSplit[0] : state.activeSessionId,
      });
    }
  },

  closeSession: (id: string) => {
    const state = get();
    if (state.sessions.length <= 1) {
      // Don't close last session; just reset its lines
      const resetSession: TerminalSession = {
        ...state.sessions[0],
        lines: [],
      };
      set({
        sessions: [resetSession],
        lines: resetSession.lines,
        isSplitView: false,
        splitSessionIds: [resetSession.id],
      });
      return;
    }

    const nextSessions = state.sessions.filter((s) => s.id !== id);
    const wasActive = state.activeSessionId === id;
    const nextActive = wasActive
      ? nextSessions[nextSessions.length - 1]
      : state.sessions.find((s) => s.id === state.activeSessionId) ?? nextSessions[0];

    const nextSplit = state.splitSessionIds.filter((sId) => sId !== id);

    set({
      sessions: nextSessions,
      activeSessionId: nextActive.id,
      lines: nextActive.lines,
      cwd: nextActive.cwd,
      history: nextActive.history,
      splitSessionIds: nextSplit.length > 0 ? nextSplit : [nextActive.id],
      isSplitView: nextSplit.length > 1 ? state.isSplitView : false,
    });
  },

  setActiveSession: (id: string) => {
    const state = get();
    const session = state.sessions.find((s) => s.id === id);
    if (!session) return;
    set({
      activeSessionId: session.id,
      lines: session.lines,
      cwd: session.cwd,
      history: session.history,
    });
  },

  renameSession: (id: string, title: string) => {
    set((state) => {
      const sessions = state.sessions.map((s) =>
        s.id === id ? { ...s, title } : s
      );
      return { sessions };
    });
  },

  remember: (cmd: string, sessionId?: string) => {
    set((state) => {
      const targetId = sessionId ?? state.activeSessionId;
      const sessions = state.sessions.map((s) => {
        if (s.id === targetId) {
          const nextHist = pushHistory(s.history, cmd);
          return { ...s, history: nextHist };
        }
        return s;
      });
      const active = sessions.find((s) => s.id === state.activeSessionId);
      return {
        sessions,
        history: active ? active.history : state.history,
      };
    });
  },

  addLine: (text: string, type: TerminalLine["type"] = "stdout", sessionId?: string) => {
    set((state) => {
      const targetId = sessionId ?? state.activeSessionId;
      const sessions = state.sessions.map((s) => {
        if (s.id === targetId) {
          const nextLines = [...s.lines.slice(-999), { text, type }];
          return { ...s, lines: nextLines };
        }
        return s;
      });
      const active = sessions.find((s) => s.id === state.activeSessionId);
      return {
        sessions,
        lines: active ? active.lines : state.lines,
      };
    });
  },

  clearLines: (sessionId?: string) => {
    set((state) => {
      const targetId = sessionId ?? state.activeSessionId;
      const sessions = state.sessions.map((s) =>
        s.id === targetId ? { ...s, lines: [] } : s
      );
      const active = sessions.find((s) => s.id === state.activeSessionId);
      return {
        sessions,
        lines: active ? active.lines : [],
      };
    });
  },

  setCwd: (cwd: string, sessionId?: string) => {
    set((state) => {
      const targetId = sessionId ?? state.activeSessionId;
      const sessions = state.sessions.map((s) =>
        s.id === targetId ? { ...s, cwd } : s
      );
      const active = sessions.find((s) => s.id === state.activeSessionId);
      return {
        sessions,
        cwd: active ? active.cwd : cwd,
      };
    });
  },
}));
