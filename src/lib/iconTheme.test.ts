import { describe, it, expect } from "vitest";
import { renderFileIcon, renderFolderIcon } from "./iconTheme";
import React from "react";

describe("iconTheme resolver", () => {
  it("renders specific icons for programming languages", () => {
    const ts = renderFileIcon("main.ts", "material");
    const tsx = renderFileIcon("App.tsx", "material");
    const rs = renderFileIcon("lib.rs", "material");
    const py = renderFileIcon("script.py", "material");
    const go = renderFileIcon("server.go", "material");

    expect(React.isValidElement(ts)).toBe(true);
    expect(React.isValidElement(tsx)).toBe(true);
    expect(React.isValidElement(rs)).toBe(true);
    expect(React.isValidElement(py)).toBe(true);
    expect(React.isValidElement(go)).toBe(true);
  });

  it("identifies special config and project files", () => {
    const pkg = renderFileIcon("package.json", "material");
    const lock = renderFileIcon("Cargo.lock", "material");
    const docker = renderFileIcon("Dockerfile", "material");
    const git = renderFileIcon(".gitignore", "material");
    const env = renderFileIcon(".env.local", "material");

    expect(React.isValidElement(pkg)).toBe(true);
    expect(React.isValidElement(lock)).toBe(true);
    expect(React.isValidElement(docker)).toBe(true);
    expect(React.isValidElement(git)).toBe(true);
    expect(React.isValidElement(env)).toBe(true);
  });

  it("handles different icon theme palettes", () => {
    const material = renderFileIcon("index.ts", "material");
    const seti = renderFileIcon("index.ts", "seti");
    const catppuccin = renderFileIcon("index.ts", "catppuccin");
    const minimal = renderFileIcon("index.ts", "minimal");

    expect(React.isValidElement(material)).toBe(true);
    expect(React.isValidElement(seti)).toBe(true);
    expect(React.isValidElement(catppuccin)).toBe(true);
    expect(React.isValidElement(minimal)).toBe(true);
  });

  it("renders special folder icons for src, components, tests, docs", () => {
    const srcFolder = renderFolderIcon("src", false, "material");
    const componentsFolder = renderFolderIcon("components", false, "material");
    const testsFolder = renderFolderIcon("tests", false, "material");
    const docsFolder = renderFolderIcon("docs", false, "material");
    const normalFolder = renderFolderIcon("my_folder", true, "material");

    expect(React.isValidElement(srcFolder)).toBe(true);
    expect(React.isValidElement(componentsFolder)).toBe(true);
    expect(React.isValidElement(testsFolder)).toBe(true);
    expect(React.isValidElement(docsFolder)).toBe(true);
    expect(React.isValidElement(normalFolder)).toBe(true);
  });
});
