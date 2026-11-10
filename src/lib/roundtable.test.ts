import { describe, expect, it } from "vitest";
import {
  activity, agentLine, browserLink, checkPictures, elapsed, joinTable, loadSeat, mediaUrl, normalizeServer, parseInvite, pictureType, saveSeat, sayBody, sseParser, startTable, uploadPicture, watch,
  ago, forgetTable, gaveUp, loadRecent, recentEntry, rejoinTable, remember, saveRecent,
  type RecentTable, type Seat,
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

  it("checks pictures before sending: raster only, 5 MB, 4 at a time", () => {
    const png = (name: string, size = 10) => ({ name, type: "image/png", size });
    let r = checkPictures(0, [png("a"), { name: "x.svg", type: "image/svg+xml", size: 5 }, png("big", 5 * 1024 * 1024 + 1)]);
    expect(r.ok.map((f) => f.name)).toEqual(["a"]);
    expect(r.errors[0]).toMatch(/x\.svg is not a PNG, JPEG, WebP or GIF/);
    expect(r.errors[1]).toMatch(/big is over 5 MB/);
    r = checkPictures(3, [png("a"), png("b"), png("c")]);
    expect(r.ok.map((f) => f.name)).toEqual(["a"]);
    expect(r.errors).toEqual(["Share up to 4 pictures at a time."]);
    expect(checkPictures(0, [png("edge", 5 * 1024 * 1024)]).ok).toHaveLength(1);
    expect(pictureType("C:\\shots\\A.JPG")).toBe("image/jpeg");
    expect(pictureType("/tmp/x.webp")).toBe("image/webp");
    expect(pictureType("/tmp/x.svg")).toBe("");
    expect(pictureType("/tmp/png")).toBe("");
  });

  it("builds a note's body and a picture's address", () => {
    expect(sayBody(" hi ")).toEqual({ text: "hi" });
    expect(sayBody("", ["a.png"])).toEqual({ text: "", images: ["a.png"] });
    expect(() => sayBody("  ")).toThrow(/Write something/);
    expect(mediaUrl("http://h:4173/", "ABC12", "0f.png")).toBe("http://h:4173/api/rooms/ABC12/media/0f.png");
    expect(mediaUrl("https://h", "AB C", "../x")).toBe("https://h/api/rooms/AB%20C/media/..%2Fx");
  });

  it("uploads a picture's bytes with the seat, and passes the server's refusal through", async () => {
    let got: [string, RequestInit | undefined] | null = null;
    const ok = (async (url: string, init?: RequestInit) => ((got = [url, init]), new Response(JSON.stringify({ id: "ab.png", url: "/x" }), { status: 201 }))) as unknown as typeof fetch;
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    expect(await uploadPicture(seat, blob, ok)).toBe("ab.png");
    expect(got![0]).toBe("http://h:4173/api/rooms/ABC12/media");
    expect(got![1]?.headers).toEqual({ "content-type": "image/png", "x-member": "tok" });
    expect(got![1]?.body).toBe(blob);
    const refused = (async () => new Response(JSON.stringify({ error: "Only PNG, JPEG, WebP or GIF pictures can be shared." }), { status: 400 })) as unknown as typeof fetch;
    await expect(uploadPicture(seat, blob, refused)).rejects.toThrow("Only PNG, JPEG");
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(uploadPicture(seat, blob, down)).rejects.toThrow(/Couldn't reach/);
  });

  it("keeps the last five tables, newest first, one per table", () => {
    const at = (code: string, t: number) => recentEntry({ ...seat, code }, t);
    let list: RecentTable[] = [];
    for (let i = 1; i <= 6; i++) list = remember(list, at(`T000${i}`, i));
    expect(list.map((e) => e.code)).toEqual(["T0006", "T0005", "T0004", "T0003", "T0002"]);
    list = remember(list, at("T0003", 99));
    expect(list.map((e) => e.code)).toEqual(["T0003", "T0006", "T0005", "T0004", "T0002"]);
    expect(forgetTable(list, { base: seat.base, code: "T0006" })).toHaveLength(4);
    const left = gaveUp(list, { base: seat.base, code: "T0005" }, 200);
    expect(left[0]).toEqual({ base: seat.base, code: "T0005", name: "Ana", memberId: "m1", at: 200 });
    expect(gaveUp(list, { base: "x", code: "NOPE1" })).toBe(list);
    const store = memoryStore();
    saveRecent(left, store);
    expect(loadRecent(store)).toEqual(left);
    store.setItem("fahh-roundtable-recent", "{nope");
    expect(loadRecent(store)).toEqual([]);
    const now = 10 * 86_400_000;
    expect([ago(now - 5_000, now), ago(now - 300_000, now), ago(now - 7_300_000, now), ago(now - 3 * 86_400_000, now)]).toEqual(["just now", "5m ago", "2h ago", "3d ago"]);
  });

  it("rejoins: the saved seat first, then by name, and says when a table ended or the server is away", async () => {
    const entry = recentEntry(seat, 1);
    const room = (members: Array<{ id: string }>) => (async (url: string) =>
      url.endsWith("/join") ? new Response(JSON.stringify({ member: { id: "m9", name: "Ana", token: "new" } }), { status: 200 }) : new Response(JSON.stringify({ members }), { status: 200 })) as unknown as typeof fetch;
    expect(await rejoinTable(entry, room([{ id: "m1" }]))).toEqual({ outcome: "seated", seat });
    const again = await rejoinTable(entry, room([]));
    expect(again).toEqual({ outcome: "rejoined", seat: { ...seat, member: { id: "m9", name: "Ana", token: "new" } } });
    const { token: _, ...noToken } = entry;
    expect((await rejoinTable(noToken, room([{ id: "m1" }]))).outcome).toBe("rejoined");
    const gone = (async () => new Response(JSON.stringify({ error: "No such room" }), { status: 404 })) as unknown as typeof fetch;
    expect(await rejoinTable(entry, gone)).toEqual({ outcome: "ended", message: "That table has ended (ABC12)." });
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(await rejoinTable(entry, down)).toEqual({ outcome: "offline", message: "Can't reach the server at http://h:4173." });
    const broken = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    expect((await rejoinTable(entry, broken)).outcome).toBe("error");
  });
});
