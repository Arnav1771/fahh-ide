import { beforeEach, describe, expect, it, vi } from "vitest";

const writeFile = vi.fn();
vi.mock("./tauri", () => ({ writeFile: (...a: unknown[]) => writeFile(...a) }));

import { useEditorStore } from "../store/editorStore";
import { useToastStore } from "../store/toastStore";
import { useDialogStore } from "../store/dialogStore";
import {
  closeTabsUnder,
  dirtyPaths,
  rememberClosed,
  renameTabs,
  requestClose,
  requestCloseMany,
  saveActive,
  takeClosed,
  unsavedMessage,
} from "./tabActions";

const doc = (path: string, dirty = false) => ({ path, language: "typescript", dirty });

beforeEach(() => {
  useEditorStore.setState({ openTabs: [], activeTab: null, fileContents: {} });
  useToastStore.setState({ toasts: [] });
  useDialogStore.setState({ queue: [] });
  writeFile.mockReset();
  while (takeClosed());
});

const tabs = () => useEditorStore.getState().openTabs.map((t) => t.path);
const dialog = () => useDialogStore.getState().queue[0];
const tick = () => new Promise((r) => setTimeout(r, 0));
/** Press a button of the dialog on screen. */
const press = (button: string | null) => useDialogStore.getState().answer(dialog().id, { button });

describe("requestClose", () => {
  it("closes a clean tab without asking", async () => {
    useEditorStore.getState().openFile(doc("/a.ts"), "x");
    expect(await requestClose("/a.ts")).toBe(true);
    expect(dialog()).toBeUndefined();
    expect(tabs()).toEqual([]);
  });
  it("asks about a dirty tab: Cancel and Esc keep it, Don't Save closes it", async () => {
    useEditorStore.getState().openFile(doc("/p/a.ts", true), "x");
    let p = requestClose("/p/a.ts");
    await tick();
    expect(dialog().title).toBe("Save changes to a.ts?");
    expect(dialog().buttons.map((b) => b.value)).toEqual(["save", "discard", "cancel"]);
    press("cancel");
    expect(await p).toBe(false);
    p = requestClose("/p/a.ts");
    await tick();
    press(null); // Esc
    expect(await p).toBe(false);
    expect(tabs()).toEqual(["/p/a.ts"]);
    p = requestClose("/p/a.ts");
    await tick();
    press("discard");
    expect(await p).toBe(true);
    expect(tabs()).toEqual([]);
    expect(writeFile).not.toHaveBeenCalled();
  });
  it("Save writes the file first, then closes; a failed save keeps the tab", async () => {
    const s = useEditorStore.getState();
    s.openFile(doc("/p/a.ts", true), "mine");
    s.openFile(doc("/p/b.ts"), "b"); // a.ts is not the active tab
    writeFile.mockResolvedValueOnce(undefined);
    let p = requestClose("/p/a.ts");
    await tick();
    press("save");
    expect(await p).toBe(true);
    expect(writeFile).toHaveBeenCalledWith("/p/a.ts", "mine");
    s.openFile(doc("/p/c.ts", true), "c");
    useEditorStore.getState().setActiveTab("/p/b.ts");
    writeFile.mockRejectedValueOnce("read-only");
    p = requestClose("/p/c.ts");
    await tick();
    press("save");
    expect(await p).toBe(false);
    expect(tabs()).toContain("/p/c.ts");
  });
  it("asks once for several files, and offers no Save for an untitled buffer", async () => {
    const s = useEditorStore.getState();
    s.openFile(doc("/p/a.ts", true), "a");
    s.openFile(doc("/p/b.ts", true), "b");
    s.openFile(doc("/p/c.ts"), "c");
    s.openFile(doc("untitled-1.ts", true), "u");
    const p = requestCloseMany(["/p/a.ts", "/p/b.ts", "/p/c.ts", "untitled-1.ts"]);
    await tick();
    expect(useDialogStore.getState().queue).toHaveLength(1);
    expect(dialog().title).toBe("Save changes to 3 files?");
    expect(dialog().buttons.map((b) => b.value)).toEqual(["discard", "cancel"]);
    press("discard");
    expect(await p).toBe(true);
    expect(tabs()).toEqual([]);
  });
});

describe("recently closed (Ctrl+Shift+T)", () => {
  it("returns the newest closed file that is not open again, and skips untitled buffers", async () => {
    rememberClosed(["/p/a.ts", "/p/b.ts", "untitled-9.ts"]);
    rememberClosed(["/p/a.ts"]); // closed again: newest now
    useEditorStore.getState().openFile(doc("/p/a.ts"), "a"); // ...but reopened by hand
    expect(takeClosed()).toBe("/p/b.ts");
    expect(takeClosed()).toBeUndefined();
  });
  it("is fed by closing tabs", async () => {
    useEditorStore.getState().openFile(doc("/p/x.ts"), "x");
    await requestClose("/p/x.ts");
    expect(takeClosed()).toBe("/p/x.ts");
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
