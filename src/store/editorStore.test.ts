import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "./editorStore";
import type { Document } from "../lib/types";

function doc(path: string, dirty = false): Document {
  return { path, language: "typescript", dirty };
}

/** zustand stores are module singletons — reset between tests. */
beforeEach(() => {
  useEditorStore.setState({ openTabs: [], activeTab: null, fileContents: {} });
});

const store = () => useEditorStore.getState();

describe("editorStore.openFile", () => {
  it("opens a file, activates it and stores its contents", () => {
    store().openFile(doc("/a.ts"), "const a = 1;");

    expect(store().openTabs).toHaveLength(1);
    expect(store().activeTab).toBe("/a.ts");
    expect(store().fileContents["/a.ts"]).toBe("const a = 1;");
  });

  it("does not duplicate a tab when the same file is opened twice", () => {
    store().openFile(doc("/a.ts"), "one");
    store().openFile(doc("/b.ts"), "two");
    store().openFile(doc("/a.ts"), "one again");

    expect(store().openTabs.map((t) => t.path)).toEqual(["/a.ts", "/b.ts"]);
    expect(store().activeTab).toBe("/a.ts");
    expect(store().fileContents["/a.ts"]).toBe("one again");
  });
});

describe("editorStore.closeFile", () => {
  it("removes the tab and its cached contents", () => {
    store().openFile(doc("/a.ts"), "one");
    store().closeFile("/a.ts");

    expect(store().openTabs).toEqual([]);
    expect(store().fileContents["/a.ts"]).toBeUndefined();
    expect(store().activeTab).toBeNull();
  });

  it("falls back to the last remaining tab when the active one is closed", () => {
    store().openFile(doc("/a.ts"), "one");
    store().openFile(doc("/b.ts"), "two");
    store().openFile(doc("/c.ts"), "three");

    store().closeFile("/c.ts"); // the active tab

    expect(store().activeTab).toBe("/b.ts");
  });

  it("leaves the active tab alone when a background tab is closed", () => {
    store().openFile(doc("/a.ts"), "one");
    store().openFile(doc("/b.ts"), "two");

    store().closeFile("/a.ts");

    expect(store().activeTab).toBe("/b.ts");
    expect(store().openTabs.map((t) => t.path)).toEqual(["/b.ts"]);
  });

  it("is a no-op for a file that was never open", () => {
    store().openFile(doc("/a.ts"), "one");
    store().closeFile("/nope.ts");
    expect(store().openTabs).toHaveLength(1);
  });
});

describe("editorStore content and dirty tracking", () => {
  it("updates content without touching the tab list", () => {
    store().openFile(doc("/a.ts"), "one");
    store().setContent("/a.ts", "edited");

    expect(store().fileContents["/a.ts"]).toBe("edited");
    expect(store().openTabs).toHaveLength(1);
  });

  it("marks only the named tab dirty", () => {
    store().openFile(doc("/a.ts"), "one");
    store().openFile(doc("/b.ts"), "two");

    store().markDirty("/a.ts", true);

    expect(store().openTabs.find((t) => t.path === "/a.ts")?.dirty).toBe(true);
    expect(store().openTabs.find((t) => t.path === "/b.ts")?.dirty).toBe(false);
  });

  it("clears the dirty flag after a save", () => {
    store().openFile(doc("/a.ts", true), "one");
    store().markDirty("/a.ts", false);
    expect(store().openTabs[0].dirty).toBe(false);
  });

  it("keeps state immutable — a new object is produced on every change", () => {
    store().openFile(doc("/a.ts"), "one");
    const before = store().fileContents;
    store().setContent("/a.ts", "two");
    expect(store().fileContents).not.toBe(before);
  });
});
