import { describe, expect, it } from "vitest";
import { affectedDirs, spliceTree } from "./fsWatch";
import type { FileEntry } from "./types";

const f = (path: string): FileEntry => ({ name: path.split("/").pop()!, path, is_dir: false });
const d = (path: string, children: FileEntry[]): FileEntry => ({ name: path.split("/").pop()!, path, is_dir: true, children });

describe("affectedDirs", () => {
  it("re-reads each changed path's folder, once, and skips folders inside another", () => {
    expect(affectedDirs("/p", ["/p/src/a.ts", "/p/src/b.ts", "/p/src/lib/c.ts", "/p/web/x"]).sort()).toEqual(["/p/src", "/p/web"]);
  });
  it("collapses to the root for a change at the top level, and ignores the root and paths outside", () => {
    expect(affectedDirs("/p", ["/p/new.txt", "/p/src/a.ts"])).toEqual(["/p"]);
    expect(affectedDirs("/p", ["/p", "/other/a"])).toEqual([]);
  });
  it("handles Windows paths", () => {
    expect(affectedDirs("C:\\p", ["C:\\p\\src\\a.ts"])).toEqual(["C:\\p\\src"]);
  });
});

describe("spliceTree", () => {
  const lib = d("/p/src/lib", [f("/p/src/lib/x.ts")]);
  const web = d("/p/web", [f("/p/web/i.html")]);
  const tree = d("/p", [d("/p/src", [lib, f("/p/src/a.ts")]), web]);

  it("replaces only the changed folder and keeps every other branch as it was", () => {
    const fresh = d("/p/src/lib", [f("/p/src/lib/x.ts"), f("/p/src/lib/y.ts")]);
    const next = spliceTree(tree, fresh)!;
    expect(next.children![0].children![0]).toBe(fresh);
    expect(next.children![1]).toBe(web); // untouched: same object, so its rows keep their state
    expect(next.children![0].children![1]).toBe(tree.children![0].children![1]);
    expect(tree.children![0].children![0]).toBe(lib); // the old tree is not mutated
  });
  it("replaces the whole tree for the root, and returns null for a folder it does not hold", () => {
    const root = d("/p", []);
    expect(spliceTree(tree, root)).toBe(root);
    expect(spliceTree(tree, d("/p/nope", []))).toBeNull();
    expect(spliceTree(tree, d("/q", []))).toBeNull();
  });
});
