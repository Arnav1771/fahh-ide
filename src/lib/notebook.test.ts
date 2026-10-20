import { describe, expect, it } from "vitest";
import { parseNotebook, type Notebook } from "./notebook";
import { previewKindFor } from "./preview";
import { modeOf } from "../store/previewStore";

const nb = (body: object) => parseNotebook(JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, ...body })) as Notebook;
const code = (outputs: object[], extra: object = {}) => ({ cell_type: "code", source: "x", execution_count: 1, outputs, ...extra });

describe("parseNotebook", () => {
  it("joins string and string[] sources", () => {
    const r = nb({ cells: [{ cell_type: "markdown", source: ["# Hi\n", "there"] }, { cell_type: "raw", source: "plain" }] });
    expect(r.cells.map((c) => [c.type, c.source])).toEqual([["markdown", "# Hi\nthere"], ["raw", "plain"]]);
  });

  it("reads language from kernelspec, then language_info, else python", () => {
    expect(nb({ metadata: { kernelspec: { language: "R" } }, cells: [] }).language).toBe("r");
    expect(nb({ metadata: { language_info: { name: "julia" } }, cells: [] }).language).toBe("julia");
    expect(nb({ cells: [] }).language).toBe("python");
  });

  it("keeps execution counts, null when unrun", () => {
    const r = nb({ cells: [code([]), code([], { execution_count: null })] });
    expect(r.cells.map((c) => c.executionCount)).toEqual([1, null]);
  });

  it("reads stream output and strips ANSI codes", () => {
    const r = nb({ cells: [code([{ output_type: "stream", name: "stderr", text: ["\x1b[31mbad\x1b[0m\n"] }, { output_type: "stream", name: "stdout", text: "ok" }])] });
    expect(r.cells[0].outputs).toEqual([{ type: "stream", name: "stderr", text: "bad\n" }, { type: "stream", name: "stdout", text: "ok" }]);
  });

  it("picks the best mime type from a bundle", () => {
    const r = nb({
      cells: [
        code([
          { output_type: "display_data", data: { "image/png": "iVBO\nRw==", "text/plain": "<Figure>" } },
          { output_type: "display_data", data: { "image/jpeg": "/9j/" } },
          { output_type: "display_data", data: { "image/svg+xml": ["<svg/>"] } },
          { output_type: "execute_result", data: { "text/html": ["<table>", "</table>"], "text/plain": "df" } },
          { output_type: "display_data", data: { "text/markdown": "**b**" } },
          { output_type: "execute_result", data: { "text/plain": ["42"] } },
          { output_type: "display_data", data: { "application/x-unknown": "?" } },
        ]),
      ],
    });
    expect(r.cells[0].outputs).toEqual([
      { type: "image", mime: "image/png", src: "data:image/png;base64,iVBORw==" },
      { type: "image", mime: "image/jpeg", src: "data:image/jpeg;base64,/9j/" },
      { type: "image", mime: "image/svg+xml", src: "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E" },
      { type: "html", html: "<table></table>" },
      { type: "markdown", text: "**b**" },
      { type: "text", text: "42" },
    ]);
  });

  it("reads errors with ANSI stripped from the traceback", () => {
    const r = nb({ cells: [code([{ output_type: "error", ename: "ZeroDivisionError", evalue: "division by zero", traceback: ["\x1b[0;31m----\x1b[0m", "\x1b[1;31mZeroDivisionError\x1b[0m"] }])] });
    expect(r.cells[0].outputs).toEqual([{ type: "error", ename: "ZeroDivisionError", evalue: "division by zero", traceback: "----\nZeroDivisionError" }]);
  });

  it("returns an error object for invalid JSON, never throws", () => {
    const r = parseNotebook("{ not json");
    expect("error" in r && r.error).toMatch(/Not valid notebook JSON/);
  });

  it("degrades gracefully for nbformat 3 and missing fields", () => {
    const v3 = parseNotebook(JSON.stringify({ nbformat: 3, worksheets: [{ cells: [] }] }));
    expect("error" in v3 && v3.error).toMatch(/nbformat 3/);
    expect("error" in parseNotebook("null")).toBe(true);
    const r = nb({ metadata: undefined, cells: [{}, { cell_type: "code" }, null] });
    expect(r.cells).toEqual([
      { type: "raw", source: "", executionCount: null, outputs: [] },
      { type: "code", source: "", executionCount: null, outputs: [] },
      { type: "raw", source: "", executionCount: null, outputs: [] },
    ]);
  });
});

describe("notebook preview wiring", () => {
  it("opens .ipynb in the rendered view by default, other kinds in the editor", () => {
    expect(previewKindFor("/a/Analysis.IPYNB")).toBe("notebook");
    expect(modeOf({}, "/a/x.ipynb")).toBe("only");
    expect(modeOf({ "/a/x.ipynb": "off" }, "/a/x.ipynb")).toBe("off");
    expect(modeOf({}, "/a/README.md")).toBe("off");
  });
});
