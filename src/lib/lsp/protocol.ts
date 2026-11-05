/**
 * Pure LSP <-> Monaco translation. No Monaco import (the numbers below are Monaco's
 * enum values, pinned by tests), no Tauri, no React: everything here is unit-tested.
 *
 * LSP positions are 0-based line + UTF-16 character; Monaco's are 1-based line +
 * 1-based UTF-16 column, so a range maps with +1 on both and nothing else.
 */

// ─── Minimal LSP shapes (only the fields we read) ─────────────────────────────

export interface LspPosition { line: number; character: number }
export interface LspRange { start: LspPosition; end: LspPosition }
export interface LspTextEdit { range: LspRange; newText: string }
export interface LspLocation { uri: string; range: LspRange }
export interface LspLocationLink { targetUri: string; targetRange: LspRange; targetSelectionRange?: LspRange; originSelectionRange?: LspRange }
export interface LspMarkupContent { kind: "markdown" | "plaintext"; value: string }
export type LspMarkedString = string | { language: string; value: string };
export interface LspCommand { title: string; command: string; arguments?: unknown[] }
export interface LspDiagnostic { range: LspRange; message: string; severity?: number; code?: string | number; source?: string }

export interface LspCompletionItem {
  label: string;
  labelDetails?: { detail?: string; description?: string };
  kind?: number;
  tags?: number[];
  detail?: string;
  documentation?: string | LspMarkupContent;
  deprecated?: boolean;
  preselect?: boolean;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: LspTextEdit | { newText: string; insert: LspRange; replace: LspRange };
  textEditText?: string;
  additionalTextEdits?: LspTextEdit[];
  commitCharacters?: string[];
  command?: LspCommand;
  data?: unknown;
}
export interface LspCompletionList {
  isIncomplete?: boolean;
  items: LspCompletionItem[];
  itemDefaults?: { editRange?: LspRange | { insert: LspRange; replace: LspRange }; insertTextFormat?: number; commitCharacters?: string[]; data?: unknown };
}

export interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: Array<
    | { textDocument: { uri: string; version?: number | null }; edits: LspTextEdit[] }
    | { kind: "create"; uri: string; options?: { overwrite?: boolean; ignoreIfExists?: boolean } }
    | { kind: "rename"; oldUri: string; newUri: string }
    | { kind: "delete"; uri: string }
  >;
}

// ─── Monaco-side shapes (structural) ──────────────────────────────────────────

export interface MRange { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
export interface MPosition { lineNumber: number; column: number }
export interface MMarkdown { value: string; isTrusted?: boolean }
export interface MTextEdit { range: MRange; text: string }

/** Monaco's `CompletionItemKind` values (monaco-editor 0.52). */
export const MonacoCompletionKind = {
  Method: 0, Function: 1, Constructor: 2, Field: 3, Variable: 4, Class: 5, Struct: 6, Interface: 7,
  Module: 8, Property: 9, Event: 10, Operator: 11, Unit: 12, Value: 13, Constant: 14, Enum: 15,
  EnumMember: 16, Keyword: 17, Text: 18, Color: 19, File: 20, Reference: 21, Customcolor: 22,
  Folder: 23, TypeParameter: 24, User: 25, Issue: 26, Snippet: 27,
} as const;

/** LSP CompletionItemKind (1-based) -> Monaco CompletionItemKind. */
const COMPLETION_KIND: Record<number, number> = {
  1: MonacoCompletionKind.Text, 2: MonacoCompletionKind.Method, 3: MonacoCompletionKind.Function,
  4: MonacoCompletionKind.Constructor, 5: MonacoCompletionKind.Field, 6: MonacoCompletionKind.Variable,
  7: MonacoCompletionKind.Class, 8: MonacoCompletionKind.Interface, 9: MonacoCompletionKind.Module,
  10: MonacoCompletionKind.Property, 11: MonacoCompletionKind.Unit, 12: MonacoCompletionKind.Value,
  13: MonacoCompletionKind.Enum, 14: MonacoCompletionKind.Keyword, 15: MonacoCompletionKind.Snippet,
  16: MonacoCompletionKind.Color, 17: MonacoCompletionKind.File, 18: MonacoCompletionKind.Reference,
  19: MonacoCompletionKind.Folder, 20: MonacoCompletionKind.EnumMember, 21: MonacoCompletionKind.Constant,
  22: MonacoCompletionKind.Struct, 23: MonacoCompletionKind.Event, 24: MonacoCompletionKind.Operator,
  25: MonacoCompletionKind.TypeParameter,
};

export const completionKind = (lspKind: number | undefined): number =>
  lspKind !== undefined && lspKind in COMPLETION_KIND ? COMPLETION_KIND[lspKind] : MonacoCompletionKind.Text;

/** Monaco `CompletionItemInsertTextRule.InsertAsSnippet`. */
export const INSERT_AS_SNIPPET = 4;

// ─── Positions and ranges ─────────────────────────────────────────────────────

export const toMonacoRange = (r: LspRange): MRange => ({
  startLineNumber: r.start.line + 1,
  startColumn: r.start.character + 1,
  endLineNumber: r.end.line + 1,
  endColumn: r.end.character + 1,
});

export const toLspPosition = (p: MPosition): LspPosition => ({ line: p.lineNumber - 1, character: p.column - 1 });

export const toLspRange = (r: MRange): LspRange => ({
  start: { line: r.startLineNumber - 1, character: r.startColumn - 1 },
  end: { line: r.endLineNumber - 1, character: r.endColumn - 1 },
});

export const toMonacoTextEdit = (e: LspTextEdit): MTextEdit => ({ range: toMonacoRange(e.range), text: e.newText });

// ─── Markdown ─────────────────────────────────────────────────────────────────

/** One MarkedString / MarkupContent to markdown text ("" when empty). */
export function markupToMarkdown(c: LspMarkedString | LspMarkupContent | null | undefined): string {
  if (!c) return "";
  if (typeof c === "string") return c;
  if ("kind" in c) return c.kind === "plaintext" ? escapeMarkdown(c.value) : c.value;
  if ("language" in c) return c.value.trim() ? "```" + c.language + "\n" + c.value + "\n```" : "";
  return "";
}

const escapeMarkdown = (s: string) => s.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, (m) => "\\" + m);

export function documentationToMonaco(doc: string | LspMarkupContent | undefined): string | MMarkdown | undefined {
  if (doc === undefined || doc === null) return undefined;
  if (typeof doc === "string") return doc || undefined;
  if (!doc.value) return undefined;
  return doc.kind === "markdown" ? { value: doc.value } : doc.value;
}

// ─── Hover ────────────────────────────────────────────────────────────────────

export interface LspHover { contents: LspMarkedString | LspMarkedString[] | LspMarkupContent; range?: LspRange }

export function hoverToMonaco(h: LspHover | null | undefined): { contents: MMarkdown[]; range?: MRange } | null {
  if (!h || h.contents === undefined || h.contents === null) return null;
  const parts = Array.isArray(h.contents) ? h.contents : [h.contents];
  const contents = parts.map(markupToMarkdown).filter((v) => v.trim() !== "").map((value) => ({ value }));
  if (!contents.length) return null;
  return h.range ? { contents, range: toMonacoRange(h.range) } : { contents };
}

// ─── Completion ───────────────────────────────────────────────────────────────

export interface MCompletionItem {
  label: string | { label: string; detail?: string; description?: string };
  kind: number;
  insertText: string;
  insertTextRules?: number;
  range: MRange | { insert: MRange; replace: MRange };
  detail?: string;
  documentation?: string | MMarkdown;
  sortText?: string;
  filterText?: string;
  preselect?: boolean;
  commitCharacters?: string[];
  additionalTextEdits?: MTextEdit[];
  tags?: number[];
  /** The original LSP item (plus its server), for completionItem/resolve. */
  lsp?: { item: LspCompletionItem; server: string };
}

const isInsertReplace = (e: unknown): e is { insert: LspRange; replace: LspRange } =>
  !!e && typeof e === "object" && "insert" in e && "replace" in e;

/**
 * `textDocument/completion` reply -> Monaco suggestions. `defaultRange` is the word
 * at the cursor (Monaco's own default), used when the server sends no edit range.
 */
export function completionsToMonaco(
  result: LspCompletionItem[] | LspCompletionList | null | undefined,
  defaultRange: MRange,
  server = ""
): { suggestions: MCompletionItem[]; incomplete: boolean } {
  if (!result) return { suggestions: [], incomplete: false };
  const list: LspCompletionList = Array.isArray(result) ? { items: result } : result;
  const defaults = list.itemDefaults ?? {};
  const suggestions = (list.items ?? []).map((raw) => {
    const item: LspCompletionItem = {
      ...raw,
      insertTextFormat: raw.insertTextFormat ?? defaults.insertTextFormat,
      commitCharacters: raw.commitCharacters ?? defaults.commitCharacters,
      data: raw.data ?? defaults.data,
    };
    let range: MCompletionItem["range"] = defaultRange;
    let insertText = item.insertText ?? item.label;
    if (item.textEdit) {
      insertText = item.textEdit.newText;
      range = isInsertReplace(item.textEdit)
        ? { insert: toMonacoRange(item.textEdit.insert), replace: toMonacoRange(item.textEdit.replace) }
        : toMonacoRange(item.textEdit.range);
    } else if (defaults.editRange) {
      insertText = item.textEditText ?? item.insertText ?? item.label;
      range = isInsertReplace(defaults.editRange)
        ? { insert: toMonacoRange(defaults.editRange.insert), replace: toMonacoRange(defaults.editRange.replace) }
        : toMonacoRange(defaults.editRange);
    }
    const m: MCompletionItem = {
      label: item.labelDetails ? { label: item.label, detail: item.labelDetails.detail, description: item.labelDetails.description } : item.label,
      kind: completionKind(item.kind),
      insertText,
      range,
      lsp: { item, server },
    };
    if (item.insertTextFormat === 2) m.insertTextRules = INSERT_AS_SNIPPET;
    if (item.detail) m.detail = item.detail;
    const doc = documentationToMonaco(item.documentation);
    if (doc) m.documentation = doc;
    if (item.sortText) m.sortText = item.sortText;
    if (item.filterText) m.filterText = item.filterText;
    if (item.preselect) m.preselect = true;
    if (item.commitCharacters?.length) m.commitCharacters = item.commitCharacters;
    if (item.additionalTextEdits?.length) m.additionalTextEdits = item.additionalTextEdits.map(toMonacoTextEdit);
    if (item.deprecated || item.tags?.includes(1)) m.tags = [1];
    return m;
  });
  return { suggestions, incomplete: !!list.isIncomplete };
}

/** Fold a `completionItem/resolve` reply into the suggestion Monaco already shows. */
export function applyResolvedCompletion(m: MCompletionItem, resolved: LspCompletionItem | null | undefined): MCompletionItem {
  if (!resolved) return m;
  const out: MCompletionItem = { ...m, lsp: m.lsp ? { ...m.lsp, item: resolved } : undefined };
  if (resolved.detail) out.detail = resolved.detail;
  const doc = documentationToMonaco(resolved.documentation);
  if (doc) out.documentation = doc;
  if (resolved.additionalTextEdits?.length) out.additionalTextEdits = resolved.additionalTextEdits.map(toMonacoTextEdit);
  return out;
}

// ─── Locations ────────────────────────────────────────────────────────────────

export interface MLocation { uri: string; range: MRange }

/** Definition / references reply (Location, Location[] or LocationLink[]) -> flat list. */
export function locationsToMonaco(result: LspLocation | LspLocation[] | LspLocationLink[] | null | undefined): MLocation[] {
  if (!result) return [];
  const list = (Array.isArray(result) ? result : [result]) as Array<LspLocation | LspLocationLink>;
  return list
    .map((l) =>
      "targetUri" in l
        ? { uri: l.targetUri, range: toMonacoRange(l.targetSelectionRange ?? l.targetRange) }
        : l && "uri" in l
          ? { uri: l.uri, range: toMonacoRange(l.range) }
          : null
    )
    .filter((l): l is MLocation => !!l);
}

// ─── Signature help ───────────────────────────────────────────────────────────

export interface LspSignatureHelp {
  signatures: Array<{
    label: string;
    documentation?: string | LspMarkupContent;
    parameters?: Array<{ label: string | [number, number]; documentation?: string | LspMarkupContent }>;
    activeParameter?: number;
  }>;
  activeSignature?: number;
  activeParameter?: number;
}

export function signatureHelpToMonaco(h: LspSignatureHelp | null | undefined) {
  if (!h || !h.signatures?.length) return null;
  return {
    signatures: h.signatures.map((s) => ({
      label: s.label,
      documentation: documentationToMonaco(s.documentation),
      parameters: (s.parameters ?? []).map((p) => ({ label: p.label, documentation: documentationToMonaco(p.documentation) })),
      ...(s.activeParameter !== undefined ? { activeParameter: s.activeParameter } : {}),
    })),
    activeSignature: Math.min(h.activeSignature ?? 0, h.signatures.length - 1),
    activeParameter: h.activeParameter ?? 0,
  };
}

// ─── Document highlights and inlay hints ──────────────────────────────────────

/** LSP DocumentHighlightKind 1/2/3 (Text/Read/Write) -> Monaco 0/1/2. */
export function highlightsToMonaco(list: Array<{ range: LspRange; kind?: number }> | null | undefined) {
  return (list ?? []).map((h) => ({ range: toMonacoRange(h.range), kind: h.kind ? h.kind - 1 : 0 }));
}

export interface LspInlayHint {
  position: LspPosition;
  label: string | Array<{ value: string; tooltip?: string | LspMarkupContent }>;
  kind?: number;
  tooltip?: string | LspMarkupContent;
  paddingLeft?: boolean;
  paddingRight?: boolean;
}

export function inlayHintsToMonaco(list: LspInlayHint[] | null | undefined) {
  return (list ?? []).map((h) => ({
    position: { lineNumber: h.position.line + 1, column: h.position.character + 1 },
    label: typeof h.label === "string" ? h.label : h.label.map((p) => ({ label: p.value, tooltip: documentationToMonaco(p.tooltip) })),
    ...(h.kind ? { kind: h.kind } : {}),
    ...(h.tooltip ? { tooltip: documentationToMonaco(h.tooltip) } : {}),
    paddingLeft: !!h.paddingLeft,
    paddingRight: !!h.paddingRight,
  }));
}

// ─── Diagnostics for code actions ─────────────────────────────────────────────

/** Monaco MarkerSeverity (8/4/2/1) -> LSP DiagnosticSeverity (1..4). */
export function markerSeverityToLsp(s: number): number {
  return s >= 8 ? 1 : s >= 4 ? 2 : s >= 2 ? 3 : 4;
}

// ─── Workspace edits ──────────────────────────────────────────────────────────

export type FileOp =
  | { kind: "create"; uri: string; overwrite?: boolean; ignoreIfExists?: boolean }
  | { kind: "rename"; oldUri: string; newUri: string }
  | { kind: "delete"; uri: string };

/**
 * Flatten a WorkspaceEdit: text edits grouped by document (in order of first mention),
 * and file operations kept in the order the server listed them.
 */
export function flattenWorkspaceEdit(edit: LspWorkspaceEdit | null | undefined): { edits: Map<string, LspTextEdit[]>; ops: FileOp[] } {
  const edits = new Map<string, LspTextEdit[]>();
  const ops: FileOp[] = [];
  if (!edit) return { edits, ops };
  const add = (uri: string, list: LspTextEdit[]) => edits.set(uri, [...(edits.get(uri) ?? []), ...list]);
  if (edit.documentChanges?.length) {
    for (const c of edit.documentChanges) {
      if ("textDocument" in c) add(c.textDocument.uri, c.edits ?? []);
      else if (c.kind === "create") ops.push({ kind: "create", uri: c.uri, overwrite: c.options?.overwrite, ignoreIfExists: c.options?.ignoreIfExists });
      else if (c.kind === "rename") ops.push({ kind: "rename", oldUri: c.oldUri, newUri: c.newUri });
      else if (c.kind === "delete") ops.push({ kind: "delete", uri: c.uri });
    }
  } else if (edit.changes) {
    for (const [uri, list] of Object.entries(edit.changes)) add(uri, list ?? []);
  }
  return { edits, ops };
}

/** Offset of an LSP position in `text` (clamped, like servers expect). */
export function offsetAt(text: string, pos: LspPosition): number {
  let line = 0;
  let i = 0;
  while (line < pos.line) {
    const nl = text.indexOf("\n", i);
    if (nl < 0) return text.length;
    i = nl + 1;
    line++;
  }
  const lineEnd = text.indexOf("\n", i);
  const end = lineEnd < 0 ? text.length : lineEnd > i && text[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd;
  return Math.min(i + pos.character, end);
}

/** Apply LSP text edits to a string (all ranges refer to the original text). */
export function applyTextEdits(text: string, edits: LspTextEdit[]): string {
  const withOffsets = edits.map((e, idx) => ({ start: offsetAt(text, e.range.start), end: offsetAt(text, e.range.end), text: e.newText, idx }));
  // Back to front; for equal starts keep the server's order (stable sort, then reversed).
  withOffsets.sort((a, b) => a.start - b.start || a.idx - b.idx);
  let out = text;
  for (let k = withOffsets.length - 1; k >= 0; k--) {
    const e = withOffsets[k];
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

// ─── URIs and paths ───────────────────────────────────────────────────────────

/**
 * A file URI back to the path Fahh uses for tabs. `windows` picks the separator style:
 * file:///c%3A/x/y -> C:\x\y, file://wsl.localhost/Ubuntu/x -> \\wsl.localhost\Ubuntu\x.
 */
export function uriToFahhPath(uri: string, windows: boolean): string {
  if (!uri.startsWith("file://")) return uri;
  const rest = uri.slice("file://".length);
  const slash = rest.indexOf("/");
  const authority = slash < 0 ? rest : rest.slice(0, slash);
  let path = slash < 0 ? "/" : rest.slice(slash);
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the raw form
  }
  if (authority) {
    const unc = `//${authority}${path}`;
    return windows ? unc.replace(/\//g, "\\") : unc;
  }
  const drive = /^\/([a-zA-Z]):(.*)$/.exec(path);
  if (drive) {
    const p = `${drive[1].toUpperCase()}:${drive[2] || "/"}`;
    return windows ? p.replace(/\//g, "\\") : p;
  }
  return path;
}

/** The comparison key for a path: one separator style, and case-insensitive on Windows. */
export function pathKey(path: string): string {
  const fwd = path.replace(/\\/g, "/");
  return /^[a-zA-Z]:\//.test(fwd) || fwd.startsWith("//") ? fwd.toLowerCase() : fwd;
}
