import { describe, expect, it, vi } from "vitest";
import { handleOpenRequest, parentDir, type OpenDeps } from "./openRequest";

function deps(hasFolder = false): OpenDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    openFolder: vi.fn(async (p: string) => void calls.push("folder:" + p)),
    openFile: vi.fn(async (p: string) => void calls.push("file:" + p)),
    hasFolder: () => hasFolder,
    isActive: () => true,
    goToLine: (n: number) => (calls.push("line:" + n), true),
    notify: (t: string, k?: string) => void calls.push(`${k ?? "ok"}:${t}`),
    delay: async () => {},
  };
}

describe("handleOpenRequest", () => {
  it("opens a folder as the workspace", async () => {
    const d = deps();
    await handleOpenRequest({ path: "/p/proj", line: null, kind: "dir" }, d);
    expect(d.calls).toEqual(["folder:/p/proj"]);
  });
  it("opens a file; with no workspace its folder becomes one first", async () => {
    const d = deps(false);
    await handleOpenRequest({ path: "/p/proj/a.ts", line: null, kind: "file" }, d);
    expect(d.calls).toEqual(["folder:/p/proj", "file:/p/proj/a.ts"]);
  });
  it("keeps the current workspace when one is open, and jumps to the line", async () => {
    const d = deps(true);
    await handleOpenRequest({ path: "/p/proj/a.ts", line: 42, kind: "file" }, d);
    expect(d.calls).toEqual(["file:/p/proj/a.ts", "line:42", "line:42"]);
  });
  it("says so when the path does not exist, and opens nothing", async () => {
    const d = deps();
    await handleOpenRequest({ path: "/p/nope", line: null, kind: "missing" }, d);
    expect(d.calls).toEqual(["error:fahh: /p/nope does not exist"]);
  });
  it("reports a failing open instead of throwing", async () => {
    const d = deps(true);
    d.openFile = async () => { throw "denied"; };
    await handleOpenRequest({ path: "/p/a.ts", line: null, kind: "file" }, d);
    expect(d.calls).toEqual(["error:Could not open a.ts: denied"]);
  });
});

describe("parentDir", () => {
  it("handles posix and Windows paths", () => {
    expect(parentDir("/p/proj/a.ts")).toBe("/p/proj");
    expect(parentDir("/a.ts")).toBe("/");
    expect(parentDir("C:\\p\\a.ts")).toBe("C:\\p");
    expect(parentDir("C:\\a.ts")).toBe("C:\\");
  });
});
