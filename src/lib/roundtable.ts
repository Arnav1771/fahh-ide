/**
 * Roundtable: a shared coding table several people (and their agents) sit at.
 * Fahh talks to a Roundtable server over its HTTP API and event stream; this
 * file is everything that does not need React, so it can be tested alone.
 *
 * The seat token proves who you are at a table. It lives in this machine's
 * local storage, like the browser client's, and is only ever sent to the table.
 */

export const DEFAULT_SERVER = "http://130.210.17.89:4173";
const SEAT_KEY = "fahh-roundtable-seat";
const SERVER_KEY = "fahh-roundtable-server";

export interface Member {
  id: string;
  name: string;
  token: string;
}
export interface Seat {
  base: string;
  code: string;
  member: Member;
}
export interface Turn {
  id: string;
  author: string;
  prompt: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  agent?: string;
  summary?: string;
  error?: string;
  commit?: string;
  createdAt: number;
  startedAt?: number;
  undoes?: string;
}
export interface Note {
  id: string;
  author: string;
  name: string;
  text: string;
  at: number;
  images?: string[];
}
export interface RoomView {
  code: string;
  agent?: string;
  agents?: Array<{ name: string; ready: boolean; needsKey: boolean; fallback?: boolean }>;
  members: Array<{ id: string; name: string; role: string; agent?: string; keys?: string[] }>;
  running: Turn | null;
  waiting: Turn[];
  history: Turn[];
  notes: Note[];
}
export type AgentEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; detail?: string }
  | { kind: "file"; path: string; change: string }
  | { kind: "error"; message: string }
  | { kind: "done"; summary?: string };

/** "http://host:4173/ABC12" (or ".../ABC12/guide", or "host:4173/ABC12") -> { base, code }. */
export function parseInvite(text: string): { base: string; code: string } {
  let raw = String(text ?? "").trim();
  if (!raw) throw new Error("Paste the table's invite link.");
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That is not a link. It looks like http://host:4173/ABC12");
  }
  const code = url.pathname.split("/").filter(Boolean)[0] ?? "";
  if (!/^[0-9A-Za-z]{5}$/.test(code)) throw new Error("The link has no five-character table code at the end.");
  return { base: `${url.protocol}//${url.host}`, code: code.toUpperCase() };
}

/** "http://host:4173/" -> "http://host:4173", or an error a person can act on. */
export function normalizeServer(text: string): string {
  const raw = String(text ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+$/i.test(raw)) throw new Error("A server looks like http://host:4173");
  return raw;
}

/** Feed it chunks of an event stream; it calls onEvent(type, data, id) per complete event. */
export function sseParser(onEvent: (type: string, data: any, id?: number) => void): (chunk: string) => void {
  let buf = "";
  return (chunk) => {
    buf += chunk;
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      let type = "message";
      let id: number | undefined;
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) type = line.slice(7);
        else if (line.startsWith("id: ")) id = Number(line.slice(4));
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) continue;
      try {
        onEvent(type, JSON.parse(data), id);
      } catch {
        /* a malformed frame is skipped, not fatal */
      }
    }
  };
}

/** What a running turn is doing, in a few words. */
export function activity(e?: AgentEvent | null): string {
  if (!e) return "thinking";
  if (e.kind === "file") return `writing ${e.path}`;
  if (e.kind === "tool") return `${e.name.replace(/_/g, " ")}${e.detail ? ` ${e.detail}` : ""}`;
  if (e.kind === "text") return "typing";
  return "working";
}

export function elapsed(since: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - since) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** The line a person pastes into their own AI agent; the table's guide does the explaining. */
export function agentLine(seat: Seat): string {
  return `Join my Roundtable coding table: read ${seat.base}/${seat.code}/guide and follow it exactly. Sit down as "${seat.member.name} (agent)", keep listening, and tell me when you're in.`;
}

/** The table in a browser, keeping this seat (the fragment never reaches the server). */
export function browserLink(seat: Seat): string {
  const json = JSON.stringify(seat.member);
  const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${seat.base}/${seat.code}#seat=${b64}`;
}

/* ---------- remembering ---------- */

export function loadSeat(store: Pick<Storage, "getItem"> = localStorage): Seat | null {
  try {
    const s = JSON.parse(store.getItem(SEAT_KEY) ?? "null");
    return s?.base && s?.code && s?.member?.token ? s : null;
  } catch {
    return null;
  }
}
export function saveSeat(seat: Seat | null, store: Pick<Storage, "setItem" | "removeItem"> = localStorage): void {
  try {
    if (seat) store.setItem(SEAT_KEY, JSON.stringify(seat));
    else store.removeItem(SEAT_KEY);
  } catch {
    /* private mode: the seat just won't survive a restart */
  }
}
export function loadServer(store: Pick<Storage, "getItem"> = localStorage): string {
  try {
    return store.getItem(SERVER_KEY) || DEFAULT_SERVER;
  } catch {
    return DEFAULT_SERVER;
  }
}
export function saveServer(server: string, store: Pick<Storage, "setItem"> = localStorage): void {
  try {
    store.setItem(SERVER_KEY, server);
  } catch {}
}

/* ---------- talking to a table ---------- */

export async function call<T = any>(
  base: string,
  path: string,
  opts: { method?: string; body?: unknown; token?: string; text?: boolean } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${base}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.token ? { "x-member": opts.token } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new Error(`Couldn't reach the table at ${base}.`);
  }
  if (opts.text) {
    if (!res.ok) throw new Error(`The table answered ${res.status}.`);
    return (await res.text()) as T;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `The table answered ${res.status}.`);
  return data as T;
}

/** Make a new table on a server. Returns its code. */
export async function startTable(server: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const { code } = await call<{ code: string }>(normalizeServer(server), "/api/rooms", { method: "POST" }, fetchImpl);
  return code;
}

/** Take a seat. */
export async function joinTable(base: string, code: string, name: string, fetchImpl: typeof fetch = fetch): Promise<Seat> {
  if (!name.trim()) throw new Error("Everyone needs a name at the table.");
  const { member } = await call<{ member: Member }>(base, `/api/rooms/${code}/join`, { method: "POST", body: { name: name.trim() } }, fetchImpl);
  return { base, code, member };
}

/**
 * Watch a table: calls onEvent for every event, reconnecting with the last id
 * it saw, until the signal aborts. onStatus says whether it is connected.
 */
export async function watch(
  seat: Seat,
  onEvent: (type: string, data: any) => void,
  signal: AbortSignal,
  onStatus: (connected: boolean) => void = () => {},
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let lastId = 0;
  let wait = 1000;
  while (!signal.aborted) {
    try {
      const res = await fetchImpl(`${seat.base}/api/rooms/${seat.code}/events${lastId ? `?since=${lastId}` : ""}`, {
        headers: { accept: "text/event-stream" },
        signal,
      });
      if (res.status === 404) {
        onEvent("room.gone", {});
        return;
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      onStatus(true);
      wait = 1000;
      const feed = sseParser((type, data, id) => {
        if (id) lastId = id;
        if (type === "room.resync") lastId = 0;
        onEvent(type, data);
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        feed(dec.decode(value, { stream: true }));
      }
    } catch {
      if (signal.aborted) return;
    }
    onStatus(false);
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 2, 15000);
  }
}
