import { invoke } from "@tauri-apps/api/core";
import type { Monaco } from "@monaco-editor/react";
import type { editor as MonacoEditor, IDisposable } from "monaco-editor";
import { useLspStore } from "../store/lspStore";

/**
 * Syntax errors for Python and Rust when no language server is running.
 *
 * Monaco only lints TS/JS/JSON/CSS/HTML by itself, so a broken .py or .rs file
 * had no markers: no underline, no Error Lens and no fahh. This asks the
 * backend (`syntax_check`) and puts the result on the model under its own
 * owner. EditorPane's marker counter does the rest. When the language server
 * for that language is ready, it owns the diagnostics and these are cleared.
 */
export const SYNTAX_OWNER = "fahh-syntax";
export const SYNTAX_LANGUAGES = new Set(["python", "rust"]);
const DEBOUNCE_MS = 500;

export interface SyntaxError {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
}

/** Check this language only while its language server is not ready. */
export function wantsSyntaxCheck(language: string, lspState: string | undefined): boolean {
  return SYNTAX_LANGUAGES.has(language) && lspState !== "ready";
}

export function toMarkers(errors: SyntaxError[], errorSeverity: number): MonacoEditor.IMarkerData[] {
  return errors.map((e) => ({
    severity: errorSeverity,
    startLineNumber: e.line,
    startColumn: e.column,
    endLineNumber: e.endLine,
    endColumn: e.endColumn,
    message: e.message,
    source: "syntax",
  }));
}

export function attachSyntaxCheck(monaco: Monaco, editor: MonacoEditor.IStandaloneCodeEditor): IDisposable {
  let timer: number | undefined;

  const check = async () => {
    const model = editor.getModel();
    if (!model || model.isDisposed()) return;
    const language = model.getLanguageId();
    if (!wantsSyntaxCheck(language, useLspStore.getState().servers[language]?.state)) {
      monaco.editor.setModelMarkers(model, SYNTAX_OWNER, []);
      return;
    }
    const version = model.getVersionId();
    let errors: SyntaxError[] = [];
    try {
      errors = await invoke<SyntaxError[]>("syntax_check", { language, text: model.getValue() });
    } catch {
      return; // not running inside Tauri, or the check failed: show nothing rather than guess
    }
    // A slow answer for text that has since changed is dropped; the newer check will land.
    if (model.isDisposed() || model.getVersionId() !== version) return;
    monaco.editor.setModelMarkers(model, SYNTAX_OWNER, toMarkers(errors, monaco.MarkerSeverity.Error));
  };

  const schedule = (ms = DEBOUNCE_MS) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void check(), ms);
  };

  const disposables = [
    editor.onDidChangeModelContent(() => schedule()),
    editor.onDidChangeModel(() => schedule(0)),
  ];
  // A language server coming up (or going down) changes who owns the diagnostics.
  const unsubscribe = useLspStore.subscribe(() => schedule(0));
  schedule(0);

  return {
    dispose() {
      window.clearTimeout(timer);
      disposables.forEach((d) => d.dispose());
      unsubscribe();
    },
  };
}
