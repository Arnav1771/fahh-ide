import { describe, expect, it } from "vitest";
import { findFileLinks, resolveLinkPath } from "./termLinks";

describe("findFileLinks", () => {
  it("finds compiler-style path:line:col", () => {
    const l = findFileLinks("error TS2345: src/app.ts:12:5 - bad");
    expect(l).toEqual([{ start: 14, end: 29, path: "src/app.ts", line: 12, column: 5 }]);
  });
  it("finds bare file:line and Windows paths with (line,col)", () => {
    expect(findFileLinks("--> main.rs:7")[0]).toMatchObject({ path: "main.rs", line: 7 });
    expect(findFileLinks("C:\\proj\\x.py(3,1): warning")[0]).toMatchObject({ path: "C:\\proj\\x.py", line: 3, column: 1 });
  });
  it("finds Python tracebacks", () => {
    expect(findFileLinks('  File "C:\\p\\app.py", line 42, in main')).toEqual([{ start: 8, end: 19, path: "C:\\p\\app.py", line: 42 }]);
  });
  it("ignores plain words with dots and URLs", () => {
    expect(findFileLinks("hello.world and version 1.2.3")).toEqual([]);
    expect(findFileLinks("see https://example.com/a/b.html for more")).toEqual([]);
  });
  it("links paths with slashes even without a line", () => {
    expect(findFileLinks("wrote dist/index.js")[0]).toMatchObject({ path: "dist/index.js", line: undefined });
  });
});

describe("resolveLinkPath", () => {
  it("joins relative paths to the open folder with its separator", () => {
    expect(resolveLinkPath("src/a.ts", "C:\\proj")).toBe("C:\\proj\\src\\a.ts");
    expect(resolveLinkPath("./a.py", "/home/x")).toBe("/home/x/a.py");
    expect(resolveLinkPath("/etc/hosts", "/home/x")).toBe("/etc/hosts");
  });
});
