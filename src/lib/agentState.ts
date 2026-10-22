/**
 * Fahh Local panel state: a pure reducer over the backend's agent events plus
 * the user's own actions. No React, no Tauri, so it runs under vitest.
 */
import type { AgentEvent, AgentLoaded, AgentMode, AgentMsg, AgentSessionInfo, AgentToolKind } from "./types";

export type AgentStatus = "idle" | "running" | "needs_input" | "done" | "error";

export type Item =
  | { kind: "user"; text: string }
  | { kind: "assistant"; turn: number; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      toolKind: AgentToolKind;
      args: Record<string, unknown>;
      status: "running" | "ok" | "error";
      output?: string;
      /** How long the tool took (from the backend). */
      elapsedMs?: number;
    }
  | {
      kind: "approval";
      id: string;
      tool: string;
      toolKind: AgentToolKind;
      summary: string;
      command: string | null;
      path: string | null;
      oldText: string | null;
      newText: string | null;
      state: "pending" | "allowed" | "denied";
    }
  | { kind: "plan"; id: string; path: string; markdown: string; state: "proposed" | "implementing" }
  | {
      kind: "sub";
      child: string;
      name: string;
      task: string;
      model: string | null;
      mode: AgentMode;
      status: "running" | "done" | "failed";
      steps: number;
      summary: string;
      /** Its tool lines and approvals, nested. */
      items: Item[];
    }
  | { kind: "sessions"; sessions: AgentSessionInfo[]; current: string | null }
  | { kind: "notice"; level: "error" | "info"; text: string };

type ApprovalItem = Extract<Item, { kind: "approval" }>;
type ToolItem = Extract<Item, { kind: "tool" }>;
type PlanItem = Extract<Item, { kind: "plan" }>;
type SubItem = Extract<Item, { kind: "sub" }>;

export interface TurnInfo {
  turn: number;
  /** Files the agent changed (workspace-relative) that are still changed. */
  files: string[];
  accepted: string[];
  reverted: string[];
  finished: boolean;
  /** Errors the edits added (editor markers), for the fahh tie-in. */
  errorsAdded: number;
}

export interface AgentState {
  session: string | null;
  title: string;
  status: AgentStatus;
  items: Item[];
  turns: Record<number, TurnInfo>;
}

export const initialAgentState: AgentState = { session: null, title: "", status: "idle", items: [], turns: {} };

export type AgentAction =
  | { type: "user_sent"; text: string }
  | { type: "started"; session: string; turn: number }
  | { type: "event"; event: AgentEvent }
  | { type: "approval_answered"; id: string; allow: boolean }
  | { type: "plan_implementing"; id: string }
  | { type: "file_accepted"; turn: number; path: string }
  | { type: "file_reverted"; turn: number; path: string }
  | { type: "turn_reverted"; turn: number }
  | { type: "errors_added"; turn: number; count: number }
  | { type: "notice"; level: "error" | "info"; text: string }
  | { type: "sessions"; sessions: AgentSessionInfo[] }
  | { type: "loaded"; loaded: AgentLoaded }
  | { type: "renamed"; title: string }
  | { type: "reset" };

function turnOf(state: AgentState, turn: number): TurnInfo {
  return state.turns[turn] ?? { turn, files: [], accepted: [], reverted: [], finished: false, errorsAdded: 0 };
}

function withTurn(state: AgentState, info: TurnInfo): AgentState {
  return { ...state, turns: { ...state.turns, [info.turn]: info } };
}

function hasPending(items: Item[]): boolean {
  return items.some((i) => (i.kind === "approval" && i.state === "pending") || (i.kind === "sub" && hasPending(i.items)));
}

/** Map matching items, looking inside subagent cards too. */
function mapDeep(items: Item[], pred: (i: Item) => boolean, f: (i: Item) => Item): Item[] {
  return items.map((i) => (pred(i) ? f(i) : i.kind === "sub" ? { ...i, items: mapDeep(i.items, pred, f) } : i));
}

export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case "reset":
      return { ...initialAgentState };
    case "user_sent":
      return { ...state, status: "running", items: [...state.items, { kind: "user", text: action.text }] };
    case "started":
      return withTurn({ ...state, session: action.session }, turnOf(state, action.turn));
    case "notice":
      return { ...state, items: [...state.items, { kind: "notice", level: action.level, text: action.text }] };
    case "sessions":
      return { ...state, items: [...state.items, { kind: "sessions", sessions: action.sessions, current: state.session }] };
    case "renamed":
      return { ...state, title: action.title };
    case "loaded": {
      const turns: Record<number, TurnInfo> = {};
      for (const t of action.loaded.turns) turns[t.id] = { turn: t.id, files: [], accepted: [], reverted: [], finished: true, errorsAdded: 0 };
      return { session: action.loaded.session, title: action.loaded.title, status: "idle", items: itemsFromHistory(action.loaded.history), turns };
    }
    case "approval_answered": {
      const items = mapDeep(
        state.items,
        (i) => i.kind === "approval" && i.id === action.id,
        (i) => ({ ...(i as ApprovalItem), state: action.allow ? "allowed" : "denied" })
      );
      const status = hasPending(items) ? "needs_input" : state.status === "needs_input" ? "running" : state.status;
      return { ...state, items, status };
    }
    case "plan_implementing":
      return {
        ...state,
        items: mapDeep(state.items, (i) => i.kind === "plan" && i.id === action.id, (i) => ({ ...(i as PlanItem), state: "implementing" })),
      };
    case "file_accepted": {
      const t = turnOf(state, action.turn);
      return withTurn(state, { ...t, accepted: t.accepted.includes(action.path) ? t.accepted : [...t.accepted, action.path] });
    }
    case "file_reverted": {
      const t = turnOf(state, action.turn);
      return withTurn(state, { ...t, reverted: [...t.reverted, action.path], files: t.files.filter((f) => f !== action.path) });
    }
    case "turn_reverted": {
      const t = turnOf(state, action.turn);
      return withTurn(state, { ...t, reverted: [...t.reverted, ...t.files], files: [] });
    }
    case "errors_added": {
      const t = turnOf(state, action.turn);
      return withTurn(state, { ...t, errorsAdded: t.errorsAdded + action.count });
    }
    case "event":
      return applyEvent(state, action.event);
  }
}

/** Events that happen inside a subagent: tool lines, approvals, its judge. Its prose is not shown. */
function applyInner(items: Item[], ev: AgentEvent): Item[] {
  switch (ev.type) {
    case "tool_call":
      return [...items, { kind: "tool", id: ev.id, name: ev.name, toolKind: ev.kind, args: ev.args, status: "running" }];
    case "tool_result":
      return mapDeep(items, (i) => i.kind === "tool" && i.id === ev.id, (i) => ({ ...(i as ToolItem), status: ev.ok ? "ok" : "error", output: ev.output, elapsedMs: ev.elapsed_ms }));
    case "approval_request":
      return [
        ...items,
        {
          kind: "approval",
          id: ev.id,
          tool: ev.tool,
          toolKind: ev.kind,
          summary: ev.summary,
          command: ev.command,
          path: ev.path,
          oldText: ev.old_text,
          newText: ev.new_text,
          state: "pending",
        },
      ];
    case "judge":
      return [...items, { kind: "notice", level: "info", text: judgeLine(ev) }];
    default:
      return items;
  }
}

function judgeLine(ev: Extract<AgentEvent, { type: "judge" }>): string {
  return `Judge: ${ev.safe ? "SAFE" : "UNSAFE"} ${ev.command}${ev.reason ? ` (${ev.reason})` : ""}`;
}

function applyEvent(state: AgentState, ev: AgentEvent): AgentState {
  switch (ev.type) {
    case "turn_started":
      return withTurn({ ...state, status: "running" }, turnOf(state, ev.turn));
    case "text_delta": {
      const last = state.items[state.items.length - 1];
      if (last && last.kind === "assistant" && last.turn === ev.turn) {
        return { ...state, items: [...state.items.slice(0, -1), { ...last, text: last.text + ev.text }] };
      }
      return { ...state, items: [...state.items, { kind: "assistant", turn: ev.turn, text: ev.text }] };
    }
    case "tool_call":
    case "tool_result":
    case "approval_request": {
      const items = applyInner(state.items, ev);
      return { ...state, items, status: ev.type === "approval_request" ? "needs_input" : state.status };
    }
    case "judge":
      return { ...state, items: [...state.items, { kind: "notice", level: "info", text: judgeLine(ev) }] };
    case "sub_started":
      return {
        ...state,
        items: [
          ...state.items,
          { kind: "sub", child: ev.child, name: ev.name, task: ev.task, model: ev.model, mode: ev.mode, status: "running", steps: 0, summary: "", items: [] },
        ],
      };
    case "sub": {
      if (ev.event.type === "file_changed") return applyEvent(state, ev.event); // the child's edit belongs to this turn's review
      const inner = ev.event;
      const items = state.items.map((i) => (i.kind === "sub" && i.child === ev.child ? { ...i, items: applyInner(i.items, inner) } : i));
      return { ...state, items, status: inner.type === "approval_request" ? "needs_input" : state.status };
    }
    case "sub_done":
      return {
        ...state,
        // whatever was still running or waiting inside it is over
        items: state.items.map((i) =>
          i.kind === "sub" && i.child === ev.child
            ? {
                ...(i as SubItem),
                status: ev.ok ? "done" : "failed",
                steps: ev.steps,
                summary: ev.summary,
                items: i.items.map((c) =>
                  c.kind === "tool" && c.status === "running"
                    ? { ...c, status: ev.ok ? "ok" : "error" }
                    : c.kind === "approval" && c.state === "pending"
                      ? { ...c, state: "denied" }
                      : c
                ),
              }
            : i
        ),
      };
    case "loop_round":
      return {
        ...state,
        items: [
          ...state.items,
          { kind: "notice", level: "info", text: `Loop round ${ev.round}/${ev.max}: ${ev.approved ? "the reviewer approved" : `changes requested: ${ev.notes}`}` },
        ],
      };
    case "notice":
      return { ...state, items: [...state.items, { kind: "notice", level: "info", text: ev.text }] };
    case "compacted":
      return { ...state, items: [...state.items, { kind: "notice", level: "info", text: `Context compacted: about ${ev.before} to ${ev.after} tokens.` }] };
    case "file_changed": {
      const t = turnOf(state, ev.turn);
      return withTurn(state, { ...t, files: t.files.includes(ev.path) ? t.files : [...t.files, ev.path] });
    }
    case "plan_written":
      return { ...state, items: [...state.items, { kind: "plan", id: ev.id, path: ev.path, markdown: ev.markdown, state: "proposed" }] };
    case "done": {
      const t = turnOf(state, ev.turn);
      return withTurn({ ...state, status: "done" }, { ...t, finished: true, files: ev.files.filter((f) => !t.reverted.includes(f)) });
    }
    case "error":
      return {
        ...state,
        status: "error",
        items: [...state.items, { kind: "notice", level: "error", text: ev.message === "stopped" ? "Stopped." : ev.message }],
      };
  }
}

// ─── resuming a saved session ─────────────────────────────────────────────────

const TOOL_KINDS: Record<string, AgentToolKind> = {
  list_dir: "read", read_file: "read", search: "read", get_diagnostics: "read",
  edit_file: "edit", write_file: "edit", run_command: "run", write_plan: "plan", delegate: "agent",
};

/** Rebuild the transcript from the saved conversation (what resume shows). */
export function itemsFromHistory(history: AgentMsg[]): Item[] {
  const results = new Map<string, string>();
  for (const m of history) if (m.role === "tool_result") results.set(m.id, m.content);
  const items: Item[] = [];
  for (const m of history) {
    if (m.role === "user") {
      items.push(m.text.startsWith("[Summary of the earlier conversation]")
        ? { kind: "notice", level: "info", text: "Earlier turns were summarised to save context." }
        : { kind: "user", text: m.text });
    } else if (m.role === "assistant") {
      if (m.text) items.push({ kind: "assistant", turn: 0, text: m.text });
      for (const c of m.calls) {
        const out = results.get(c.id);
        items.push({
          kind: "tool",
          id: c.id,
          name: c.name,
          toolKind: TOOL_KINDS[c.name] ?? "read",
          args: c.args,
          status: out === undefined ? "ok" : /^(denied|unknown tool|missing)/.test(out) ? "error" : "ok",
          output: out,
        });
      }
    }
  }
  return items;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Turns that still have changes the user has not accepted. */
export function pendingReview(state: AgentState): TurnInfo[] {
  return Object.values(state.turns).filter((t) => t.files.some((f) => !t.accepted.includes(f)));
}

/** Errors added by an edit: only growth counts (fixing errors is not a fahh). */
export function errorsAdded(before: number, after: number): number {
  return Math.max(0, after - before);
}

/** Same file on Windows or Unix: slashes and case do not matter. */
export function samePath(a: string, b: string): boolean {
  const n = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return n(a) === n(b);
}

export function joinRoot(root: string, rel: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${rel}`;
}

/** Monaco model uri path (/C:/proj/a.ts or /home/me/a.ts) to a path relative to the workspace, or null if outside it. */
export function relToRoot(root: string, uriPath: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\/([A-Za-z]:)/, "$1").replace(/\/+$/, "");
  const r = norm(root);
  const p = norm(uriPath);
  if (p.toLowerCase().startsWith(r.toLowerCase() + "/")) return p.slice(r.length + 1);
  return null;
}

/** The last assistant message with text, for /copy. */
export function lastReply(items: Item[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "assistant" && it.text.trim()) return it.text;
  }
  return "";
}
