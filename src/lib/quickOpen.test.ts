import { describe, expect, it } from "vitest";
import { flattenTree, type TreeNode } from "./quickOpen";

const f = (path: string): TreeNode => ({ name: path.split("/").pop()!, path, is_dir: false });
const d = (path: string, children: TreeNode[]): TreeNode => ({ name: path.split("/").pop()!, path, is_dir: true, children });

const TREE = d("/p", [
  f("/p/README.md"),
  d("/p/src", [f("/p/src/main.ts"), d("/p/src/ui", [f("/p/src/ui/App.tsx")])]),
  d("/p/node_modules", [f("/p/node_modules/x/index.js")]),
  d("/p/target", [f("/p/target/debug/app")]),
]);

describe("quick open file list", () => {
  it("flattens every file with its folder relative to the root", () => {
    expect(flattenTree(TREE)).toEqual([
      { path: "/p/README.md", name: "README.md", folder: "" },
      { path: "/p/src/main.ts", name: "main.ts", folder: "src" },
      { path: "/p/src/ui/App.tsx", name: "App.tsx", folder: "src/ui" },
    ]);
  });

  it("skips dependency and build folders, and respects the limit", () => {
    expect(flattenTree(TREE).some((x) => /node_modules|target/.test(x.path))).toBe(false);
    expect(flattenTree(TREE, 2)).toHaveLength(2);
    expect(flattenTree(null)).toEqual([]);
  });
});
