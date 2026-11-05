import { describe, expect, it } from "vitest";
import { findEntry, pathContext, pathSuggestions, resolveDir } from "./pathCompletion";
import type { FileEntry } from "./types";

const f = (path: string): FileEntry => ({ name: path.split("/").pop()!, path, is_dir: false });
const d = (path: string, children: FileEntry[]): FileEntry => ({ name: path.split("/").pop()!, path, is_dir: true, children });

const tree = d("/w", [
  d("/w/src", [d("/w/src/components", [f("/w/src/components/Button.tsx"), f("/w/src/components/index.ts")]), f("/w/src/App.tsx"), f("/w/src/main.tsx")]),
  f("/w/index.html"),
  f("/w/style.css"),
]);

describe("pathContext", () => {
  it("finds relative paths in imports", () => {
    expect(pathContext('import { x } from "./comp', "typescript")).toEqual({ typed: "./comp" });
    expect(pathContext("const m = require('../", "javascript")).toEqual({ typed: "../" });
    expect(pathContext('await import("./', "typescript")).toEqual({ typed: "./" });
    expect(pathContext('import "./styles', "typescript")).toEqual({ typed: "./styles" });
  });
  it("ignores packages, closed strings and other code", () => {
    expect(pathContext('import React from "react', "typescript")).toBeNull();
    expect(pathContext('import x from "./a"; const y = ', "typescript")).toBeNull();
    expect(pathContext("const a = './x", "typescript")).toBeNull();
  });
  it("html src/href, css url(), markdown links", () => {
    expect(pathContext('<img src="./img/', "html")).toEqual({ typed: "./img/" });
    expect(pathContext("background: url(../assets/", "css")).toEqual({ typed: "../assets/" });
    expect(pathContext("see [docs](./docs/", "markdown")).toEqual({ typed: "./docs/" });
    expect(pathContext('<a href="https://x', "html")).toBeNull();
  });
});

describe("resolveDir", () => {
  it("resolves . and .. in both separator styles", () => {
    expect(resolveDir("/w/src", "./components/")).toBe("/w/src/components");
    expect(resolveDir("/w/src", "../")).toBe("/w");
    expect(resolveDir("C:\\w\\src", "../lib/")).toBe("C:\\w\\lib");
    expect(resolveDir("\\\\wsl.localhost\\Ubuntu\\w", "./a/")).toBe("\\\\wsl.localhost\\Ubuntu\\w\\a");
  });
});

describe("pathSuggestions", () => {
  it("lists the folder being typed, without the file itself, extensions stripped for TS", () => {
    const out = pathSuggestions(tree, "/w/src/App.tsx", "./", "typescript");
    expect(out.map((s) => s.label)).toEqual(["components/", "main.tsx"]);
    expect(out.find((s) => s.label === "main.tsx")?.insertText).toBe("main");
  });
  it("goes into subfolders and up", () => {
    expect(pathSuggestions(tree, "/w/src/App.tsx", "./components/Bu", "typescript").map((s) => s.insertText)).toEqual(["Button", "index"]);
    expect(pathSuggestions(tree, "/w/src/App.tsx", "../", "html").map((s) => s.insertText)).toEqual(["src/", "index.html", "style.css"]);
  });
  it("unknown folders give nothing", () => {
    expect(pathSuggestions(tree, "/w/src/App.tsx", "./nope/", "typescript")).toEqual([]);
    expect(findEntry(null, "/w")).toBeNull();
  });
});
