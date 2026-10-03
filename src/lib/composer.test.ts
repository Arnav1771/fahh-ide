import { describe, expect, it } from "vitest";
import {
  extractCodeBlocks,
  buildComposerPrompt,
  generateErrorFixPrompt,
  applyCodeToEditor,
} from "./composer";
import { useEditorStore } from "../store/editorStore";

describe("composer", () => {
  describe("extractCodeBlocks", () => {
    it("extracts language and code from simple fenced markdown", () => {
      const markdown = `
Here is the solution:
\`\`\`typescript
const greeting: string = "hello world";
console.log(greeting);
\`\`\`
Hope this helps!
`;
      const blocks = extractCodeBlocks(markdown);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].language).toBe("typescript");
      expect(blocks[0].code).toContain('const greeting: string = "hello world";');
    });

    it("parses file target from header attribute", () => {
      const markdown = `
\`\`\`rust file="src-tauri/src/main.rs"
fn main() {
    println!("Fahh!");
}
\`\`\`
`;
      const blocks = extractCodeBlocks(markdown);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].language).toBe("rust");
      expect(blocks[0].filePath).toBe("src-tauri/src/main.rs");
      expect(blocks[0].code).toContain('println!("Fahh!");');
    });

    it("detects file target from leading comment if header is plain", () => {
      const markdown = `
\`\`\`python
# File: scripts/analyze.py
import sys
print(sys.version)
\`\`\`
`;
      const blocks = extractCodeBlocks(markdown);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].language).toBe("python");
      expect(blocks[0].filePath).toBe("scripts/analyze.py");
    });
  });

  describe("buildComposerPrompt", () => {
    it("bundles active file, selection, and error context", () => {
      const prompt = buildComposerPrompt({
        activeFilePath: "src/App.tsx",
        activeFileContent: "export default function App() {}",
        selection: "function App()",
        activeError: "TS2304: Cannot find name 'App'",
        userPrompt: "Fix this error",
      });

      expect(prompt).toContain("=== ACTIVE FILE: src/App.tsx ===");
      expect(prompt).toContain("export default function App() {}");
      expect(prompt).toContain("=== SELECTED CODE ===");
      expect(prompt).toContain("function App()");
      expect(prompt).toContain("=== ACTIVE COMPILER / LSP ERROR ===");
      expect(prompt).toContain("TS2304: Cannot find name 'App'");
      expect(prompt).toContain("=== USER REQUEST ===\nFix this error");
    });
  });

  describe("generateErrorFixPrompt", () => {
    it("formats autonomous error repair request with line number", () => {
      const prompt = generateErrorFixPrompt(
        "expected ';' at end of statement",
        "src/main.rs",
        "let x = 10",
        42
      );

      expect(prompt).toContain("Fahh Error at line 42: expected ';' at end of statement");
      expect(prompt).toContain("Fix the compiler/LSP error in src/main.rs");
    });
  });

  describe("applyCodeToEditor", () => {
    it("updates active tab content in EditorStore and marks dirty", () => {
      useEditorStore.getState().openFile(
        { path: "test.ts", name: "test.ts", dirty: false },
        "original content"
      );

      const applied = applyCodeToEditor("test.ts", "updated content");
      expect(applied).toBe(true);

      const store = useEditorStore.getState();
      expect(store.fileContents["test.ts"]).toBe("updated content");
      expect(store.openTabs.find((t) => t.path === "test.ts")?.dirty).toBe(true);
    });
  });
});
