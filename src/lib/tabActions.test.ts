import { beforeEach, describe, expect, it, vi } from "vitest";

const writeFile = vi.fn();
vi.mock("./tauri", () => ({ writeFile: (...a: unknown[]) => writeFile(...a) }));

import { useEditorStore } from "../store/editorStore";
import { useToastStore } from "../store/toastStore";
import { closeTabsUnder, dirtyPaths, renameTabs, requestClose, saveActive, unsavedMessage } from "./tabActions";

const doc = (path: string, dirty = false) => ({ path, language: "typescript", dirty });
const confirm = vi.fn();

beforeEach(() => {
  vi.stubGlobal("window", { confirm });
  useEditorStore.setState({ openTabs: [], activeTab: null, fileContents: {} });
  useToastStore.setState({ toasts: [] });
  writeFile.mockReset();
  confirm.mockReset();
});

const tabs = () => useEditorStore.getState().openTabs.map((t) => t.path);

describe("requestClose", () => {
  it("closes a clean tab without asking", () => {
    useEditorStore.getState().openFile(doc("/a.ts"), "x");
    expect(requestClose("/a.ts")).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(tabs()).toEqual([]);
  });
  it("keeps a dirty tab open when the user says no, closes it on yes", () => {
    useEditorStore.getState().openFile(doc("/a.ts", true), "x");
    confirm.mockReturnValueOnce(false);
    expect(requestClose("/a.ts")).toBe(false);
    expect(tabs()).toEqual(["/a.ts"]);
    confirm.mockReturnValueOnce(true);
    expect(requestClose("/a.ts")).toBe(true);
    expect(tabs()).toEqual([]);
  });
});

describe("rename and delete keep tabs in sync", () => {
  it("rename moves the tab, its contents and the active pointer", () => {
    const s = useEditorStore.getState();
    s.openFile(doc("/p/a.ts", true), "unsaved");
    s.openFile(doc("/p/src/b.ts"), "b");
    renameTabs("/p/a.ts", "/p/z.ts");
    const st = useEditorStore.getState();
    expect(st.openTabs.map((t) => [t.path, t.dirty])).toEqual([["/p/z.ts", true], ["/p/src/b.ts", false]]);
    expect(st.fileContents["/p/z.ts"]).toBe("unsaved");
    expect(st.fileContents["/p/a.ts"]).toBeUndefined();
    renameTabs("/p/src", "/p/lib");
    expect(tabs()).toEqual(["/p/z.ts", "/p/lib/b.ts"]);
    expect(useEditorStore.getState().activeTab).toBe("/p/lib/b.ts");
  });
  it("delete closes the file and everything under a deleted folder", () => {
    const s = useEditorStore.getState();
    s.openFile(doc("/p/a.ts"), "a");
    s.openFile(doc("/p/src/b.ts"), "b");
    s.openFile(doc("/p/src2/c.ts"), "c");
    closeTabsUnder("/p/src");
    expect(tabs()).toEqual(["/p/a.ts", "/p/src2/c.ts"]);
  });
  it("dirtyPaths can be scoped to a folder", () => {
    const s = useEditorStore.getState();
    s.openFile(doc("/p/a.ts", true), "a");
    s.openFile(doc("/p/src/b.ts", true), "b");
    expect(dirtyPaths()).toHaveLength(2);
    expect(dirtyPaths("/p/src")).toEqual(["/p/src/b.ts"]);
  });
});

describe("unsavedMessage (window close)", () => {
  it("is null when nothing is dirty, and names the files otherwise", () => {
    useEditorStore.getState().openFile(doc("/p/a.ts"), "a");
    expect(unsavedMessage()).toBeNull();
    useEditorStore.getState().openFile(doc("/p/b.ts", true), "b");
    expect(unsavedMessage()).toContain("b.ts");
  });
});

describe("saveActive", () => {
  it("writes the active file, clears dirty and toasts", async () => {
    writeFile.mockResolvedValue(undefined);
    useEditorStore.getState().openFile(doc("/p/a.ts", true), "new text");
    expect(await saveActive()).toBe(true);
    expect(writeFile).toHaveBeenCalledWith("/p/a.ts", "new text");
    expect(useEditorStore.getState().openTabs[0].dirty).toBe(false);
    expect(useToastStore.getState().toasts[0].text).toBe("Saved a.ts");
  });
  it("keeps the tab dirty and shows an error toast when the write fails", async () => {
    writeFile.mockRejectedValue("disk full");
    useEditorStore.getState().openFile(doc("/p/a.ts", true), "t");
    expect(await saveActive()).toBe(false);
    expect(useEditorStore.getState().openTabs[0].dirty).toBe(true);
    expect(useToastStore.getState().toasts[0]).toMatchObject({ kind: "error" });
  });
  it("does nothing with no file open", async () => {
    expect(await saveActive()).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
