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
