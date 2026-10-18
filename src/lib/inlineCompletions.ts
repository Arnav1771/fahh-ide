import type { Monaco } from "@monaco-editor/react";

let providerDisposable: { dispose(): void } | null = null;
let enabled = true;

export function isGhostTextEnabled(): boolean {
  return enabled;
}

export function setGhostTextEnabled(value: boolean): void {
  enabled = value;
}

/**
 * Registers Copilot/Cursor-style Ghost Text inline completions for Monaco editor.
 * Renders gray suggested text ahead of the cursor that can be accepted with Tab.
 */
export function registerGhostTextProvider(monaco: Monaco): { dispose(): void } {
  if (providerDisposable) {
    providerDisposable.dispose();
    providerDisposable = null;
  }

  const supportedLanguages = [
    "typescript",
    "javascript",
    "typescriptreact",
    "javascriptreact",
    "python",
    "rust",
    "html",
    "css",
    "json",
    "markdown",
    "c",
    "cpp",
  ];

  const disposable = monaco.languages.registerInlineCompletionsProvider(
    supportedLanguages,
    {
      provideInlineCompletions: async (model, position) => {
        if (!enabled) return { items: [] };

        const lineContent = model.getLineContent(position.lineNumber);
        const prefix = lineContent.substring(0, position.column - 1);
        const trimmed = prefix.trim();

        // Don't suggest on empty line or single character
        if (trimmed.length < 2) return { items: [] };

        const lang = model.getLanguageId();
        let suggestion = "";

        // Heuristic smart pattern completion
        if (lang === "typescript" || lang === "javascript" || lang === "typescriptreact" || lang === "javascriptreact") {
          if (trimmed.endsWith("try {")) {
            suggestion = "\n  // code\n} catch (err) {\n  console.error(err);\n}";
          } else if (trimmed.startsWith("interface ") && trimmed.endsWith("{")) {
            suggestion = "\n  id: string;\n  name: string;\n  createdAt: number;\n}";
          } else if (trimmed.startsWith("function ") && trimmed.includes("(") && trimmed.endsWith(")")) {
            suggestion = " {\n  // Implementation\n}";
          } else if (trimmed.startsWith("const ") && trimmed.includes("=") && trimmed.endsWith("=>")) {
            suggestion = " {\n  return true;\n};";
          } else if (trimmed.endsWith("useEffect(() => {")) {
            suggestion = "\n  // effect\n  return () => {};\n}, []);";
          } else if (trimmed.endsWith("useState(")) {
            suggestion = "null);";
          } else if (trimmed.endsWith("console.log(")) {
            suggestion = `"Debug:", ${trimmed.split(" ")[0] || "res"});`;
          }
        } else if (lang === "python") {
          if (trimmed.startsWith("def ") && trimmed.endsWith(":")) {
            suggestion = "\n    \"\"\"Docstring description.\"\"\"\n    pass";
          } else if (trimmed.startsWith("class ") && trimmed.endsWith(":")) {
            suggestion = "\n    def __init__(self):\n        pass";
          } else if (trimmed.startsWith("if __name__ ==")) {
            suggestion = " '__main__':\n    main()";
          } else if (trimmed.endsWith("try:")) {
            suggestion = "\n    pass\nexcept Exception as e:\n    print(f'Error: {e}')";
          }
        } else if (lang === "rust") {
          if (trimmed.startsWith("fn ") && trimmed.includes("(") && trimmed.endsWith(")")) {
            suggestion = " -> Result<(), Box<dyn std.error.Error>> {\n    Ok(())\n}";
          } else if (trimmed.startsWith("pub struct ") && trimmed.endsWith("{")) {
            suggestion = "\n    pub id: String,\n}";
          } else if (trimmed.startsWith("match ") && trimmed.endsWith("{")) {
            suggestion = "\n    Some(val) => val,\n    None => (),\n}";
          }
        }

        if (!suggestion) return { items: [] };

        return {
          items: [
            {
              insertText: suggestion,
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column
              ),
            },
          ],
        };
      },
      freeInlineCompletions: () => {},
    }
  );

  providerDisposable = disposable;
  return disposable;
}
