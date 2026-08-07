/**
 * LSP `textDocument/publishDiagnostics` -> Monaco marker conversion.
 *
 * Kept free of any `monaco-editor` import so it can be unit-tested in a plain
 * Node environment. The severity numbers below are Monaco's `MarkerSeverity`
 * enum values, which are part of Monaco's public API and stable across
 * releases.
 */

/** Monaco's `MarkerSeverity`, inlined so this module has no monaco import. */
export const MarkerSeverity = {
  Hint: 1,
  Info: 2,
  Warning: 4,
  Error: 8,
} as const;

/** LSP `DiagnosticSeverity`. 1 = Error, 4 = Hint. */
export const LspSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const;

export interface LspPosition {
  /** 0-based. */
  line: number;
  /** 0-based. */
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspDiagnostic {
  range: LspRange;
  /** Omitted means "the server did not say" — LSP tells clients to treat it
   *  as the most severe, so it lands as an Error. */
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
}

export interface PublishDiagnosticsParams {
  uri: string;
  version?: number;
  diagnostics: LspDiagnostic[];
}

/** Monaco `IMarkerData`, minus the fields Monaco fills in itself. */
export interface FahhMarker {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity: number;
  source?: string;
  code?: string;
}

/** LSP severity -> Monaco severity. Unknown/missing values become Error. */
export function toMarkerSeverity(severity: number | undefined): number {
  switch (severity) {
    case LspSeverity.Warning:
      return MarkerSeverity.Warning;
    case LspSeverity.Information:
      return MarkerSeverity.Info;
    case LspSeverity.Hint:
      return MarkerSeverity.Hint;
    case LspSeverity.Error:
      return MarkerSeverity.Error;
    default:
      return MarkerSeverity.Error;
  }
}

/**
 * `file:///home/x/a.py` -> `/home/x/a.py`, and
 * `file:///C:/Users/x/a.ts` -> `C:/Users/x/a.ts`.
 *
 * Percent-escapes are decoded (spaces in paths are extremely common). A URI
 * with a scheme we do not recognise is returned unchanged, since the only
 * thing we do with the result is compare it against an editor path.
 */
export function uriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri;

  let path = uri.slice("file://".length);
  // Strip an (empty) authority: file:///a -> /a leaves a leading slash we keep.
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed escape — keep the raw form rather than throwing.
  }
  // Windows drive letters arrive as /C:/… — drop the leading slash.
  if (/^\/[a-zA-Z]:/.test(path)) {
    path = path.slice(1);
  }
  return path;
}

/** True when at least one diagnostic is error severity — the SFX trigger. */
export function hasErrorDiagnostic(diagnostics: LspDiagnostic[]): boolean {
  return diagnostics.some(
    (d) => toMarkerSeverity(d.severity) === MarkerSeverity.Error
  );
}

/**
 * Convert diagnostics to Monaco markers.
 *
 * LSP positions are 0-based; Monaco's are 1-based, so every coordinate is
 * shifted by one. Servers occasionally emit an end position before the start
 * (or a negative line, after an edit races a publish); those are clamped so
 * Monaco never receives an inverted range, which it renders as a marker
 * covering the rest of the file.
 */
export function lspToMarkers(diagnostics: LspDiagnostic[]): FahhMarker[] {
  return diagnostics.map((d) => {
    const startLine = Math.max(1, (d.range?.start?.line ?? 0) + 1);
    const startCol = Math.max(1, (d.range?.start?.character ?? 0) + 1);
    let endLine = Math.max(1, (d.range?.end?.line ?? d.range?.start?.line ?? 0) + 1);
    let endCol = Math.max(
      1,
      (d.range?.end?.character ?? d.range?.start?.character ?? 0) + 1
    );

    if (endLine < startLine) {
      endLine = startLine;
      endCol = startCol;
    } else if (endLine === startLine && endCol < startCol) {
      endCol = startCol;
    }

    const marker: FahhMarker = {
      startLineNumber: startLine,
      startColumn: startCol,
      endLineNumber: endLine,
      endColumn: endCol,
      message: d.message,
      severity: toMarkerSeverity(d.severity),
    };
    if (d.source) marker.source = d.source;
    if (d.code !== undefined) marker.code = String(d.code);
    return marker;
  });
}

/**
 * Narrow a parsed JSON-RPC message to a publishDiagnostics notification.
 * Returns `null` for anything else, including malformed params.
 */
export function parsePublishDiagnostics(
  message: unknown
): PublishDiagnosticsParams | null {
  if (typeof message !== "object" || message === null) return null;
  const msg = message as { method?: unknown; params?: unknown };
  if (msg.method !== "textDocument/publishDiagnostics") return null;

  const params = msg.params as PublishDiagnosticsParams | undefined;
  if (!params || typeof params.uri !== "string") return null;
  if (!Array.isArray(params.diagnostics)) return null;

  return params;
}
