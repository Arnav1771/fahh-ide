import { describe, expect, it } from "vitest";
import { markersToDiagnostics, useDiagnosticsStore, type MarkerLike } from "./diagnosticsStore";

const m = (fsPath: string, severity = 8, extra: Partial<MarkerLike> = {}): MarkerLike => ({
  resource: { scheme: "file", fsPath },
  severity,
  message: "msg",
  startLineNumber: 5,
  startColumn: 7,
  ...extra,
});

describe("Problems panel diagnostics", () => {
  it("starts empty: no built-in sample problems", () => {
    expect(useDiagnosticsStore.getState().diagnostics).toEqual([]);
  });

  it("keeps only files inside the open folder, in the folder's own path spelling", () => {
    const root = "C:\\build\\proj";
    const out = markersToDiagnostics(
      [
        m("c:\\build\\proj\\bad.py", 8, { source: "Ruff", code: { value: "F821" } }),
        m("c:\\build\\proj\\src\\main.ts", 4),
        m("c:\\build\\proj-other\\x.ts"), // sibling folder with a shared prefix
        m("d:\\code\\fahh-ide\\src\\main.rs"),
        { ...m("c:\\build\\proj\\inmemory.ts"), resource: { scheme: "inmemory", fsPath: "c:\\build\\proj\\inmemory.ts" } },
      ],
      root,
    );
    expect(out.map((d) => [d.path, d.severity])).toEqual([
      ["C:\\build\\proj\\bad.py", "error"],
      ["C:\\build\\proj\\src\\main.ts", "warning"],
    ]);
    expect(out[0]).toMatchObject({ line: 5, column: 7, source: "Ruff", code: "F821" });
  });

  it("POSIX and WSL roots", () => {
    expect(markersToDiagnostics([m("/home/me/p/a.ts")], "/home/me/p/")[0].path).toBe("/home/me/p/a.ts");
  });

  it("no folder open: nothing", () => {
    expect(markersToDiagnostics([m("c:\\x\\a.ts")], null)).toEqual([]);
  });
});
