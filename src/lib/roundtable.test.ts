import { describe, expect, it } from "vitest";
import {
  activity, agentLine, browserLink, elapsed, joinTable, loadSeat, normalizeServer, parseInvite, saveSeat, sseParser, startTable, watch,
  type Seat,
} from "./roundtable";

const memoryStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const seat: Seat = { base: "http://h:4173", code: "ABC12", member: { id: "m1", name: "Ana", token: "tok" } };

describe("Roundtable client", () => {
  it("reads invite links in every shape people paste them", () => {
    expect(parseInvite("http://130.210.17.89:4173/y5t49")).toEqual({ base: "http://130.210.17.89:4173", code: "Y5T49" });
    expect(parseInvite("https://rt.example.com/ABC12/guide")).toEqual({ base: "https://rt.example.com", code: "ABC12" });
    expect(parseInvite(" localhost:4173/ABC12 ")).toEqual({ base: "http://localhost:4173", code: "ABC12" });
    expect(() => parseInvite("")).toThrow(/Paste/);
    expect(() => parseInvite("http://h:4173/")).toThrow(/five-character/);
  });

  it("accepts a server address and refuses anything else", () => {
    expect(normalizeServer("http://h:4173/")).toBe("http://h:4173");
    expect(() => normalizeServer("h:4173")).toThrow(/looks like/);
    expect(() => normalizeServer("http://h:4173/ABC12")).toThrow(/looks like/);
  });

  it("reads the event stream across chunk boundaries and skips bad frames", () => {
    const got: unknown[] = [];
    const feed = sseParser((t, d, id) => got.push([t, d, id]));
    feed('retry: 2000\n\nevent: room.snapshot\ndata: {"a"');
    feed(':1}\n\nid: 7\nevent: turn.output\ndata: {"turnId":"t1"}\n\nevent: x\ndata: {bad\n\n');
    expect(got).toEqual([["room.snapshot", { a: 1 }, undefined], ["turn.output", { turnId: "t1" }, 7]]);
  });

  it("says what the agent is doing, and how long", () => {
    expect(activity({ kind: "file", path: "a.md", change: "created" })).toBe("writing a.md");
    expect(activity({ kind: "tool", name: "read_file", detail: "x.ts" })).toBe("read file x.ts");
    expect(activity(null)).toBe("thinking");
    expect(elapsed(0, 65_000)).toBe("1m 05s");
  });

  it("hands the agent one line, and the browser the same seat in the fragment only", () => {
    expect(agentLine(seat)).toContain("http://h:4173/ABC12/guide");
    const link = browserLink(seat);
    expect(link.startsWith("http://h:4173/ABC12#seat=")).toBe(true);
    const b64 = link.split("#seat=")[1].replace(/-/g, "+").replace(/_/g, "/");
    expect(JSON.parse(atob(b64))).toEqual(seat.member);
  });

  it("remembers a seat, and forgets one without a token", () => {
    const store = memoryStore();
    saveSeat(seat, store);
    expect(loadSeat(store)).toEqual(seat);
    store.setItem("fahh-roundtable-seat", JSON.stringify({ ...seat, member: { id: "m1", name: "Ana" } }));
    expect(loadSeat(store)).toBeNull();
    saveSeat(null, store);
    expect(loadSeat(store)).toBeNull();
  });

  it("starts a table and takes a seat, passing the server's own errors through", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url.endsWith("/api/rooms")) return new Response(JSON.stringify({ code: "ZZ9ZZ" }), { status: 201 });
      if (url.endsWith("/join")) return new Response(JSON.stringify({ member: { id: "m2", name: "Bo", token: "t2" } }), { status: 200 });
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    expect(await startTable("http://h:4173/", fake)).toBe("ZZ9ZZ");
    const s = await joinTable("http://h:4173", "ZZ9ZZ", " Bo ", fake);
    expect(s.member.token).toBe("t2");
    expect(JSON.parse(String(calls[1][1]?.body))).toEqual({ name: "Bo" });
    await expect(joinTable("http://h:4173", "ZZ9ZZ", "  ", fake)).rejects.toThrow(/name/);

    const limited = (async () => new Response(JSON.stringify({ error: "Slow down" }), { status: 429 })) as unknown as typeof fetch;
    await expect(startTable("http://h:4173", limited)).rejects.toThrow("Slow down");
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(startTable("http://h:4173", down)).rejects.toThrow(/Couldn't reach/);
  });

  it("watch streams events and stops when the table is gone", async () => {
    const enc = new TextEncoder();
    let n = 0;
    const fake = (async () => {
      n += 1;
      if (n > 1) return new Response("", { status: 404 });
      return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode('id: 1\nevent: room.note\ndata: {"note":{"text":"hi"}}\n\n')); c.close(); } }), { status: 200 });
    }) as unknown as typeof fetch;
    const seen: string[] = [];
    const states: boolean[] = [];
    await watch(seat, (t) => seen.push(t), new AbortController().signal, (c) => states.push(c), fake);
    expect(seen).toEqual(["room.note", "room.gone"]);
    expect(states[0]).toBe(true);
  });
});
