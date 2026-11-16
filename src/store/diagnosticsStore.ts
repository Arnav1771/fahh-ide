import { create } from "zustand";

export interface DiagnosticItem {
  id: string;
  path: string;
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  line?: number;
  column?: number;
  source?: string;
  code?: string | number;
}

export interface DiagnosticsStore {
  diagnostics: DiagnosticItem[];
  clearAll: () => void;
}

/** The fields of a Monaco `IMarker` the Problems panel needs (no monaco import, so it tests in Node). */
export interface MarkerLike {
  resource: { scheme: string; fsPath: string };
  severity: number;
  message: string;
  startLineNumber: number;
  startColumn: number;
  source?: string;
  code?: string | { value: string };
}

const SEVERITY: Record<number, DiagnosticItem["severity"]> = { 8: "error", 4: "warning", 2: "info", 1: "hint" };
const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * Every checker's markers (Monaco's own workers and the language servers) as Problems
 * rows, keeping only files inside the open folder. Paths come back in the folder's own
 * spelling (root + separator), so clicking a row opens the same tab the Explorer would.
 */
export function markersToDiagnostics(markers: readonly MarkerLike[], root: string | null): DiagnosticItem[] {
  if (!root) return [];
  const base = norm(root);
  const sep = root.includes("\\") ? "\\" : "/";
  const out: DiagnosticItem[] = [];
  markers.forEach((m, i) => {
    if (m.resource.scheme !== "file") return;
    const p = norm(m.resource.fsPath);
    if (!p.startsWith(base + "/")) return;
    const rel = m.resource.fsPath.replace(/\\/g, "/").slice(base.length + 1).split("/").join(sep);
    out.push({
      id: `${i}:${p}:${m.startLineNumber}:${m.startColumn}`,
      path: root.replace(/[\\/]+$/, "") + sep + rel,
      message: m.message,
      severity: SEVERITY[m.severity] ?? "info",
      line: m.startLineNumber,
      column: m.startColumn,
      source: m.source,
      code: typeof m.code === "object" ? m.code.value : m.code,
    });
  });
  return out;
}

export const useDiagnosticsStore = create<DiagnosticsStore>((set) => ({
  diagnostics: [],
  clearAll: () => set({ diagnostics: [] }),
}));
