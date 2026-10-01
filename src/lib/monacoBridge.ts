/**
 * The last mile of the diagnostics path: getting LSP markers onto the model
 * that Monaco is actually rendering.
 *
 * `EditorPane` drives a single Monaco model whose contents are swapped when
 * the active tab changes (that is how `@monaco-editor/react` works when it is
 * used as a controlled `value` component). So there is no per-file model to
 * look up by URI — instead this module remembers the markers for every file
 * and re-applies the right set whenever the active document changes.
 *
 * `EditorPane` calls `attachMonaco` / `setActiveDocument`; `LspBridge` calls
 * `publishDiagnostics`. Neither knows about the other.
 *
 * Typed against structural interfaces rather than `monaco-editor` types so
 * that this file — and its tests — never import Monaco itself.
 */

import type { FahhMarker } from "./diagnostics";

/** The owner string Monaco groups our markers under. */
export const MARKER_OWNER = "fahh-lsp";

export interface MonacoModelLike {
  isDisposed?: () => boolean;
}

export interface MonacoApiLike {
  editor: {
    setModelMarkers(
      model: MonacoModelLike,
      owner: string,
      markers: FahhMarker[]
    ): void;
  };
}

export interface MonacoEditorLike {
  getModel(): MonacoModelLike | null;
  getAction?(id: string): { run(): Promise<void> | void } | null;
  focus?(): void;
  revealLineInCenter?(line: number): void;
  setPosition?(pos: { lineNumber: number; column: number }): void;
}

/** Jump the editor to a 1-based line (the preview's double-click does this). */
export function revealLine(line: number): boolean {
  if (!editorInstance?.revealLineInCenter) return false;
  editorInstance.revealLineInCenter(line);
  editorInstance.setPosition?.({ lineNumber: line, column: 1 });
  editorInstance.focus?.();
  return true;
}

let monacoApi: MonacoApiLike | null = null;
let editorInstance: MonacoEditorLike | null = null;
let activePath: string | null = null;

/** path -> markers. Kept for every file we have heard about, so switching
 *  tabs back and forth does not lose diagnostics. */
const markersByPath = new Map<string, FahhMarker[]>();

function applyToModel(markers: FahhMarker[]): void {
  if (!monacoApi || !editorInstance) return;
  const model = editorInstance.getModel();
  if (!model) return;
  if (model.isDisposed?.()) return;
  monacoApi.editor.setModelMarkers(model, MARKER_OWNER, markers);
}

/** Push whatever the active document's markers currently are. */
function flush(): void {
  const markers = activePath ? markersByPath.get(activePath) ?? [] : [];
  applyToModel(markers);
}

/** Called by `EditorPane` from Monaco's `onMount`. */
export function attachMonaco(
  api: MonacoApiLike,
  editor: MonacoEditorLike
): void {
  monacoApi = api;
  editorInstance = editor;
  flush();
}

/** Called when the editor unmounts, so we never touch a dead model. */
export function detachMonaco(): void {
  monacoApi = null;
  editorInstance = null;
}

/**
 * Called by `EditorPane` whenever the active tab changes. Passing `null`
 * (no file open) clears the markers from the shared model.
 */
export function setActiveDocument(path: string | null): void {
  activePath = path;
  flush();
}

export function getActiveDocument(): string | null {
  return activePath;
}

/**
 * Called by `LspBridge` for every `textDocument/publishDiagnostics`.
 *
 * An empty array is meaningful — it is how a language server says "this file
 * is clean now" — so it is stored rather than dropped, and it clears the
 * squiggles if the file is on screen.
 */
export function publishDiagnostics(path: string, markers: FahhMarker[]): void {
  markersByPath.set(path, markers);
  if (path === activePath) flush();
}

/** Drop everything we know about a file (used when its tab is closed). */
export function clearDiagnostics(path: string): void {
  markersByPath.delete(path);
  if (path === activePath) flush();
}

/** Read back what is stored for a path — used by tests and the status bar. */
export function getDiagnostics(path: string): FahhMarker[] {
  return markersByPath.get(path) ?? [];
}

/** Total marker count across all known files. */
export function totalDiagnosticCount(): number {
  let total = 0;
  for (const markers of markersByPath.values()) total += markers.length;
  return total;
}

/**
 * Run a built-in editor action on the live editor, e.g. the status bar's
 * "next problem" (`editor.action.marker.next`). False when no editor is up.
 */
export function runEditorAction(id: string): boolean {
  const action = editorInstance?.getAction?.(id);
  if (!action) return false;
  editorInstance?.focus?.();
  void action.run();
  return true;
}

/**
 * The Monaco model path for a file on disk. Each file gets its own model, so
 * TypeScript sees the real extension (a .tsx file parses JSX) and each tab
 * keeps its own undo history. Windows paths become `file:///C:/...`, because
 * a bare `C:\...` would be read as a URI with the scheme "c".
 */
export function modelPathFor(path: string): string {
  const forward = path.replace(/\\/g, "/");
  return forward.startsWith("/") ? `file://${forward}` : `file:///${forward}`;
}

/** Test-only: return the module to its initial state. */
export function resetMonacoBridge(): void {
  monacoApi = null;
  editorInstance = null;
  activePath = null;
  markersByPath.clear();
}
