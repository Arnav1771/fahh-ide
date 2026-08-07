import { describe, expect, it } from "vitest";
import {
  MarkerSeverity,
  hasErrorDiagnostic,
  lspToMarkers,
  parsePublishDiagnostics,
  toMarkerSeverity,
  uriToPath,
  type LspDiagnostic,
} from "./diagnostics";

function diag(partial: Partial<LspDiagnostic> = {}): LspDiagnostic {
  return {
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    },
    message: "boom",
    ...partial,
  };
}

describe("toMarkerSeverity", () => {
  it("maps the four LSP severities onto Monaco's", () => {
    expect(toMarkerSeverity(1)).toBe(MarkerSeverity.Error);
    expect(toMarkerSeverity(2)).toBe(MarkerSeverity.Warning);
    expect(toMarkerSeverity(3)).toBe(MarkerSeverity.Info);
    expect(toMarkerSeverity(4)).toBe(MarkerSeverity.Hint);
  });

  it("treats a missing or unknown severity as an error, per the LSP spec", () => {
    expect(toMarkerSeverity(undefined)).toBe(MarkerSeverity.Error);
    expect(toMarkerSeverity(99)).toBe(MarkerSeverity.Error);
  });
});

describe("uriToPath", () => {
  it("strips the file:// scheme from a POSIX path", () => {
    expect(uriToPath("file:///home/dell/app.py")).toBe("/home/dell/app.py");
  });

  it("drops the leading slash before a Windows drive letter", () => {
    expect(uriToPath("file:///C:/Users/dell/app.ts")).toBe(
      "C:/Users/dell/app.ts"
    );
  });

  it("decodes percent-escaped spaces", () => {
    expect(uriToPath("file:///home/dell/my%20project/a.rs")).toBe(
      "/home/dell/my project/a.rs"
    );
  });

  it("survives a malformed escape instead of throwing", () => {
    expect(uriToPath("file:///home/100%")).toBe("/home/100%");
  });

  it("leaves a non-file URI alone", () => {
    expect(uriToPath("untitled:Untitled-1")).toBe("untitled:Untitled-1");
  });
});

describe("hasErrorDiagnostic — what decides whether the sound plays", () => {
  it("is false for an empty list", () => {
    expect(hasErrorDiagnostic([])).toBe(false);
  });

  it("is false when everything is a warning or below", () => {
    expect(
      hasErrorDiagnostic([diag({ severity: 2 }), diag({ severity: 3 })])
    ).toBe(false);
  });

  it("is true when at least one diagnostic is an error", () => {
    expect(
      hasErrorDiagnostic([diag({ severity: 2 }), diag({ severity: 1 })])
    ).toBe(true);
  });

  it("is true when severity is omitted", () => {
    expect(hasErrorDiagnostic([diag({ severity: undefined })])).toBe(true);
  });
});

describe("lspToMarkers", () => {
  it("shifts 0-based LSP positions to Monaco's 1-based ones", () => {
    const [marker] = lspToMarkers([
      diag({
        range: {
          start: { line: 4, character: 2 },
          end: { line: 4, character: 9 },
        },
      }),
    ]);

    expect(marker.startLineNumber).toBe(5);
    expect(marker.startColumn).toBe(3);
    expect(marker.endLineNumber).toBe(5);
    expect(marker.endColumn).toBe(10);
  });

  it("carries message, source and code across", () => {
    const [marker] = lspToMarkers([
      diag({ message: "undefined name 'foo'", source: "pyright", code: 42 }),
    ]);

    expect(marker.message).toBe("undefined name 'foo'");
    expect(marker.source).toBe("pyright");
    expect(marker.code).toBe("42");
  });

  it("clamps an inverted range so Monaco never highlights the rest of the file", () => {
    const [marker] = lspToMarkers([
      diag({
        range: {
          start: { line: 10, character: 5 },
          end: { line: 3, character: 0 },
        },
      }),
    ]);

    expect(marker.startLineNumber).toBe(11);
    expect(marker.endLineNumber).toBe(11);
    expect(marker.endColumn).toBe(marker.startColumn);
  });

  it("clamps a backwards column on the same line", () => {
    const [marker] = lspToMarkers([
      diag({
        range: {
          start: { line: 2, character: 8 },
          end: { line: 2, character: 1 },
        },
      }),
    ]);

    expect(marker.startColumn).toBe(9);
    expect(marker.endColumn).toBe(9);
  });

  it("never produces a position below 1 from a negative line", () => {
    const [marker] = lspToMarkers([
      diag({
        range: {
          start: { line: -5, character: -5 },
          end: { line: -5, character: -5 },
        },
      }),
    ]);

    expect(marker.startLineNumber).toBe(1);
    expect(marker.startColumn).toBe(1);
  });

  it("returns an empty array for no diagnostics", () => {
    expect(lspToMarkers([])).toEqual([]);
  });
});

describe("parsePublishDiagnostics", () => {
  it("accepts a well-formed notification", () => {
    const params = parsePublishDiagnostics({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri: "file:///a.py", diagnostics: [] },
    });

    expect(params).not.toBeNull();
    expect(params?.uri).toBe("file:///a.py");
  });

  it("rejects a different method", () => {
    expect(
      parsePublishDiagnostics({
        method: "window/logMessage",
        params: { uri: "file:///a.py", diagnostics: [] },
      })
    ).toBeNull();
  });

  it("rejects malformed or non-object messages", () => {
    expect(parsePublishDiagnostics(null)).toBeNull();
    expect(parsePublishDiagnostics("not json")).toBeNull();
    expect(
      parsePublishDiagnostics({
        method: "textDocument/publishDiagnostics",
        params: { uri: 42, diagnostics: [] },
      })
    ).toBeNull();
    expect(
      parsePublishDiagnostics({
        method: "textDocument/publishDiagnostics",
        params: { uri: "file:///a.py" },
      })
    ).toBeNull();
  });
});
