import { describe, expect, it } from "vitest";
import { clearViews, getView, listViews, registerView } from "./viewRegistry";
import { decodeLayout, editorsToHome, encodeLayout, layoutKey, legacySizes, zoneFor } from "./dockLayout";

const dock = () => ({
  grid: {
    width: 1000,
    height: 600,
    orientation: "HORIZONTAL",
    root: {
      type: "branch",
      data: [
        { type: "leaf", size: 240, data: { id: "g1", views: ["explorer", "git"], activeView: "git" } },
        { type: "leaf", size: 600, data: { id: "g2", views: ["ed:/a.ts", "ed:/b.ts", "ed:/c.ts"], activeView: "ed:/b.ts" } },
        { type: "leaf", size: 160, data: { id: "g3", views: ["ed:/d.ts"], activeView: "ed:/d.ts" } },
      ],
    },
  },
  panels: {
    explorer: { id: "explorer", contentComponent: "view", params: { viewId: "explorer" } },
    git: { id: "git", contentComponent: "view", params: { viewId: "git" } },
    "ed:/a.ts": { id: "ed:/a.ts", contentComponent: "editor", params: { path: "/a.ts" } },
    "ed:/b.ts": { id: "ed:/b.ts", contentComponent: "editor", params: { path: "/b.ts" } },
    "ed:/c.ts": { id: "ed:/c.ts", contentComponent: "editor", params: { path: "/c.ts" } },
    "ed:/d.ts": { id: "ed:/d.ts", contentComponent: "editor", params: { path: "/d.ts" } },
  },
  activeGroup: "g2",
  floatingGroups: [{}],
});

describe("view registry", () => {
  const C = () => null;
  it("registers, replaces by id and lists in order", () => {
    clearViews();
    registerView({ id: "a", title: "A", icon: C, component: C, defaultLocation: "sidebar" });
    registerView({ id: "b", title: "B", icon: C, component: C, defaultLocation: "panel" });
    registerView({ id: "a", title: "A2", icon: C, component: C, defaultLocation: "secondary" });
    expect(listViews().map((v) => v.id)).toEqual(["a", "b"]);
    expect(getView("a")?.title).toBe("A2");
    expect(getView("nope")).toBeUndefined();
  });
});

describe("layout serialization", () => {
  it("round-trips, turning editors into one Welcome placeholder per group", () => {
    const back = decodeLayout(encodeLayout(dock(), { hidden: { primary: ["g1"] } }))!;
    expect(back.extras.hidden).toEqual({ primary: ["g1"] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const leaves = back.dock.grid.root.data.map((n: any) => n.data.views);
    expect(leaves[0]).toEqual(["explorer", "git"]);
    expect(leaves[1]).toHaveLength(1);
    expect(leaves[1][0]).toMatch(/^home:/);
    expect(leaves[2][0]).toMatch(/^home:/);
    expect(leaves[1][0]).not.toBe(leaves[2][0]);
    for (const l of leaves.flat()) expect(back.dock.panels[l]).toBeDefined();
    expect(Object.keys(back.dock.panels).sort()).toEqual(["explorer", "git", ...leaves.slice(1).flat()].sort());
    expect(back.dock.grid.root.data[0].data.activeView).toBe("git");
    expect(back.dock.floatingGroups).toBeUndefined();
    expect(back.dock.activeGroup).toBe("g2");
  });
  it("is stable when encoded twice and leaves the input alone", () => {
    const d = dock();
    const once = encodeLayout(d, { hidden: {} });
    expect(d.panels["ed:/a.ts"].contentComponent).toBe("editor");
    expect(encodeLayout(decodeLayout(once)!.dock, { hidden: {} })).toBe(once);
    expect(editorsToHome(editorsToHome(d))).toEqual(editorsToHome(d));
  });
  it("falls back to the default for damaged, empty or other-version data", () => {
    expect(decodeLayout(null)).toBeNull();
    expect(decodeLayout("{nope")).toBeNull();
    expect(decodeLayout(JSON.stringify({ v: 1, dock: dock() }))).toBeNull();
    expect(decodeLayout(JSON.stringify({ v: 2, dock: { grid: {} } }))).toBeNull();
  });
  it("keys layouts per workspace", () => {
    expect(layoutKey("/w/a")).not.toBe(layoutKey("/w/b"));
    expect(layoutKey(null)).toBe(layoutKey(null));
  });
});

describe("migration of the v0.5.1 sizes", () => {
  it("reads the old bar sizes, clamped, or the defaults", () => {
    const s = (m: Record<string, string>) => ({ getItem: (k: string) => m[k] ?? null });
    expect(legacySizes(s({ "fahh-sidebar-w": "300", "fahh-bottom-h": "150" }))).toEqual({ sidebar: 300, bottom: 150 });
    expect(legacySizes(s({ "fahh-sidebar-w": "9999" })).sidebar).toBe(560);
    expect(legacySizes(s({}))).toEqual({ sidebar: 240, bottom: 208 });
  });
});

describe("zoneFor", () => {
  const ed = { left: 240, right: 900, top: 0, bottom: 400 };
  it("classifies by position next to the editors", () => {
    expect(zoneFor({ left: 0, right: 240, top: 0, bottom: 600 }, ed)).toBe("primary");
    expect(zoneFor({ left: 900, right: 1100, top: 0, bottom: 600 }, ed)).toBe("secondary");
    expect(zoneFor({ left: 240, right: 900, top: 400, bottom: 600 }, ed)).toBe("panel");
    expect(zoneFor({ left: 300, right: 500, top: 100, bottom: 200 }, ed)).toBe("editor");
    expect(zoneFor({ left: 0, right: 10, top: 0, bottom: 10 }, null)).toBe("primary");
  });
});
