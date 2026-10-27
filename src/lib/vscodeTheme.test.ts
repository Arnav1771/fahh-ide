import { describe, it, expect } from "vitest";
import { convertVsCodeTheme, tokensForScope } from "./vscodeTheme";

const NIGHT_OWL = `{
  // a VS Code theme, comments allowed
  "name": "Night Owl",
  "include": "./base.json",
  "colors": {
    "editor.background": "#011627",
    "sideBar.background": "#011627",
    "focusBorder": "#122d42",
    "input.background": "#0b253a",
    "editorError.foreground": "#EF5350",
    "titleBar.activeBackground": "#011627",
    "activityBar.foreground": "not a colour"
  },
  "tokenColors": [
    { "scope": ["comment", "punctuation.definition.comment"], "settings": { "foreground": "#637777", "fontStyle": "italic" } },
    { "scope": "string.quoted, string.template", "settings": { "foreground": "#ecc48d" } },
    { "scope": "keyword.control", "settings": { "foreground": "#c792ea" } },
    { "scope": "keyword.operator", "settings": { "foreground": "#7fdbcaff" } },
    { "scope": "constant.numeric", "settings": { "foreground": "#F78C6C" } },
    { "scope": "meta.unknown.scope", "settings": { "foreground": "#ffffff" } }
  ]
}`;
const BASE = `{ "colors": { "editor.foreground": "#d6deeb", "editor.background": "#000000" } }`;

describe("VS Code theme conversion", () => {
  const t = convertVsCodeTheme("sdras.night-owl", "Night Owl", "vs-dark", NIGHT_OWL, BASE);

  it("gets an id Monaco accepts", () => {
    expect(t.id).toBe("ext-sdras-night-owl-night-owl");
    expect(/^[a-z0-9-]+$/.test(t.monacoTheme)).toBe(true);
  });

  it("maps workbench colours to the app variables; the theme overrides its include", () => {
    expect(t.cssVars["--fahh-bg"]).toBe("#011627");
    expect(t.cssVars["--fahh-text"]).toBe("#d6deeb");
    expect(t.cssVars["--fahh-accent"]).toBe("#122d42");
    expect(t.cssVars["--fahh-surface"]).toBe("#0b253a");
    expect(t.cssVars["--fahh-error"]).toBe("#EF5350");
    expect(t.swatches).toEqual(["#011627", "#011627", "#0b253a", "#122d42"]);
  });

  it("turns token colours into Monaco rules, without alpha and ignoring unknown scopes", () => {
    const rule = (token: string) => t.monaco.rules.find((r) => r.token === token);
    expect(rule("comment")).toEqual({ token: "comment", foreground: "637777", fontStyle: "italic" });
    expect(rule("string")?.foreground).toBe("ecc48d");
    expect(rule("keyword")?.foreground).toBe("c792ea");
    expect(rule("operator")?.foreground).toBe("7fdbca");
    expect(rule("number")?.foreground).toBe("f78c6c");
    expect(rule("")?.foreground).toBe("d6deeb");
    expect(t.monaco.colors["editor.background"]).toBe("#011627");
    expect(t.monaco.colors["activityBar.foreground"]).toBeUndefined();
    expect(t.monaco.base).toBe("vs-dark");
  });

  it("light themes get a light base", () => {
    expect(convertVsCodeTheme("x.y", "Paper", "vs", "{}").monaco.base).toBe("vs");
  });

  it("maps scopes by prefix", () => {
    expect(tokensForScope("comment.line.double-slash")).toEqual(["comment"]);
    expect(tokensForScope("source.js string.quoted")).toEqual(["string"]);
    expect(tokensForScope("entity.name.type.class")).toEqual(["type", "type.identifier"]);
    expect(tokensForScope("markup.bold")).toEqual([]);
  });
});
