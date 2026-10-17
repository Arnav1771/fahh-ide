import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterSlash, groupSlash, insertion, menuQuery, parseMode, parseSlash, SLASH_COMMANDS } from "./slash";

describe("parseSlash", () => {
  it("resolves names, aliases and arguments", () => {
    expect(parseSlash("/plan fix the bug")).toEqual({ name: "plan", arg: "fix the bug" });
    expect(parseSlash("  /YOLO go ")).toEqual({ name: "bypass", arg: "go" });
    expect(parseSlash("/dangerous")).toEqual({ name: "bypass", arg: "" });
    expect(parseSlash("/new")).toEqual({ name: "clear", arg: "" });
    expect(parseSlash("/list-sessions")).toEqual({ name: "ls", arg: "" });
    expect(parseSlash("/rename-session My title")).toEqual({ name: "title", arg: "My title" });
    expect(parseSlash("/ask\nwhat is x")).toEqual({ name: "ask", arg: "what is x" });
  });

  it("leaves normal prompts alone and reports unknown commands", () => {
    expect(parseSlash("fix it")).toBeNull();
    expect(parseSlash("/")).toBeNull();
    expect(parseSlash("/usr/bin/env python")).toBeNull();
    expect(parseSlash("/nope")).toMatch(/Unknown command \/nope/);
  });
});

describe("the menu", () => {
  it("opens only while the input is a single /word", () => {
    expect(menuQuery("/")).toBe("");
    expect(menuQuery("/pl")).toBe("pl");
    expect(menuQuery("/plan ")).toBeNull();
    expect(menuQuery("hello /pl")).toBeNull();
    expect(menuQuery("/usr/bin")).toBeNull();
  });

  it("filters by prefix first, then by description", () => {
    expect(filterSlash("/").length).toBe(SLASH_COMMANDS.length);
    expect(filterSlash("/pl")[0].name).toBe("plan");
    expect(filterSlash("yo").map((d) => d.name)).toContain("bypass"); // alias prefix
    const loop = filterSlash("rev").map((d) => d.name);
    expect(loop[0]).toBe("revert");
    expect(filterSlash("zzzz")).toEqual([]);
  });

  it("groups like the CLI help, Session first", () => {
    const g = groupSlash(SLASH_COMMANDS);
    expect(g.map((x) => x.group)).toEqual(["Session", "Workspace", "Help"]);
    const session = g[0].items.map((d) => d.name);
    for (const n of ["model", "mode", "ask", "plan", "code", "smart", "bypass", "compact", "context", "fast", "loop"]) expect(session).toContain(n);
  });

  it("inserts a trailing space only for commands that take arguments", () => {
    expect(insertion(SLASH_COMMANDS.find((d) => d.name === "plan")!)).toBe("/plan ");
    expect(insertion(SLASH_COMMANDS.find((d) => d.name === "compact")!)).toBe("/compact");
  });

  it("every entry has an icon and a description", () => {
    for (const d of SLASH_COMMANDS) {
      expect(d.icon).toBeTruthy();
      expect(d.desc).toBeTruthy();
    }
  });
});

describe("docs", () => {
  it("IMP_DOCS/FAHH_LOCAL.md lists every command and alias", () => {
    const md = readFileSync(new URL("../../IMP_DOCS/FAHH_LOCAL.md", import.meta.url), "utf8");
    for (const d of SLASH_COMMANDS) {
      expect(md, `/${d.name}`).toContain(`\`/${d.name}`);
      for (const a of d.aliases) expect(md, `/${a}`).toContain(`/${a}`);
    }
  });
});

describe("parseMode", () => {
  it("knows the Devin names and aliases", () => {
    expect(parseMode("normal")).toBe("ask");
    expect(parseMode("accept-edits")).toBe("auto-edit");
    expect(parseMode("Smart")).toBe("smart");
    expect(parseMode("yolo")).toBe("bypass");
    expect(parseMode("nope")).toBeNull();
  });
});
