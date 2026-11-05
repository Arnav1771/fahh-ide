import { describe, expect, it } from "vitest";
import {
  applyResolvedCompletion,
  applyTextEdits,
  completionKind,
  completionsToMonaco,
  flattenWorkspaceEdit,
  highlightsToMonaco,
  hoverToMonaco,
  inlayHintsToMonaco,
  INSERT_AS_SNIPPET,
  locationsToMonaco,
  markerSeverityToLsp,
  MonacoCompletionKind,
  offsetAt,
  pathKey,
  signatureHelpToMonaco,
  toLspPosition,
  toLspRange,
  toMonacoRange,
  uriToFahhPath,
} from "./protocol";

const r = (sl: number, sc: number, el: number, ec: number) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });
const word = { startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 8 };

describe("ranges and positions", () => {
  it("LSP is 0-based, Monaco 1-based, both ways", () => {
    expect(toMonacoRange(r(0, 0, 2, 4))).toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 5 });
    expect(toLspRange({ startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 5 })).toEqual(r(0, 0, 2, 4));
    expect(toLspPosition({ lineNumber: 10, column: 3 })).toEqual({ line: 9, character: 2 });
  });
});

describe("completion kinds", () => {
  it("maps every LSP kind to the matching Monaco kind", () => {
    expect(completionKind(2)).toBe(MonacoCompletionKind.Method);
    expect(completionKind(3)).toBe(MonacoCompletionKind.Function);
    expect(completionKind(6)).toBe(MonacoCompletionKind.Variable);
    expect(completionKind(7)).toBe(MonacoCompletionKind.Class);
    expect(completionKind(9)).toBe(MonacoCompletionKind.Module);
    expect(completionKind(14)).toBe(MonacoCompletionKind.Keyword);
    expect(completionKind(15)).toBe(MonacoCompletionKind.Snippet);
    expect(completionKind(17)).toBe(MonacoCompletionKind.File);
    expect(completionKind(19)).toBe(MonacoCompletionKind.Folder);
    expect(completionKind(25)).toBe(MonacoCompletionKind.TypeParameter);
  });
  it("unknown or missing kinds are Text", () => {
    expect(completionKind(undefined)).toBe(MonacoCompletionKind.Text);
    expect(completionKind(99)).toBe(MonacoCompletionKind.Text);
  });
  it("pins Monaco's enum numbers (0.52)", () => {
    expect(MonacoCompletionKind.Method).toBe(0);
    expect(MonacoCompletionKind.Text).toBe(18);
    expect(MonacoCompletionKind.Snippet).toBe(27);
  });
});

describe("completionsToMonaco", () => {
  it("handles a bare array with the word range as default", () => {
    const { suggestions, incomplete } = completionsToMonaco([{ label: "print", kind: 3 }], word);
    expect(incomplete).toBe(false);
    expect(suggestions[0]).toMatchObject({ label: "print", kind: MonacoCompletionKind.Function, insertText: "print", range: word });
  });

  it("uses textEdit ranges, snippets, docs, sort and additional edits", () => {
    const { suggestions, incomplete } = completionsToMonaco(
      {
        isIncomplete: true,
        items: [
          {
            label: "useState",
            kind: 3,
            detail: "function useState<S>()",
            documentation: { kind: "markdown", value: "**Returns** a stateful value" },
            insertTextFormat: 2,
            textEdit: { range: r(2, 4, 2, 7), newText: "useState(${1})" },
            sortText: "0001",
            filterText: "useState",
            additionalTextEdits: [{ range: r(0, 0, 0, 0), newText: "import { useState } from \"react\";\n" }],
            tags: [1],
          },
        ],
      },
      word,
      "typescript"
    );
    expect(incomplete).toBe(true);
    const s = suggestions[0];
    expect(s.insertText).toBe("useState(${1})");
    expect(s.insertTextRules).toBe(INSERT_AS_SNIPPET);
    expect(s.range).toEqual({ startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 8 });
    expect(s.documentation).toEqual({ value: "**Returns** a stateful value" });
    expect(s.additionalTextEdits).toEqual([{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: "import { useState } from \"react\";\n" }]);
    expect(s.sortText).toBe("0001");
    expect(s.tags).toEqual([1]);
    expect(s.lsp?.server).toBe("typescript");
  });

  it("maps insert/replace edits and list item defaults", () => {
    const { suggestions } = completionsToMonaco(
      {
        items: [{ label: "a", textEdit: { newText: "abc", insert: r(2, 4, 2, 5), replace: r(2, 4, 2, 7) } }, { label: "b", textEditText: "bee" }],
        itemDefaults: { editRange: r(2, 4, 2, 6), insertTextFormat: 2 },
      },
      word
    );
    expect(suggestions[0].range).toEqual({ insert: toMonacoRange(r(2, 4, 2, 5)), replace: toMonacoRange(r(2, 4, 2, 7)) });
    expect(suggestions[1].range).toEqual(toMonacoRange(r(2, 4, 2, 6)));
    expect(suggestions[1].insertText).toBe("bee");
    expect(suggestions[1].insertTextRules).toBe(INSERT_AS_SNIPPET);
  });

  it("labelDetails become Monaco's rich label; null is empty", () => {
    const { suggestions } = completionsToMonaco([{ label: "join", labelDetails: { detail: "(a, b)", description: "os.path" } }], word);
    expect(suggestions[0].label).toEqual({ label: "join", detail: "(a, b)", description: "os.path" });
    expect(completionsToMonaco(null, word).suggestions).toEqual([]);
  });

  it("folds a resolve reply into the shown item", () => {
    const [s] = completionsToMonaco([{ label: "x" }], word, "py").suggestions;
    const out = applyResolvedCompletion(s, { label: "x", documentation: "plain docs", detail: "int" });
    expect(out.documentation).toBe("plain docs");
    expect(out.detail).toBe("int");
    expect(applyResolvedCompletion(s, null)).toBe(s);
  });
});

describe("hover", () => {
  it("MarkupContent markdown passes through with its range", () => {
    expect(hoverToMonaco({ contents: { kind: "markdown", value: "```python\ndef f()\n```" }, range: r(0, 4, 0, 5) })).toEqual({
      contents: [{ value: "```python\ndef f()\n```" }],
      range: { startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 6 },
    });
  });
  it("MarkedString arrays: code blocks fenced, empties dropped", () => {
    expect(hoverToMonaco({ contents: [{ language: "ts", value: "const x: number" }, "", "Some *docs*"] })).toEqual({
      contents: [{ value: "```ts\nconst x: number\n```" }, { value: "Some *docs*" }],
    });
  });
  it("plaintext is escaped; nothing is null", () => {
    expect(hoverToMonaco({ contents: { kind: "plaintext", value: "a*b" } })?.contents[0].value).toBe("a\\*b");
    expect(hoverToMonaco(null)).toBeNull();
    expect(hoverToMonaco({ contents: [] })).toBeNull();
  });
});

describe("locations", () => {
  it("accepts Location, Location[] and LocationLink[]", () => {
    expect(locationsToMonaco({ uri: "file:///a.py", range: r(1, 0, 1, 3) })).toEqual([{ uri: "file:///a.py", range: toMonacoRange(r(1, 0, 1, 3)) }]);
    expect(
      locationsToMonaco([{ targetUri: "file:///b.ts", targetRange: r(0, 0, 9, 1), targetSelectionRange: r(2, 9, 2, 12) }])
    ).toEqual([{ uri: "file:///b.ts", range: toMonacoRange(r(2, 9, 2, 12)) }]);
    expect(locationsToMonaco(null)).toEqual([]);
  });
});

describe("signature help, highlights, inlay hints", () => {
  it("signature help keeps offsets labels and clamps the active signature", () => {
    const out = signatureHelpToMonaco({
      signatures: [{ label: "f(a, b)", parameters: [{ label: [2, 3] }, { label: "b", documentation: { kind: "markdown", value: "*b*" } }] }],
      activeSignature: 5,
      activeParameter: 1,
    });
    expect(out?.activeSignature).toBe(0);
    expect(out?.activeParameter).toBe(1);
    expect(out?.signatures[0].parameters[0].label).toEqual([2, 3]);
    expect(out?.signatures[0].parameters[1].documentation).toEqual({ value: "*b*" });
    expect(signatureHelpToMonaco({ signatures: [] })).toBeNull();
  });
  it("highlight kinds shift down by one", () => {
    expect(highlightsToMonaco([{ range: r(0, 0, 0, 1), kind: 3 }, { range: r(1, 0, 1, 1) }]).map((h) => h.kind)).toEqual([2, 0]);
  });
  it("inlay hints: position, parts and padding", () => {
    expect(inlayHintsToMonaco([{ position: { line: 0, character: 6 }, label: [{ value: ": number" }], kind: 1, paddingLeft: true }])).toEqual([
      { position: { lineNumber: 1, column: 7 }, label: [{ label: ": number", tooltip: undefined }], kind: 1, paddingLeft: true, paddingRight: false },
    ]);
  });
  it("marker severity -> LSP severity", () => {
    expect([8, 4, 2, 1].map(markerSeverityToLsp)).toEqual([1, 2, 3, 4]);
  });
});

describe("workspace edits", () => {
  it("flattens `changes`", () => {
    const { edits, ops } = flattenWorkspaceEdit({ changes: { "file:///a": [{ range: r(0, 0, 0, 1), newText: "x" }] } });
    expect([...edits.keys()]).toEqual(["file:///a"]);
    expect(ops).toEqual([]);
  });
  it("flattens documentChanges with file operations", () => {
    const { edits, ops } = flattenWorkspaceEdit({
      documentChanges: [
        { kind: "create", uri: "file:///new.ts" },
        { textDocument: { uri: "file:///new.ts", version: null }, edits: [{ range: r(0, 0, 0, 0), newText: "export {}" }] },
        { textDocument: { uri: "file:///a.ts", version: 3 }, edits: [{ range: r(0, 0, 0, 1), newText: "y" }] },
        { textDocument: { uri: "file:///a.ts", version: 3 }, edits: [{ range: r(1, 0, 1, 1), newText: "z" }] },
        { kind: "rename", oldUri: "file:///old.ts", newUri: "file:///renamed.ts" },
      ],
    });
    expect(edits.get("file:///a.ts")).toHaveLength(2);
    expect(ops.map((o) => o.kind)).toEqual(["create", "rename"]);
  });
  it("applies edits back to front against the original text", () => {
    const text = "let foo = 1;\nconsole.log(foo, foo);\n";
    const out = applyTextEdits(text, [
      { range: r(0, 4, 0, 7), newText: "bar" },
      { range: r(1, 12, 1, 15), newText: "bar" },
      { range: r(1, 17, 1, 20), newText: "bar" },
    ]);
    expect(out).toBe("let bar = 1;\nconsole.log(bar, bar);\n");
  });
  it("inserts at the same spot keep the server's order; CRLF lines clamp before \\r", () => {
    expect(applyTextEdits("ab", [{ range: r(0, 1, 0, 1), newText: "1" }, { range: r(0, 1, 0, 1), newText: "2" }])).toBe("a12b");
    expect(offsetAt("abc\r\ndef", { line: 0, character: 99 })).toBe(3);
    expect(offsetAt("abc\ndef", { line: 1, character: 2 })).toBe(6);
    expect(offsetAt("abc", { line: 5, character: 0 })).toBe(3);
  });
});

describe("paths", () => {
  it("drive URIs become Windows paths", () => {
    expect(uriToFahhPath("file:///c%3A/Users/me/app.py", true)).toBe("C:\\Users\\me\\app.py");
    expect(uriToFahhPath("file:///C:/Users/me/a%20b.ts", true)).toBe("C:\\Users\\me\\a b.ts");
  });
  it("UNC (WSL) URIs keep their host", () => {
    expect(uriToFahhPath("file://wsl.localhost/Ubuntu/home/x/main.rs", true)).toBe("\\\\wsl.localhost\\Ubuntu\\home\\x\\main.rs");
  });
  it("POSIX stays POSIX", () => {
    expect(uriToFahhPath("file:///home/x/main.py", false)).toBe("/home/x/main.py");
    expect(uriToFahhPath("untitled:1", false)).toBe("untitled:1");
  });
  it("pathKey compares Windows paths case- and slash-insensitively", () => {
    expect(pathKey("C:\\Users\\Me\\a.ts")).toBe(pathKey("c:/users/me/a.ts"));
    expect(pathKey("/home/Me/a.ts")).not.toBe(pathKey("/home/me/a.ts"));
  });
});
