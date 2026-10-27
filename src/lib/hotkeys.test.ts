import { describe, expect, it } from "vitest";
import { debugKeyAction, isAgentToggle, keepsOwnCtrlL, matchesKeys } from "./hotkeys";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

/** A stand-in for a DOM element: closest() answers true for the listed selectors' classes. */
const inside = (...classes: string[]) => ({ closest: (sel: string) => (classes.some((c) => sel.includes(c)) ? {} : null) });

describe("Fahh Local toggle shortcut", () => {
  it("Ctrl+L toggles from anywhere outside the editor and terminal", () => {
    expect(isAgentToggle(key("l", { ctrlKey: true }), inside())).toBe(true);
    expect(isAgentToggle(key("L", { ctrlKey: true }), null)).toBe(true);
    expect(isAgentToggle(key("l", { metaKey: true }), inside("file-tree"))).toBe(true);
  });

  it("Ctrl+L inside Monaco keeps its meaning (select line)", () => {
    expect(keepsOwnCtrlL(inside(".monaco-editor"))).toBe(true);
    expect(isAgentToggle(key("l", { ctrlKey: true }), inside(".monaco-editor"))).toBe(false);
  });

  it("Ctrl+L inside the terminal keeps its meaning (clear screen)", () => {
    expect(isAgentToggle(key("l", { ctrlKey: true }), inside(".xterm"))).toBe(false);
  });

  it("Ctrl+Shift+A toggles everywhere, editor included", () => {
    expect(isAgentToggle(key("a", { ctrlKey: true, shiftKey: true }), inside(".monaco-editor"))).toBe(true);
    expect(isAgentToggle(key("A", { ctrlKey: true, shiftKey: true }), inside(".xterm"))).toBe(true);
    expect(isAgentToggle(key("a", { metaKey: true, shiftKey: true }), null)).toBe(true);
  });

  it("ignores everything else", () => {
    expect(isAgentToggle(key("l"), null)).toBe(false); // no modifier
    expect(isAgentToggle(key("a", { ctrlKey: true }), null)).toBe(false); // Ctrl+A is select all
    expect(isAgentToggle(key("l", { ctrlKey: true, shiftKey: true }), null)).toBe(false);
    expect(isAgentToggle(key("l", { ctrlKey: true, altKey: true }), null)).toBe(false);
    expect(isAgentToggle(key("p", { ctrlKey: true, shiftKey: true }), null)).toBe(false);
  });
});

describe("view shortcuts", () => {
  it("matches written shortcuts exactly", () => {
    expect(matchesKeys(key("E", { ctrlKey: true, shiftKey: true }), "Ctrl+Shift+E")).toBe(true);
    expect(matchesKeys(key("e", { metaKey: true, shiftKey: true }), "Ctrl+Shift+E")).toBe(true);
    expect(matchesKeys(key("e", { ctrlKey: true }), "Ctrl+Shift+E")).toBe(false);
    expect(matchesKeys(key("e", { ctrlKey: true, shiftKey: true, altKey: true }), "Ctrl+Shift+E")).toBe(false);
    expect(matchesKeys(key(",", { ctrlKey: true }), "Ctrl+,")).toBe(true);
    expect(matchesKeys(key("F9"), "F9")).toBe(true);
  });
});

describe("debug keys", () => {
  it("F5 starts or continues; Shift+F5 stops and Ctrl+Shift+F5 restarts only while debugging", () => {
    expect(debugKeyAction(key("F5"), false)).toBe("startOrContinue");
    expect(debugKeyAction(key("F5", { shiftKey: true }), false)).toBeNull();
    expect(debugKeyAction(key("F5", { shiftKey: true }), true)).toBe("stop");
    expect(debugKeyAction(key("F5", { ctrlKey: true, shiftKey: true }), true)).toBe("restart");
    expect(debugKeyAction(key("F5", { ctrlKey: true }), true)).toBeNull();
  });

  it("stepping keys act only during a session", () => {
    expect(debugKeyAction(key("F10"), false)).toBeNull();
    expect(debugKeyAction(key("F10"), true)).toBe("stepOver");
    expect(debugKeyAction(key("F11"), true)).toBe("stepInto");
    expect(debugKeyAction(key("F11", { shiftKey: true }), true)).toBe("stepOut");
    expect(debugKeyAction(key("F6"), true)).toBe("pause");
  });

  it("F9 toggles a breakpoint any time", () => {
    expect(debugKeyAction(key("F9"), false)).toBe("toggleBreakpoint");
  });
});
