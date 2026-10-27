import { describe, it, expect, vi, beforeEach } from "vitest";

type Listener = (e: { payload: unknown }) => void;
const listeners: Record<string, Listener> = {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, fn: Listener) => {
    listeners[name] = fn;
    return () => {};
  }),
}));

let nextId = 7;
let releaseSpawn: (() => void) | null = null;
const writes: Array<[number, string]> = [];
const killed: number[] = [];
vi.mock("./tauri", () => ({
  ptySpawn: vi.fn(
    () =>
      new Promise<number>((resolve) => {
        const id = nextId++;
        releaseSpawn = () => resolve(id);
      })
  ),
  ptyWrite: vi.fn(async (id: number, data: string) => {
    writes.push([id, data]);
  }),
  ptyResize: vi.fn(async () => {}),
  ptyKill: vi.fn(async (id: number) => {
    killed.push(id);
  }),
  terminalProfiles: vi.fn(async () => [{ id: "bash", name: "bash", program: "/bin/bash", args: [] }]),
}));

import { attach, kill, write, resetPtySessions, getProfiles } from "./ptySessions";

const data = (id: number, d: string) => listeners["pty://data"]({ payload: { id, data: d } });
const exit = (id: number, code: number | null) => listeners["pty://exit"]({ payload: { id, code } });
const opts = { profile: "bash", cwd: "/w", cols: 80, rows: 24 };
/** Let attach() get through listen() to ptySpawn. */
const ticks = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("pty sessions", () => {
  beforeEach(() => {
    resetPtySessions();
    writes.length = 0;
    killed.length = 0;
    nextId = 7;
    releaseSpawn = null;
  });

  it("keeps output that beats the spawn, and input typed before the shell exists", async () => {
    const got: string[] = [];
    const attaching = attach("t1", opts, (d) => got.push(d), () => {});
    await ticks();
    await write("t1", "ls\r");
    data(7, "$ "); // the prompt arrives before ptySpawn resolves
    releaseSpawn!();
    await attaching;
    expect(got.join("")).toBe("$ ");
    expect(writes).toEqual([[7, "ls\r"]]);
    data(7, "a.txt\r\n");
    expect(got.join("")).toBe("$ a.txt\r\n");
  });

  it("replays the scrollback when a view attaches again, without a second shell", async () => {
    const first = attach("t2", opts, () => {}, () => {});
    await ticks();
    releaseSpawn!();
    const detach = await first;
    data(7, "hello\r\n");
    detach();
    const got: string[] = [];
    await attach("t2", opts, (d) => got.push(d), () => {});
    expect(got).toEqual(["hello\r\n"]);
    expect(nextId).toBe(8); // one spawn only
  });

  it("reports the exit and ignores input afterwards; kill() kills the shell", async () => {
    const codes: Array<number | null> = [];
    const a = attach("t3", opts, () => {}, (c) => codes.push(c));
    await ticks();
    releaseSpawn!();
    await a;
    exit(7, 0);
    expect(codes).toEqual([0]);
    await write("t3", "x");
    expect(writes).toEqual([]);

    const b = attach("t4", opts, () => {}, () => {});
    await ticks();
    releaseSpawn!();
    await b;
    kill("t4");
    expect(killed).toEqual([8]);
  });

  it("lists profiles once", async () => {
    expect((await getProfiles()).map((p) => p.id)).toEqual(["bash"]);
  });
});
