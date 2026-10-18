import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  isGhostTextEnabled,
  setGhostTextEnabled,
  registerGhostTextProvider,
} from "./inlineCompletions";

beforeEach(() => {
  setGhostTextEnabled(true);
});

describe("inlineCompletions ghost text toggle", () => {
  it("reports enabled state correctly", () => {
    expect(isGhostTextEnabled()).toBe(true);
    setGhostTextEnabled(false);
    expect(isGhostTextEnabled()).toBe(false);
  });
});

describe("registerGhostTextProvider", () => {
  it("registers inline completions provider with supported languages and provides suggestions", async () => {
    let registeredLanguages: string[] = [];
    let registeredProvider: any = null;

    const mockMonaco: any = {
      languages: {
        registerInlineCompletionsProvider: vi.fn((langs, provider) => {
          registeredLanguages = langs;
          registeredProvider = provider;
          return { dispose: vi.fn() };
        }),
      },
      Range: class {
        constructor(
          public startLineNumber: number,
          public startColumn: number,
          public endLineNumber: number,
          public endColumn: number
        ) {}
      },
    };

    const disposable = registerGhostTextProvider(mockMonaco);
    expect(mockMonaco.languages.registerInlineCompletionsProvider).toHaveBeenCalled();
    expect(registeredLanguages).toContain("typescript");
    expect(registeredLanguages).toContain("python");
    expect(registeredLanguages).toContain("rust");

    // Test provideInlineCompletions for TypeScript "try {"
    const mockModelTS: any = {
      getLanguageId: () => "typescript",
      getLineContent: () => "  try {",
    };
    const posTS = { lineNumber: 1, column: 8 };
    const resTS = await registeredProvider.provideInlineCompletions(mockModelTS, posTS);
    expect(resTS.items).toHaveLength(1);
    expect(resTS.items[0].insertText).toContain("catch (err)");

    // Test Python "def foo():"
    const mockModelPy: any = {
      getLanguageId: () => "python",
      getLineContent: () => "def calculate():",
    };
    const posPy = { lineNumber: 1, column: 17 };
    const resPy = await registeredProvider.provideInlineCompletions(mockModelPy, posPy);
    expect(resPy.items).toHaveLength(1);
    expect(resPy.items[0].insertText).toContain('"""Docstring description."""');

    // Test disabled state
    setGhostTextEnabled(false);
    const resDisabled = await registeredProvider.provideInlineCompletions(mockModelTS, posTS);
    expect(resDisabled.items).toHaveLength(0);

    disposable.dispose();
  });
});
