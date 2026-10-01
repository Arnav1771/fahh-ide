// Bundle Monaco locally instead of fetching it from a CDN at runtime.
//
// `@monaco-editor/react` defaults to loading the Monaco core from jsdelivr via
// `@monaco-editor/loader`. That works in `vite dev` (online, no CSP) but FAILS
// in the packaged desktop app: the WebView runs on the `tauri://` custom-
// protocol origin with no reliable network, so the remote fetch never resolves
// and the editor renders blank — code files never appear on screen.
//
// Importing this module once (from `main.tsx`, before the app renders) points
// the loader at the locally-bundled `monaco-editor` package and wires up the
// language web workers as Vite worker chunks, so everything ships inside the
// app and works fully offline.

import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";

import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

// Hand the React wrapper the bundled instance so it never touches the CDN.
loader.config({ monaco });

// Monaco's built-in TypeScript checker sees one file at a time, with no
// node_modules and no tsconfig. Left at its defaults it underlines every JSX
// tag and every import, and an error-sound IDE would then fahh at code that is
// fine. Parse JSX the way modern React projects do, and ignore only the
// diagnostics that come from not seeing the rest of the project.
const PROJECT_BLIND_CODES = [
  2307, // Cannot find module 'x'
  2792, // Cannot find module 'x'. Did you mean to set moduleResolution...
  7016, // Could not find a declaration file for module 'x'
  7026, // JSX element implicitly has type 'any' (no JSX.IntrinsicElements)
  2875, // This JSX tag requires the module path 'react/jsx-runtime' to exist
];
const ts = monaco.languages.typescript;
for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
  defaults.setCompilerOptions({
    ...defaults.getCompilerOptions(),
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    allowNonTsExtensions: true,
    esModuleInterop: true,
  });
  defaults.setDiagnosticsOptions({
    ...defaults.getDiagnosticsOptions(),
    diagnosticCodesToIgnore: PROJECT_BLIND_CODES,
  });
}
