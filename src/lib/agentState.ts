/**
 * Fahh Local panel state: a pure reducer over the backend's agent events plus
 * the user's own actions. No React, no Tauri, so it runs under vitest.
 */
import type { AgentEvent, AgentToolKind } from "./types";

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
  | { kind: "notice"; level: "error" | "info"; text: string };

type ApprovalItem = Extract<Item, { kind: "approval" }>;
type ToolItem = Extract<Item, { kind: "tool" }>;
type PlanItem = Extract<Item, { kind: "plan" }>;

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
  status: AgentStatus;
  items: Item[];
  turns: Record<number, TurnInfo>;
}

export const initialAgentState: AgentState = { session: null, status: "idle", items: [], turns: {} };

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
  | { type: "reset" };

function turnOf(state: AgentState, turn: number): TurnInfo {
  return state.turns[turn] ?? { turn, files: [], accepted: [], reverted: [], finished: false, errorsAdded: 0 };
}

function withTurn(state: AgentState, info: TurnInfo): AgentState {
  return { ...state, turns: { ...state.turns, [info.turn]: info } };
}

function hasPending(items: Item[]): boolean {
  return items.some((i) => i.kind === "approval" && i.state === "pending");
}

function mapItem(items: Item[], pred: (i: Item) => boolean, f: (i: Item) => Item): Item[] {
  return items.map((i) => (pred(i) ? f(i) : i));
}

export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case "reset":
      return { ...initialAgentState };
    case "user_sent":
      return { ...state, status: "running", items: [...state.items, { kind: "user", text: action.text }] };
    case "started":
      return withTurn({ ...state, session: action.session }, turnOf(state, action.turn));
    case "approval_answered": {
      const items = mapItem(
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
        items: mapItem(state.items, (i) => i.kind === "plan" && i.id === action.id, (i) => ({ ...(i as PlanItem), state: "implementing" })),
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
      return {
        ...state,
        items: [...state.items, { kind: "tool", id: ev.id, name: ev.name, toolKind: ev.kind, args: ev.args, status: "running" }],
      };
    case "approval_request":
      return {
        ...state,
        status: "needs_input",
        items: [
          ...state.items,
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
        ],
      };
    case "tool_result":
      return {
        ...state,
        items: mapItem(
          state.items,
          (i) => i.kind === "tool" && i.id === ev.id,
          (i) => ({ ...(i as ToolItem), status: ev.ok ? "ok" : "error", output: ev.output, elapsedMs: ev.elapsed_ms })
        ),
      };
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

export type SlashCommand =
  | { type: "plan"; prompt: string }
  | { type: "auto"; prompt: string }
  | { type: "ask"; prompt: string }
  | { type: "undo" }
  | { type: "clear" };

/**
 * Devin CLI-style slash commands:
 * /plan <prompt> -> Plan mode
 * /auto <prompt> -> Auto-edit mode
 * /ask <prompt>  -> Ask mode
 * /undo          -> Revert turn
 * /clear         -> Reset / clear history
 */
export function parseSlashCommand(input: string): SlashCommand | null {
  const trimmed = input.trim();
  if (trimmed === "/undo") return { type: "undo" };
  if (trimmed === "/clear") return { type: "clear" };
  if (trimmed === "/plan" || trimmed.startsWith("/plan ") || trimmed.startsWith("/plan\n") || trimmed.startsWith("/plan\t")) {
    return { type: "plan", prompt: trimmed.slice(5).trim() };
  }
  if (trimmed === "/auto" || trimmed.startsWith("/auto ") || trimmed.startsWith("/auto\n") || trimmed.startsWith("/auto\t")) {
    return { type: "auto", prompt: trimmed.slice(5).trim() };
  }
  if (trimmed === "/ask" || trimmed.startsWith("/ask ") || trimmed.startsWith("/ask\n") || trimmed.startsWith("/ask\t")) {
    return { type: "ask", prompt: trimmed.slice(4).trim() };
  }
  return null;
}

