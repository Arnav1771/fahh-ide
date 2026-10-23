import { describe, expect, it } from "vitest";
import { canDrop, isUnder, languageFor, remapPath } from "./tabs";
import { ALWAYS_DIRTY, clearBaseline, ensureBaseline, isDirtyAt, setBaseline } from "./saveBaseline";
import { clampSize, loadSize, saveSize } from "./panelSize";
import { pushHistory, stepHistory } from "./termHistory";
import { detectShell, shellName } from "./shellCwd";
import { nextTabIndex } from "../hooks/useFocusTrap";

describe("tabs: path remapping", () => {
  it("moves the file itself and anything inside a renamed folder", () => {
    expect(remapPath("/p/a.ts", "/p/a.ts", "/p/b.ts")).toBe("/p/b.ts");
    expect(remapPath("/p/src/a.ts", "/p/src", "/p/lib")).toBe("/p/lib/a.ts");
    expect(remapPath("C:\\p\\src\\a.ts", "C:\\p\\src", "C:\\p\\lib")).toBe("C:\\p\\lib\\a.ts");
  });
  it("leaves siblings with a shared name prefix alone", () => {
    expect(remapPath("/p/src2/a.ts", "/p/src", "/p/lib")).toBeNull();
    expect(isUnder("/p/srcfile", "/p/src")).toBe(false);
    expect(isUnder("/p/src/", "/p/src/")).toBe(true);
  });
});

describe("saveBaseline: dirty tracks the saved version", () => {
  it("is clean again when undo returns to the saved version", () => {
    ensureBaseline("/a", 1, false);
    expect(isDirtyAt("/a", 1)).toBe(false);
    expect(isDirtyAt("/a", 2)).toBe(true); // typed
    expect(isDirtyAt("/a", 1)).toBe(false); // undone
    setBaseline("/a", 5); // saved at version 5
    expect(isDirtyAt("/a", 5)).toBe(false);
    expect(isDirtyAt("/a", 4)).toBe(true);
    clearBaseline("/a");
  });
  it("never matches for a tab that was already dirty, and treats unknown files as dirty", () => {
    ensureBaseline("/b", 1, true);
    expect(isDirtyAt("/b", 1)).toBe(true);
    expect(isDirtyAt("/b", ALWAYS_DIRTY)).toBe(false);
    ensureBaseline("/b", 9, false); // first one wins
    expect(isDirtyAt("/b", 9)).toBe(true);
    expect(isDirtyAt("/never-seen", 1)).toBe(true);
  });
});

describe("panelSize", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it("clamps, even when max < min", () => {
    expect(clampSize(10, 100, 500)).toBe(100);
    expect(clampSize(900, 100, 500)).toBe(500);
    expect(clampSize(250.4, 100, 500)).toBe(250);
    expect(clampSize(300, 100, 50)).toBe(100);
  });
  it("persists and reloads, clamped to the current limits", () => {
    const s = mem();
    saveSize("k", 321, s);
    expect(loadSize("k", 200, 100, 500, s)).toBe(321);
    expect(loadSize("k", 200, 100, 300, s)).toBe(300);
  });
  it("falls back to the default for missing, junk or blocked storage", () => {
    const s = mem();
    expect(loadSize("none", 200, 100, 500, s)).toBe(200);
    s.setItem("bad", "abc");
    expect(loadSize("bad", 200, 100, 500, s)).toBe(200);
    expect(loadSize("k", 200, 100, 500, undefined)).toBe(200);
    const blocked = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } };
    expect(loadSize("k", 200, 100, 500, blocked)).toBe(200);
    expect(() => saveSize("k", 1, blocked)).not.toThrow();
  });
});

describe("termHistory", () => {
  it("skips blanks and immediate repeats", () => {
    expect(pushHistory(pushHistory(pushHistory([], "ls"), "ls"), "  ")).toEqual(["ls"]);
    expect(pushHistory(["ls"], "pwd")).toEqual(["ls", "pwd"]);
  });
  it("caps at 100 entries", () => {
    let h: string[] = [];
    for (let i = 0; i < 150; i++) h = pushHistory(h, `c${i}`);
    expect(h).toHaveLength(100);
    expect(h[99]).toBe("c149");
  });
  it("walks up and back down to the draft", () => {
    const h = ["a", "b"];
    expect(stepHistory(h, 2, "up", "typing")).toEqual({ idx: 1, value: "b" });
    expect(stepHistory(h, 1, "up", "typing")).toEqual({ idx: 0, value: "a" });
    expect(stepHistory(h, 0, "up", "typing")).toBeNull();
    expect(stepHistory(h, 0, "down", "typing")).toEqual({ idx: 1, value: "b" });
    expect(stepHistory(h, 1, "down", "typing")).toEqual({ idx: 2, value: "typing" });
    expect(stepHistory(h, 2, "down", "typing")).toBeNull();
    expect(stepHistory([], 0, "up", "")).toBeNull();
  });
});

describe("shell name", () => {
  it("is cmd on Windows and sh elsewhere", () => {
    expect(shellName(detectShell("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"))).toBe("cmd");
    expect(shellName(detectShell("Mozilla/5.0 (X11; Linux x86_64)"))).toBe("sh");
  });
});

describe("focus trap order", () => {
  it("wraps at both ends", () => {
    expect(nextTabIndex(2, 3, false)).toBe(0);
    expect(nextTabIndex(0, 3, true)).toBe(2);
    expect(nextTabIndex(1, 3, false)).toBe(2);
    expect(nextTabIndex(-1, 3, true)).toBe(2);
    expect(nextTabIndex(0, 0, false)).toBe(-1);
  });
});

describe("tabs: explorer drag and drop", () => {
  it("drops into another folder, never onto itself, into itself, or where it already is", () => {
    expect(canDrop("/p/src/a.ts", "/p/lib")).toBe(true);
    expect(canDrop("/p/src", "/p/lib")).toBe(true);
    expect(canDrop("/p/src", "/p/src")).toBe(false);
    expect(canDrop("/p/src", "/p/src/inner")).toBe(false);
    expect(canDrop("/p/src/a.ts", "/p/src")).toBe(false);
    expect(canDrop("C:\\w\\a.ts", "C:\\w\\sub")).toBe(true);
    expect(canDrop("C:\\w\\a.ts", "C:\\w")).toBe(false);
  });
  it("languageFor maps extensions", () => {
    expect(languageFor("/a/b.tsx")).toBe("typescript");
    expect(languageFor("/a/B.PY")).toBe("python");
    expect(languageFor("/a/Makefile")).toBe("plaintext");
  });
});
