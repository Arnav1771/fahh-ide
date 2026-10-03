import { describe, expect, it } from "vitest";
import {
  LspCorrelator,
  translateLspCompletions,
  translateLspHover,
} from "./lspCorrelation";

describe("lspCorrelation", () => {
  it("correlates request ID with inbound response", async () => {
    const correlator = new LspCorrelator();
    const { id, payload, promise } = correlator.createRequest("textDocument/completion", { uri: "file:///a.ts" });

    expect(id).toBeGreaterThanOrEqual(100);
    expect(payload).toContain('"jsonrpc":"2.0"');
    expect(payload).toContain('"method":"textDocument/completion"');

    // Simulate response arriving
    const handled = correlator.handleResponse({
      id,
      result: [{ label: "hello", kind: 2 }],
    });

    expect(handled).toBe(true);
    const result = await promise;
    expect(result).toEqual([{ label: "hello", kind: 2 }]);
  });

  it("handles RPC errors by rejecting promise", async () => {
    const correlator = new LspCorrelator();
    const { id, promise } = correlator.createRequest("textDocument/hover", {});

    correlator.handleResponse({
      id,
      error: { code: -32600, message: "Invalid request" },
    });

    await expect(promise).rejects.toEqual({ code: -32600, message: "Invalid request" });
  });

  it("ignores unsolicited notifications without matching ID", () => {
    const correlator = new LspCorrelator();
    const handled = correlator.handleResponse({ id: 9999, result: {} });
    expect(handled).toBe(false);
  });

  describe("translateLspCompletions", () => {
    it("converts completion list to Monaco format", () => {
      const lsp = {
        items: [
          { label: "myFunc", kind: 3, detail: "function myFunc(): void" },
          { label: "myVar", insertText: "myVar = 10" },
        ],
      };

      const monacoItems = translateLspCompletions(lsp);
      expect(monacoItems).toHaveLength(2);
      expect(monacoItems[0].label).toBe("myFunc");
      expect(monacoItems[0].detail).toBe("function myFunc(): void");
      expect(monacoItems[1].insertText).toBe("myVar = 10");
    });
  });

  describe("translateLspHover", () => {
    it("extracts markdown string from hover contents", () => {
      const hover = {
        contents: { kind: "markdown", value: "```ts\nconst x: number\n```" },
      };

      const extracted = translateLspHover(hover);
      expect(extracted).toEqual(["```ts\nconst x: number\n```"]);
    });
  });
});
