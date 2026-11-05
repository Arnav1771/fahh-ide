/**
 * Editor conveniences that are not language servers: Emmet (html, css, jsx/tsx) and
 * relative path completion in import strings. Called once from monaco-setup.ts.
 */
import type * as Monaco from "monaco-editor";
import { emmetCSS, emmetHTML, emmetJSX } from "emmet-monaco-es";
import { useSettingsStore } from "../store/settingsStore";
import { useFileStore } from "../store/fileStore";
import { pathContext, pathSuggestions } from "./pathCompletion";
import { getLspService } from "./lsp/monacoLsp";
import { primaryServerFor } from "./lsp/servers";
import { uriToFahhPath } from "./lsp/protocol";

const PATH_LANGUAGES = ["typescript", "javascript", "html", "css", "scss", "less", "markdown"];

export function initEditorExtras(monaco: typeof Monaco): void {
  // ── Emmet, behind Settings > Emmet ─────────────────────────────────────────
  let emmetOff: (() => void)[] = [];
  const applyEmmet = (on: boolean) => {
    emmetOff.forEach((off) => off());
    emmetOff = on
      ? [emmetHTML(monaco, ["html"]), emmetCSS(monaco, ["css", "scss", "less"]), emmetJSX(monaco, ["javascript", "typescript"])]
      : [];
  };
  let emmet = useSettingsStore.getState().emmet;
  applyEmmet(emmet);
  useSettingsStore.subscribe((s) => {
    if (s.emmet !== emmet) applyEmmet((emmet = s.emmet));
  });

  // ── Relative paths in import strings ───────────────────────────────────────
  const windows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
  monaco.languages.registerCompletionItemProvider(PATH_LANGUAGES, {
    triggerCharacters: ["/", "\"", "'", "."],
    provideCompletionItems(model, position) {
      if (model.uri.scheme !== "file") return undefined;
      const language = model.getLanguageId();
      // A running language server completes paths itself (tsserver, html, css): no doubles.
      const primary = primaryServerFor(language);
      if (primary && getLspService()?.client.isReady(primary)) return undefined;
      const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const ctx = pathContext(before, language);
      if (!ctx) return undefined;
      const tail = ctx.typed.length - ctx.typed.lastIndexOf("/") - 1;
      const range = new monaco.Range(position.lineNumber, position.column - tail, position.lineNumber, position.column);
      const filePath = uriToFahhPath(model.uri.toString(), windows);
      const items = pathSuggestions(useFileStore.getState().tree, filePath, ctx.typed, language);
      return {
        suggestions: items.map((s) => ({
          label: s.label,
          kind: s.isDir ? monaco.languages.CompletionItemKind.Folder : monaco.languages.CompletionItemKind.File,
          insertText: s.insertText,
          range,
          sortText: (s.isDir ? "0" : "1") + s.label,
          // Keep the list going into a folder.
          command: s.isDir ? { id: "editor.action.triggerSuggest", title: "" } : undefined,
        })),
      };
    },
  });
}
