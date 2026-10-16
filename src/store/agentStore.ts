import { create } from "zustand";
import {
  agentAgents,
  agentApprove,
  agentCompact,
  agentContext,
  agentExport,
  agentRevertFile,
  agentRevertTurn,
  agentSessionFork,
  agentSessionLoad,
  agentSessionRemove,
  agentSessionRename,
  agentSessionRevert,
  agentSessions,
  agentSetDiagnostics,
  agentStart,
  agentSteps,
  agentStop,
  agentStopChild,
  agentUsage,
  DEFAULT_AGENT_SETTINGS,
  listenAgent,
  parseAgentSettings,
  settingsProblem,
  toJudgeConfig,
  toProviderConfig,
  type AgentSettings,
} from "../lib/agent";
import { runSlash, type SendOpts } from "../lib/agentCommands";
import { parseSlash } from "../lib/slash";
import {
  agentReducer,
  errorsAdded,
  initialAgentState,
  joinRoot,
  samePath,
  type AgentAction,
  type AgentState,
} from "../lib/agentState";
import { collectMarkers, currentSelection } from "../lib/agentMarkers";
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
  dispatch: (a: AgentAction) => void;
  updateSettings: (patch: Partial<AgentSettings>) => void;
  setMode: (m: AgentMode) => void;
  /** True while /fast has switched to the fast model. */
  usingFast: boolean;
  /** Called when /exit is typed: the panel's host decides what leaving means. */
  onExit: (() => void) | null;
  send: (prompt: string, opts?: SendOpts) => Promise<void>;
  /** What the user typed: a slash command runs as one, anything else is a prompt. */
  handleInput: (text: string) => Promise<void>;
  stopChild: (child: string) => Promise<void>;
  loadSession: (id: string) => Promise<void>;
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
  baseline: 0,
  usingFast: false,
  onExit: null,

  dispatch: (a) => set((s) => agentReducer(s, a)),

  updateSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch };
      save(settings);
      return { settings };
    }),

  setMode: (mode) => get().updateSettings({ mode }),

  send: async (prompt, opts = {}) => {
    const { settings, session, dispatch, usingFast } = get();
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
    const model = opts.model ?? (usingFast && settings.fastModel ? settings.fastModel : undefined);
    const shown = opts.run?.kind === "loop" ? `/loop ${prompt}` : opts.run?.kind === "btw" ? `/btw ${prompt}` : opts.run?.kind === "agent" ? `/agent ${opts.run.name} ${prompt}` : opts.mode === "qa" ? `/ask ${prompt}` : prompt;
    dispatch({ type: "user_sent", text: shown });
    try {
      const r = await agentStart({
        session,
        workspace: root,
        prompt,
        mode: opts.mode ?? settings.mode,
        provider: toProviderConfig(settings, model),
        judge: toJudgeConfig(settings),
        run: opts.run ?? { kind: "turn" },
        extra_dirs: settings.extraDirs,
        context: {
          active_file: ed.activeTab,
          selection: currentSelection(ed.activeTab),
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

  stopChild: async (child) => {
    const { session } = get();
    if (session) await agentStopChild(session, child).catch(() => {});
  },

  loadSession: async (id) => {
    const root = useFileStore.getState().root;
    if (!root) return;
    try {
      const loaded = await agentSessionLoad(root, id, get().settings.extraDirs);
      get().dispatch({ type: "loaded", loaded });
    } catch (e) {
      get().dispatch({ type: "notice", level: "error", text: String(e) });
    }
  },

  handleInput: async (text) => {
    const parsed = parseSlash(text);
    if (parsed === null) return get().send(text);
    if (typeof parsed === "string") return get().dispatch({ type: "notice", level: "error", text: parsed });
    await runSlash(
      {
        ipc: {
          sessions: agentSessions,
          load: agentSessionLoad,
          fork: agentSessionFork,
          revert: agentSessionRevert,
          rename: agentSessionRename,
          remove: agentSessionRemove,
          steps: agentSteps,
          compact: agentCompact,
          context: agentContext,
          usage: agentUsage,
          exportSession: agentExport,
          agents: agentAgents,
        },
        settings: () => get().settings,
        state: () => get(),
        root: () => useFileStore.getState().root,
        update: (patch) => get().updateSettings(patch),
        dispatch: (a) => get().dispatch(a),
        send: (p, o) => get().send(p, o),
        provider: () => toProviderConfig(get().settings, get().usingFast && get().settings.fastModel ? get().settings.fastModel : undefined),
        newChat: () => get().newChat(),
        reloadTabs,
        copy: async (t) => {
          await navigator.clipboard.writeText(t);
        },
        exit: () => get().onExit?.(),
        usingFast: () => get().usingFast,
        setUsingFast: (on) => set({ usingFast: on }),
      },
      parsed
    );
  },

  newChat: () => {
    void get().stop();
    set({ ...initialAgentState, usingFast: false });
  },
}));

// ─── backend events ───────────────────────────────────────────────────────────

let settleTimer: number | undefined;

function onEnvelope({ session, event: outer }: AgentEnvelope): void {
  const store = useAgentStore.getState();
  if (store.session && session !== store.session) return;
  store.dispatch({ type: "event", event: outer });
  // a subagent's edit or approval needs the same reactions as the parent's
  const event = outer.type === "sub" ? outer.event : outer;

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
