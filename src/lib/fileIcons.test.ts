import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileIconId, folderIconId } from "./fileIcons";
import { FILE_ICON_MAP } from "./fileIconMap";

const FILES = [
  "package.json", "tsconfig.json", "Cargo.toml", "Cargo.lock", "poetry.lock", "bun.lockb", "Dockerfile",
  "Dockerfile.dev", ".env.local", ".gitignore", "README.md", "LICENSE", "Makefile", ".editorconfig",
  ".prettierrc", ".eslintrc", ".npmrc", "x.d.ts", "x.test.ts", "x.spec.tsx", "x.ts", "x.tsx", "x.js",
  "x.ipynb", "x.py", "x.rs", "x.go", "x.java", "x.kt", "x.swift", "x.rb", "x.php", "x.cs", "x.lua",
  "x.dart", "x.vue", "x.svelte", "x.csv", "x.xml", "x.yaml", "x.toml", "x.ini", "x.sql", "x.sh", "x.ps1",
  "x.unknownext", "noext",
];
const FOLDERS = ["src", "node_modules", ".git", ".vscode", "public", "assets", "tests", "docs", "target", "venv", "whatever"];

describe("file icon resolver", () => {
  it("maps common files and folders", () => {
    const files = Object.fromEntries(FILES.map((f) => [f, fileIconId(f)]));
    const folders = Object.fromEntries(
      FOLDERS.map((f) => [f, `${folderIconId(f, false)} / ${folderIconId(f, true)}`])
    );
    expect({ files, folders }).toMatchInlineSnapshot(`
      {
        "files": {
          ".editorconfig": "editorconfig",
          ".env.local": "tune",
          ".eslintrc": "eslint",
          ".gitignore": "git",
          ".npmrc": "npm",
          ".prettierrc": "prettier",
          "Cargo.lock": "lock",
          "Cargo.toml": "toml",
          "Dockerfile": "docker",
          "Dockerfile.dev": "docker",
          "LICENSE": "license",
          "Makefile": "makefile",
          "README.md": "readme",
          "bun.lockb": "bun",
          "noext": "file",
          "package.json": "nodejs",
          "poetry.lock": "poetry",
          "tsconfig.json": "tsconfig",
          "x.cs": "csharp",
          "x.csv": "table",
          "x.d.ts": "typescript-def",
          "x.dart": "dart",
          "x.go": "go",
          "x.ini": "settings",
          "x.ipynb": "jupyter",
          "x.java": "java",
          "x.js": "javascript",
          "x.kt": "kotlin",
          "x.lua": "lua",
          "x.php": "php",
          "x.ps1": "powershell",
          "x.py": "python",
          "x.rb": "ruby",
          "x.rs": "rust",
          "x.sh": "console",
          "x.spec.tsx": "test-jsx",
          "x.sql": "database",
          "x.svelte": "svelte",
          "x.swift": "swift",
          "x.test.ts": "test-ts",
          "x.toml": "toml",
          "x.ts": "typescript",
          "x.tsx": "react_ts",
          "x.unknownext": "file",
          "x.vue": "vue",
          "x.xml": "xml",
          "x.yaml": "yaml",
        },
        "folders": {
          ".git": "folder-git / folder-git-open",
          ".vscode": "folder-vscode / folder-vscode-open",
          "assets": "folder-resource / folder-resource-open",
          "docs": "folder-docs / folder-docs-open",
          "node_modules": "folder-node / folder-node-open",
          "public": "folder-public / folder-public-open",
          "src": "folder-src / folder-src-open",
          "target": "folder-target / folder-target-open",
          "tests": "folder-test / folder-test-open",
          "venv": "folder-environment / folder-environment-open",
          "whatever": "folder / folder-open",
        },
      }
    `);
  });

  it("is case-insensitive and prefers the longest extension", () => {
    expect(fileIconId("PACKAGE.JSON")).toBe(fileIconId("package.json"));
    expect(fileIconId("types.d.ts")).not.toBe(fileIconId("types.ts"));
    expect(fileIconId("a.b.test.ts")).toBe(fileIconId("x.test.ts"));
  });

  it("falls back to language id, then the default file", () => {
    expect(fileIconId("Jenkinsfile2", "python")).toBe(fileIconId("x.py"));
    expect(fileIconId("Jenkinsfile2")).toBe(FILE_ICON_MAP.file);
  });

  it("uses light variants only where they exist", () => {
    expect(fileIconId("x.toml", undefined, true)).toBe("toml_light");
    expect(fileIconId("x.ts", undefined, true)).toBe("typescript");
  });

  it("ships an SVG for every icon the map can return", () => {
    const m = FILE_ICON_MAP;
    const ids = new Set([
      m.file, m.folder, m.folderOpen,
      ...[m.fileNames, m.fileExtensions, m.languageIds, m.folderNames, m.folderNamesOpen, m.light].flatMap(Object.values),
    ]);
    const missing = [...ids].filter((id) => !existsSync(new URL(`../assets/file-icons/${id}.svg`, import.meta.url)));
    expect(missing).toEqual([]);
  });
});
