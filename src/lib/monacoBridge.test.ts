import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MARKER_OWNER,
  attachMonaco,
  clearDiagnostics,
  detachMonaco,
  getActiveDocument,
  getDiagnostics,
  publishDiagnostics,
  resetMonacoBridge,
  setActiveDocument,
  totalDiagnosticCount,
} from "./monacoBridge";
import { lspToMarkers } from "./diagnostics";
import type { FahhMarker } from "./diagnostics";

/** Stand-in for the bits of the Monaco API the bridge touches. */
function fakeMonaco() {
  const setModelMarkers =
    vi.fn<(model: object, owner: string, markers: FahhMarker[]) => void>();
  return { api: { editor: { setModelMarkers } }, setModelMarkers };
}

/** Markers from the most recent setModelMarkers call (tsconfig lib is ES2021,
 *  so `Array.prototype.at` is not available here). */
function lastMarkers(
  calls: [model: object, owner: string, markers: FahhMarker[]][]
): FahhMarker[] | undefined {
  return calls.length > 0 ? calls[calls.length - 1][2] : undefined;
}

function fakeEditor(disposed = false) {
  const model = { isDisposed: () => disposed };
  return { getModel: () => model, model };
}

const errorMarker: FahhMarker[] = lspToMarkers([
  {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
    message: "boom",
    severity: 1,
  },
]);

beforeEach(() => {
  resetMonacoBridge();
});

describe("monacoBridge — LSP markers reaching the editor", () => {
  it("does nothing (and does not throw) before Monaco has mounted", () => {
    expect(() => publishDiagnostics("/a.py", errorMarker)).not.toThrow();
    expect(getDiagnostics("/a.py")).toEqual(errorMarker);
  });

  it("flushes diagnostics that arrived before Monaco mounted", () => {
    publishDiagnostics("/a.py", errorMarker);
    setActiveDocument("/a.py");

    const { api, setModelMarkers } = fakeMonaco();
    const editor = fakeEditor();
    attachMonaco(api, editor);

    expect(setModelMarkers).toHaveBeenCalledWith(
      editor.model,
      MARKER_OWNER,
      errorMarker
    );
  });

  it("pushes markers for the file that is on screen", () => {
    const { api, setModelMarkers } = fakeMonaco();
    const editor = fakeEditor();
    attachMonaco(api, editor);
    setActiveDocument("/a.py");
    setModelMarkers.mockClear();

    publishDiagnostics("/a.py", errorMarker);

    expect(setModelMarkers).toHaveBeenCalledTimes(1);
    expect(setModelMarkers.mock.calls[0][2]).toEqual(errorMarker);
  });

  it("does NOT push markers for a file that is not on screen", () => {
    const { api, setModelMarkers } = fakeMonaco();
    attachMonaco(api, fakeEditor());
    setActiveDocument("/a.py");
    setModelMarkers.mockClear();

    publishDiagnostics("/other.py", errorMarker);

    expect(setModelMarkers).not.toHaveBeenCalled();
    // …but it is remembered for when that tab is selected.
    expect(getDiagnostics("/other.py")).toEqual(errorMarker);
  });

  it("swaps markers when the active tab changes", () => {
    const { api, setModelMarkers } = fakeMonaco();
    attachMonaco(api, fakeEditor());

    publishDiagnostics("/a.py", errorMarker);
    publishDiagnostics("/b.py", []);

    setActiveDocument("/a.py");
    expect(lastMarkers(setModelMarkers.mock.calls)).toEqual(errorMarker);

    setActiveDocument("/b.py");
    expect(lastMarkers(setModelMarkers.mock.calls)).toEqual([]);

    setActiveDocument("/a.py");
    expect(lastMarkers(setModelMarkers.mock.calls)).toEqual(errorMarker);
  });

  it("clears markers when no file is open", () => {
    const { api, setModelMarkers } = fakeMonaco();
    attachMonaco(api, fakeEditor());
    setActiveDocument("/a.py");
    publishDiagnostics("/a.py", errorMarker);
    setModelMarkers.mockClear();

    setActiveDocument(null);

    expect(lastMarkers(setModelMarkers.mock.calls)).toEqual([]);
    expect(getActiveDocument()).toBeNull();
  });

  it("treats an empty diagnostics list as 'this file is clean now'", () => {
    const { api, setModelMarkers } = fakeMonaco();
    attachMonaco(api, fakeEditor());
    setActiveDocument("/a.py");
    publishDiagnostics("/a.py", errorMarker);
    setModelMarkers.mockClear();

    publishDiagnostics("/a.py", []);

    expect(setModelMarkers).toHaveBeenCalledTimes(1);
    expect(setModelMarkers.mock.calls[0][2]).toEqual([]);
    expect(getDiagnostics("/a.py")).toEqual([]);
  });

  it("forgets a file when its tab is closed", () => {
    publishDiagnostics("/a.py", errorMarker);
    publishDiagnostics("/b.py", errorMarker);
    expect(totalDiagnosticCount()).toBe(2);

    clearDiagnostics("/a.py");

    expect(getDiagnostics("/a.py")).toEqual([]);
    expect(totalDiagnosticCount()).toBe(1);
  });

  it("never writes to a disposed model", () => {
    const { api, setModelMarkers } = fakeMonaco();
    attachMonaco(api, fakeEditor(true));
    setActiveDocument("/a.py");

    publishDiagnostics("/a.py", errorMarker);

    expect(setModelMarkers).not.toHaveBeenCalled();
  });

  it("stops writing once the editor has been detached", () => {
    const { api, setModelMarkers } = fakeMonaco();
    attachMonaco(api, fakeEditor());
    setActiveDocument("/a.py");
    detachMonaco();
    setModelMarkers.mockClear();

    publishDiagnostics("/a.py", errorMarker);

    expect(setModelMarkers).not.toHaveBeenCalled();
  });

  it("always writes under the fahh-lsp owner so it never fights Monaco's own markers", () => {
    const { api, setModelMarkers } = fakeMonaco();
    attachMonaco(api, fakeEditor());
    setActiveDocument("/a.py");
    publishDiagnostics("/a.py", errorMarker);

    for (const call of setModelMarkers.mock.calls) {
      expect(call[1]).toBe("fahh-lsp");
    }
  });
});
