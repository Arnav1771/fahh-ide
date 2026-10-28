/**
 * The shells behind the terminal tabs, by terminal session id. A shell outlives the view
 * that shows it (the panel can be hidden, moved or re-docked without killing it): the
 * last output is kept and replayed when an xterm attaches again.
 */
import { listen } from "@tauri-apps/api/event";
import { ptyKill, ptyResize, ptySpawn, ptyWrite, terminalProfiles, type TerminalProfile } from "./tauri";

/** Scrollback kept per shell for re-attaching, in characters. */
const MAX_BUFFER = 256 * 1024;

type DataFn = (data: string) => void;
type ExitFn = (code: number | null) => void;

interface Entry {
  ptyId: number | null;
  spawning: Promise<number> | null;
  buffer: string;
  /** Typed (or a task's command) before the shell existed. */
  pendingInput: string;
  exited: boolean;
  exitCode: number | null;
  onData: Set<DataFn>;
  onExit: Set<ExitFn>;
}

const entries = new Map<string, Entry>();
const sessionOfPty = new Map<number, string>();
/** Output for a pty whose spawn() has not resolved yet (the first prompt races it). */
const early = new Map<number, string[]>();
const earlyExit = new Map<number, number | null>();
let listening: Promise<void> | null = null;

function entry(sessionId: string): Entry {
  let e = entries.get(sessionId);
  if (!e) {
    e = { ptyId: null, spawning: null, buffer: "", pendingInput: "", exited: false, exitCode: null, onData: new Set(), onExit: new Set() };
    entries.set(sessionId, e);
  }
  return e;
}

function deliver(e: Entry, data: string): void {
  e.buffer = (e.buffer + data).slice(-MAX_BUFFER);
  for (const fn of e.onData) fn(data);
}

function finish(e: Entry, code: number | null): void {
  e.exited = true;
  e.exitCode = code;
  for (const fn of e.onExit) fn(code);
}

function ensureListening(): Promise<void> {
  listening ??= Promise.all([
    listen<{ id: number; data: string }>("pty://data", ({ payload }) => {
      const sid = sessionOfPty.get(payload.id);
      const e = sid ? entries.get(sid) : undefined;
      if (e) deliver(e, payload.data);
      else early.set(payload.id, [...(early.get(payload.id) ?? []), payload.data]);
    }),
    listen<{ id: number; code: number | null }>("pty://exit", ({ payload }) => {
      const sid = sessionOfPty.get(payload.id);
      const e = sid ? entries.get(sid) : undefined;
      if (e) finish(e, payload.code);
      else earlyExit.set(payload.id, payload.code);
    }),
  ]).then(() => undefined);
  return listening;
}

export interface SpawnOptions {
  profile: string;
  cwd: string;
  cols: number;
  rows: number;
}

/**
 * Show a session: start its shell if it has none, replay what it printed so far, then
 * stream. Returns a function that stops streaming (the shell keeps running).
 */
export async function attach(sessionId: string, opts: SpawnOptions, onData: DataFn, onExit: ExitFn): Promise<() => void> {
  await ensureListening();
  const e = entry(sessionId);
  if (e.buffer) onData(e.buffer);
  e.onData.add(onData);
  e.onExit.add(onExit);
  if (e.exited) onExit(e.exitCode);
  else if (e.ptyId === null && !e.spawning) {
    e.spawning = ptySpawn(opts.profile, opts.cwd, opts.cols, opts.rows);
    try {
      const id = await e.spawning;
      e.ptyId = id;
      sessionOfPty.set(id, sessionId);
      for (const chunk of early.get(id) ?? []) deliver(e, chunk);
      early.delete(id);
      if (earlyExit.has(id)) {
        finish(e, earlyExit.get(id) ?? null);
        earlyExit.delete(id);
      } else if (e.pendingInput) {
        const input = e.pendingInput;
        e.pendingInput = "";
        await ptyWrite(id, input);
      }
    } catch (err) {
      e.spawning = null;
      deliver(e, `\x1b[31m${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`);
      finish(e, null);
    }
  }
  return () => {
    e.onData.delete(onData);
    e.onExit.delete(onExit);
  };
}

/** Keystrokes for a session's shell; queued until the shell has started. */
export async function write(sessionId: string, data: string): Promise<void> {
  const e = entry(sessionId);
  if (e.exited) return;
  if (e.ptyId === null) {
    e.pendingInput += data;
    return;
  }
  await ptyWrite(e.ptyId, data).catch(() => {});
}

export function resize(sessionId: string, cols: number, rows: number): void {
  const id = entries.get(sessionId)?.ptyId;
  if (id != null) void ptyResize(id, cols, rows).catch(() => {});
}

/** Close a session: kill its shell and forget it. */
export function kill(sessionId: string): void {
  const e = entries.get(sessionId);
  entries.delete(sessionId);
  if (e?.ptyId != null) {
    sessionOfPty.delete(e.ptyId);
    void ptyKill(e.ptyId).catch(() => {});
  }
}

/** Forget a session's scrollback (Clear). */
export function clearBuffer(sessionId: string): void {
  const e = entries.get(sessionId);
  if (e) e.buffer = "";
}

let profiles: Promise<TerminalProfile[]> | null = null;
/** The shells this machine has (asked once). */
export function getProfiles(): Promise<TerminalProfile[]> {
  profiles ??= terminalProfiles().catch(() => []);
  return profiles;
}

/** Test-only. */
export function resetPtySessions(): void {
  entries.clear();
  sessionOfPty.clear();
  early.clear();
  earlyExit.clear();
  listening = null;
  profiles = null;
}
