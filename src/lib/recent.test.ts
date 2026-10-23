import { describe, expect, it } from "vitest";
import { RECENT_KEY, RECENT_MAX, addRecent, clearRecent, loadRecent, withRecent } from "./recent";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe("Open Recent", () => {
  it("lists newest first, moves a reopened entry to the top, and keeps ten", () => {
    const s = memory();
    addRecent({ path: "/a", kind: "folder" }, s);
    addRecent({ path: "/b.code-workspace", kind: "workspace" }, s);
    addRecent({ path: "/a", kind: "folder" }, s);
    expect(loadRecent(s).map((e) => e.path)).toEqual(["/a", "/b.code-workspace"]);
    for (let i = 0; i < 15; i++) addRecent({ path: `/f${i}`, kind: "folder" }, s);
    const list = loadRecent(s);
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0].path).toBe("/f14");
  });
  it("persists across loads and clears", () => {
    const s = memory();
    addRecent({ path: "/a", kind: "folder" }, s);
    expect(loadRecent(s)).toEqual([{ path: "/a", kind: "folder" }]);
    clearRecent(s);
    expect(loadRecent(s)).toEqual([]);
  });
  it("drops damaged data and bad entries", () => {
    const s = memory();
    s.setItem(RECENT_KEY, "{oops");
    expect(loadRecent(s)).toEqual([]);
    s.setItem(RECENT_KEY, JSON.stringify([{ path: "/ok", kind: "folder" }, { path: 3, kind: "folder" }, { path: "/x", kind: "drive" }, null]));
    expect(loadRecent(s)).toEqual([{ path: "/ok", kind: "folder" }]);
    expect(loadRecent(undefined)).toEqual([]);
  });
  it("withRecent is pure", () => {
    const before = [{ path: "/a", kind: "folder" as const }];
    expect(withRecent(before, { path: "/b", kind: "folder" }).map((e) => e.path)).toEqual(["/b", "/a"]);
    expect(before).toHaveLength(1);
  });
});
