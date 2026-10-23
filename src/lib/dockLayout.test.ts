import { describe, expect, it } from "vitest";
import { clearViews, getView, listViews, registerView } from "./viewRegistry";
import { decodeLayout, editorsToHome, encodeLayout, isDiskPath, layoutKey, legacySizes, savedEditorPaths, zoneFor } from "./dockLayout";

const dock = () => ({
  grid: {
    width: 1000,
    height: 600,
    orientation: "HORIZONTAL",
    root: {
      type: "branch",
      data: [
        { type: "leaf", size: 240, data: { id: "g1", views: ["v:explorer", "v:git"], activeView: "v:git" } },
        { type: "leaf", size: 600, data: { id: "g2", views: ["ed:/a.ts", "ed:/b.ts", "ed:/c.ts"], activeView: "ed:/b.ts" } },
        { type: "leaf", size: 160, data: { id: "g3", views: ["ed:/d.ts", "v:terminal"], activeView: "ed:/d.ts" } },
      ],
    },
  },
  panels: {
    "v:explorer": { id: "v:explorer", contentComponent: "view", params: { viewId: "explorer" } },
    "v:git": { id: "v:git", contentComponent: "view", params: { viewId: "git" } },
    "v:terminal": { id: "v:terminal", contentComponent: "view", params: { viewId: "terminal" } },
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
    expect(getView("a")?.defaultLocation).toBe("secondary");
    expect(getView("nope")).toBeUndefined();
  });
});

describe("layout serialization", () => {
  it("round-trips with the editor tabs (files on disk) in their groups", () => {
    const back = decodeLayout(encodeLayout(dock(), { hidden: { primary: ["g1"] } }))!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const leaves = back.dock.grid.root.data.map((n: any) => n.data.views);
    expect(leaves).toEqual([["v:explorer", "v:git"], ["ed:/a.ts", "ed:/b.ts", "ed:/c.ts"], ["ed:/d.ts", "v:terminal"]]);
    expect(back.dock.grid.root.data[1].data.activeView).toBe("ed:/b.ts");
    expect(back.dock.floatingGroups).toBeUndefined();
    expect(savedEditorPaths(back.dock)).toEqual(["/a.ts", "/b.ts", "/c.ts", "/d.ts"]);
  });
  it("never saves an untitled buffer (it has no file to come back from)", () => {
    const d = dock();
    d.grid.root.data[1].data.views.push("ed:untitled-1.ts");
    Object.assign(d.panels, { "ed:untitled-1.ts": { id: "ed:untitled-1.ts", contentComponent: "editor", params: { path: "untitled-1.ts" } } });
    const back = decodeLayout(encodeLayout(d, { hidden: {} }))!;
    expect(back.dock.panels["ed:untitled-1.ts"]).toBeUndefined();
    expect(back.dock.grid.root.data[1].data.views).toEqual(["ed:/a.ts", "ed:/b.ts", "ed:/c.ts"]); // no placeholder beside real tabs
    expect(isDiskPath("untitled-1.ts")).toBe(false);
    expect(isDiskPath("C:\\w\\a.ts")).toBe(true);
  });
  it("restoring: tabs whose files are gone become placeholders, the rest stay put", () => {
    const back = editorsToHome(dock(), (p) => p === "/b.ts");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const leaves = back.grid.root.data.map((n: any) => n.data.views);
    expect(leaves[1]).toEqual(["ed:/b.ts"]);
    expect(leaves[2][0]).toMatch(/^home:/);
    expect(leaves[2][1]).toBe("v:terminal");
  });
  it("turns every editor into one Welcome placeholder per group when nothing is kept", () => {
    const back = decodeLayout(JSON.stringify({ v: 2, dock: editorsToHome(dock()), extras: { hidden: { primary: ["g1"] } } }))!;
    expect(back.extras.hidden).toEqual({ primary: ["g1"] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const leaves = back.dock.grid.root.data.map((n: any) => n.data.views);
    expect(leaves[0]).toEqual(["v:explorer", "v:git"]);
    expect(leaves[1]).toHaveLength(1);
    expect(leaves[1][0]).toMatch(/^home:/);
    // A view dragged into an editor group stays there, next to the placeholder.
    expect(leaves[2][0]).toMatch(/^home:/);
    expect(leaves[2][1]).toBe("v:terminal");
    expect(leaves[1][0]).not.toBe(leaves[2][0]);
    for (const l of leaves.flat()) expect(back.dock.panels[l]).toBeDefined();
    expect(Object.keys(back.dock.panels).sort()).toEqual(leaves.flat().sort());
    expect(back.dock.grid.root.data[0].data.activeView).toBe("v:git");
    expect(back.dock.grid.root.data[1].data.activeView).toBe(leaves[1][0]);
    expect(back.dock.floatingGroups).toBeUndefined();
    expect(back.dock.activeGroup).toBe("g2");
  });
  it("is stable when encoded twice and leaves the input alone", () => {
    const d = dock();
    const once = encodeLayout(d, { hidden: {} });
    expect(d.panels["ed:/a.ts"].contentComponent).toBe("editor");
    expect(encodeLayout(decodeLayout(once)!.dock, { hidden: {} })).toBe(once);
    expect(editorsToHome(d).panels["ed:/a.ts"]).toBeUndefined();
    expect(d.panels["ed:/a.ts"]).toBeDefined();
    expect(editorsToHome(editorsToHome(d))).toEqual(editorsToHome(d));
  });
  it("falls back to the default for damaged, empty or other-version data", () => {
    expect(decodeLayout(null)).toBeNull();
    expect(decodeLayout("")).toBeNull();
    expect(decodeLayout("{nope")).toBeNull();
    expect(decodeLayout("null")).toBeNull();
    expect(decodeLayout(JSON.stringify({ v: 1, dock: dock() }))).toBeNull();
    expect(decodeLayout(JSON.stringify({ v: 2, dock: { grid: {} } }))).toBeNull();
  });
  it("tolerates missing or bad extras", () => {
    const raw = JSON.parse(encodeLayout(dock(), { hidden: {} }));
    expect(decodeLayout(JSON.stringify({ ...raw, extras: undefined }))!.extras).toEqual({ hidden: {} });
    expect(decodeLayout(JSON.stringify({ ...raw, extras: { hidden: 7 } }))!.extras).toEqual({ hidden: {} });
  });
});

describe("persistence per workspace", () => {
  it("keys layouts per workspace root, with one key for no folder", () => {
    expect(layoutKey("/w/a")).not.toBe(layoutKey("/w/b"));
    expect(layoutKey(null)).toBe(layoutKey(null));
    expect(layoutKey(null)).not.toBe(layoutKey("/w/a"));
  });
  it("saves and restores through storage", () => {
    const m = new Map<string, string>();
    m.set(layoutKey("/w/a"), encodeLayout(dock(), { hidden: { panel: ["g3"] } }));
    expect(decodeLayout(m.get(layoutKey("/w/a")))?.extras.hidden).toEqual({ panel: ["g3"] });
    expect(decodeLayout(m.get(layoutKey("/w/b")))).toBeNull(); // a new workspace starts from the default
  });
});

describe("the pre-dock bar sizes", () => {
  it("are read, clamped, or defaulted", () => {
    const s = (m: Record<string, string>) => ({ getItem: (k: string) => m[k] ?? null });
    expect(legacySizes(s({ "fahh-sidebar-w": "300", "fahh-bottom-h": "150" }))).toEqual({ sidebar: 300, bottom: 150 });
    expect(legacySizes(s({ "fahh-sidebar-w": "9999" })).sidebar).toBe(560);
    expect(legacySizes(s({}))).toEqual({ sidebar: 240, bottom: 208 });
  });
});

describe("zoneFor", () => {
  const ed = { left: 240, right: 900, top: 0, bottom: 400 };
  it("classifies a group by where it sits next to the editors", () => {
    expect(zoneFor({ left: 0, right: 240, top: 0, bottom: 600 }, ed)).toBe("primary");
    expect(zoneFor({ left: 900, right: 1100, top: 0, bottom: 600 }, ed)).toBe("secondary");
    expect(zoneFor({ left: 240, right: 900, top: 400, bottom: 600 }, ed)).toBe("panel");
    expect(zoneFor({ left: 300, right: 500, top: 100, bottom: 200 }, ed)).toBe("editor");
    expect(zoneFor({ left: 0, right: 10, top: 0, bottom: 10 }, null)).toBe("primary");
  });
});
