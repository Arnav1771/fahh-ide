/**
 * Fahh Editor: AI Composer Engine (Cursor & Windsurf Grade)
 *
 * Implements:
 * 1. Code block extraction from LLM markdown with language and file target detection.
 * 2. Rich context bundling (@file, @selection, @diagnostics/errors).
 * 3. Autonomous Fahh error-fix prompt generation.
 * 4. Safe buffer application to the active Monaco editor tab.
 */

import { useEditorStore } from "../store/editorStore";

export interface CodeBlock {
  language: string;
  code: string;
  filePath?: string;
}

export interface ComposerContextOptions {
  activeFilePath?: string | null;
  activeFileContent?: string | null;
  selection?: string | null;
  activeError?: string | null;
  userPrompt: string;
}

/**
 * Extracts markdown code fences from an AI response.
 * Detects file names in the code fence header (e.g. ```typescript file="src/App.tsx")
 * or from leading comments inside the code block (e.g. // File: src/App.tsx).
 */
export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const regex = /```([a-zA-Z0-9_-]*)(?:\s+(?:file=)?["']?([^\s"']+)["']?)?\n([\s\S]*?)```/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const rawLang = match[1]?.trim() || "plaintext";
    let filePath = match[2]?.trim();
    let code = match[3] ?? "";

    // Check if code block starts with a file comment e.g. // src/foo.ts or # src/foo.py
    if (!filePath) {
      const firstLine = code.split("\n")[0]?.trim();
      const fileCommentMatch = firstLine?.match(/^(?:\/\/|#|\/\*)\s*(?:[Ff]ile:\s*)?([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+)/);
      if (fileCommentMatch) {
        filePath = fileCommentMatch[1];
      }
    }

    blocks.push({
      language: rawLang,
      filePath,
      code: code.trimEnd(),
    });
  }

  return blocks;
}

/**
 * Bundles active editor state, user selection, and Fahh diagnostics
 * into an engineered prompt for Cursor-like contextual awareness.
 */
export function buildComposerPrompt(options: ComposerContextOptions): string {
  const parts: string[] = [];

  if (options.activeFilePath && options.activeFileContent) {
    parts.push(`=== ACTIVE FILE: ${options.activeFilePath} ===\n\`\`\`\n${options.activeFileContent}\n\`\`\``);
  }

  if (options.selection && options.selection.trim()) {
    parts.push(`=== SELECTED CODE ===\n\`\`\`\n${options.selection.trim()}\n\`\`\``);
  }

  if (options.activeError && options.activeError.trim()) {
    parts.push(`=== ACTIVE COMPILER / LSP ERROR ===\n${options.activeError.trim()}`);
  }

  parts.push(`=== USER REQUEST ===\n${options.userPrompt}`);

  return parts.join("\n\n");
}

/**
 * Generates an autonomous self-healing prompt when Fahh SFX detects an error.
 */
export function generateErrorFixPrompt(
  errorMessage: string,
  filePath: string,
  fileContent: string,
  errorLine?: number | null
): string {
  const lineContext = errorLine ? ` at line ${errorLine}` : "";
  return buildComposerPrompt({
    activeFilePath: filePath,
    activeFileContent: fileContent,
    activeError: `Fahh Error${lineContext}: ${errorMessage}`,
    userPrompt: `Fix the compiler/LSP error in ${filePath}. Output the complete corrected code or the targeted replacement function inside a fenced code block with file="${filePath}".`,
  });
}

/**
 * Replaces the contents of the open tab for `filePath` with `newContent`, unsaved
 * (the tab is marked dirty: Ctrl+S keeps it, closing without saving throws it away).
 *
 * Only ever the file the code block is for: if that file is not open, nothing is
 * written and this returns false. (It used to fall back to the active tab, which
 * overwrote a different file with code meant for another.)
 */
export function applyCodeToEditor(filePath: string, newContent: string): boolean {
  const store = useEditorStore.getState();
  const target = store.openTabs.find((t) => t.path === filePath)?.path
    ?? (store.activeTab === filePath ? filePath : null);
  if (!target) return false;
  store.setContent(target, newContent);
  store.markDirty(target, true);
  return true;
}
