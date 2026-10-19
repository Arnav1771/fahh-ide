import { create } from "zustand";
import {
  agentApprove,
  agentRevertFile,
  agentRevertTurn,
  agentSetDiagnostics,
  agentStart,
  agentStop,
  DEFAULT_AGENT_SETTINGS,
  listenAgent,
  parseAgentSettings,
  settingsProblem,
  toProviderConfig,
  type AgentSettings,
} from "../lib/agent";
import {
  agentReducer,
  errorsAdded,
  initialAgentState,
  joinRoot,
  parseSlashCommand,
  samePath,
  type AgentAction,
  type AgentState,
} from "../lib/agentState";
import { collectMarkers } from "../lib/agentMarkers";
import { readFile } from "../lib/tauri";
import type { AgentDecision, AgentEnvelope, AgentMode } from "../lib/types";
import { useEditorStore } from "./editorStore";
import { useFahhStore } from "./fahhStore";
import { useFileStore } from "./fileStore";

const KEY = "fahh-agent-settings";
const LEGACY_KEY = "fahh-ai-settings"; // the old AI Composer

function load(): AgentSettings {
  try {
    return parseAgentSettings(localStorage.getItem(KEY), localStorage.getItem(LEGACY_KEY));
  } catch {
    return { ...DEFAULT_AGENT_SETTINGS };
  }
}

function save(s: AgentSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // no storage: the panel still works for this session
  }
}

interface AgentStore extends AgentState {
  settings: AgentSettings;
  /** What the editor's error count was when the turn started. */
  baseline: number;
  /** Queued prompts to execute consecutively once the current turn completes. */
  queue: string[];
  enqueue: (prompt: string) => void;
  dequeue: () => string | undefined;
  removeQueueItem: (index: number) => void;
  clearQueue: () => void;
  /** Steering: interrupt the current running turn and steer the agent in a new direction */
  steer: (instruction: string) => Promise<void>;
  dispatch: (a: AgentAction) => void;
  updateSettings: (patch: Partial<AgentSettings>) => void;
  setMode: (m: AgentMode) => void;
  send: (prompt: string, mode?: AgentMode) => Promise<void>;
  answer: (id: string, decision: AgentDecision) => Promise<void>;
  stop: () => Promise<void>;
  revertTurn: (turn: number) => Promise<void>;
  rejectFile: (turn: number, path: string) => Promise<void>;
  newChat: () => void;
}

/** Re-read open, clean tabs from disk after the agent (or a revert) changed them. */
async function reloadTabs(paths: string[]): Promise<void> {
  const root = useFileStore.getState().root;
  if (!root) return;
  const ed = useEditorStore.getState();
  for (const rel of paths) {
    const tab = ed.openTabs.find((t) => samePath(t.path, joinRoot(root, rel)));
    if (!tab || tab.dirty) continue; // never overwrite unsaved edits in the editor
    try {
      ed.setContent(tab.path, await readFile(tab.path));
    } catch {
      // deleted by a revert: leave the tab as it is
    }
  }
}

function notify(text: string): void {
  try {
    if (typeof document !== "undefined" && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Fahh Local", { body: text });
    }
  } catch {
    // notifications are best-effort
  }
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  ...initialAgentState,
  settings: load(),
  queue: [],
  baseline: 0,

  enqueue: (prompt: string) => {
    const text = prompt.trim();
    if (!text) return;
    set((s) => ({ queue: [...s.queue, text] }));
  },

  dequeue: () => {
    const { queue } = get();
    if (queue.length === 0) return undefined;
    const [first, ...rest] = queue;
    set({ queue: rest });
    return first;
  },

  removeQueueItem: (index: number) => {
    set((s) => ({ queue: s.queue.filter((_, i) => i !== index) }));
  },

  clearQueue: () => set({ queue: [] }),

  steer: async (instruction: string) => {
    const text = instruction.trim();
    if (!text) return;
    // Stop running turn
    await get().stop();
    // Dispatch steering instruction with steering format
    const steerPrompt = `[STEERING REDIRECT]: ${text}\n(Stop prior direction and follow this guidance immediately.)`;
    setTimeout(() => {
      void get().send(steerPrompt);
    }, 150);
  },

  dispatch: (a) => set((s) => agentReducer(s, a)),

  updateSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch };
      save(settings);
      return { settings };
    }),

  setMode: (mode) => get().updateSettings({ mode }),

  send: async (prompt, modeOverride) => {
    const cmd = parseSlashCommand(prompt);
    if (cmd) {
      if (cmd.type === "clear") {
        get().newChat();
        return;
      }
      if (cmd.type === "undo") {
        const turnNums = Object.keys(get().turns).map(Number).sort((a, b) => b - a);
        const turnWithFiles = turnNums.find((t) => (get().turns[t]?.files.length ?? 0) > 0) ?? turnNums[0];
        if (turnWithFiles !== undefined) {
          await get().revertTurn(turnWithFiles);
        }
        return;
      }
      if (cmd.type === "plan") {
        get().setMode("plan");
        if (!cmd.prompt) return;
        prompt = cmd.prompt;
        modeOverride = "plan";
      } else if (cmd.type === "auto") {
        get().setMode("auto-edit");
        if (!cmd.prompt) return;
        prompt = cmd.prompt;
        modeOverride = "auto-edit";
      } else if (cmd.type === "ask") {
        get().setMode("ask");
        if (!cmd.prompt) return;
        prompt = cmd.prompt;
        modeOverride = "ask";
      }
    }

    const { settings, session, dispatch } = get();
    const root = useFileStore.getState().root;
    if (!root) {
      dispatch({ type: "event", event: { type: "error", turn: 0, message: "Open a folder first: the agent works inside a workspace." } });
      return;
    }
    const problem = settingsProblem(settings);
    if (problem) {
      dispatch({ type: "event", event: { type: "error", turn: 0, message: problem } });
      return;
    }
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
    } catch {
      // ignore
    }
    const ed = useEditorStore.getState();
    const snapshot = collectMarkers(root);
    set({ baseline: snapshot.errors });
    await agentSetDiagnostics(snapshot.files).catch(() => {});
    dispatch({ type: "user_sent", text: prompt });
    try {
      const r = await agentStart({
        session,
        workspace: root,
        prompt,
        mode: modeOverride ?? settings.mode,
        provider: toProviderConfig(settings),
        context: {
          active_file: ed.activeTab,
          selection: null,
          open_files: ed.openTabs.map((t) => t.path),
          dirty_files: ed.openTabs.filter((t) => t.dirty).map((t) => t.path),
        },
      });
      dispatch({ type: "started", session: r.session, turn: r.turn });
    } catch (e) {
      dispatch({ type: "event", event: { type: "error", turn: 0, message: String(e) } });
    }
  },

  answer: async (id, decision) => {
    const { session, dispatch } = get();
    if (!session) return;
    dispatch({ type: "approval_answered", id, allow: decision.allow });
    await agentApprove(session, id, decision).catch(() => {});
  },

  stop: async () => {
    const { session } = get();
    if (session) await agentStop(session).catch(() => {});
  },

  revertTurn: async (turn) => {
    const { session, dispatch } = get();
    if (!session) return;
    try {
      const files = await agentRevertTurn(session, turn);
      dispatch({ type: "turn_reverted", turn });
      await reloadTabs(files);
    } catch (e) {
      dispatch({ type: "event", event: { type: "error", turn, message: String(e) } });
    }
  },

  rejectFile: async (turn, path) => {
    const { session, dispatch } = get();
    if (!session) return;
    try {
      await agentRevertFile(session, turn, path);
      dispatch({ type: "file_reverted", turn, path });
      await reloadTabs([path]);
    } catch (e) {
      dispatch({ type: "event", event: { type: "error", turn, message: String(e) } });
    }
  },

  newChat: () => {
    void get().stop();
    set({ ...initialAgentState, queue: [] });
  },
}));

// ─── backend events ───────────────────────────────────────────────────────────

let settleTimer: number | undefined;

function onEnvelope({ session, event }: AgentEnvelope): void {
  const store = useAgentStore.getState();
  if (store.session && session !== store.session) return;
  store.dispatch({ type: "event", event });

  if (event.type === "file_changed") {
    void reloadTabs([event.path]);
    // The meme tie-in: if the agent's edit leaves the editor with more errors
    // than the turn started with, the fahh plays.
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      const root = useFileStore.getState().root;
      if (!root) return;
      const now = collectMarkers(root);
      const added = errorsAdded(useAgentStore.getState().baseline, now.errors);
      if (added > 0) {
        useAgentStore.getState().dispatch({ type: "errors_added", turn: event.turn, count: added });
        useFahhStore.getState().external();
      }
      useAgentStore.setState({ baseline: now.errors });
      void agentSetDiagnostics(now.files).catch(() => {});
    }, 1500);
  } else if (event.type === "approval_request") {
    notify(`Needs your OK: ${event.summary}`);
  } else if (event.type === "done") {
    notify("Finished");
    // Auto-dispatch next queued prompt if available
    const nextPrompt = store.dequeue();
    if (nextPrompt) {
      setTimeout(() => {
        const currentStore = useAgentStore.getState();
        if (currentStore.status !== "running") {
          void currentStore.send(nextPrompt);
        }
      }, 250);
    }
  } else if (event.type === "error" && event.message !== "stopped") {
    notify(event.message);
  }
}

let started = false;

/** Subscribe once, for the life of the app: events keep arriving while the panel is hidden. */
export function initAgentEvents(): () => void {
  if (started) return () => {};
  started = true;
  let off: (() => void) | undefined;
  let disposed = false;
  void listenAgent(onEnvelope)
    .then((u) => (disposed ? u() : (off = u))) // StrictMode unmounts before listen() resolves
    .catch(() => {});
  return () => {
    disposed = true;
    off?.();
    started = false;
  };
}
