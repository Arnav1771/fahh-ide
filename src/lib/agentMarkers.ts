/** The editor's current problems (Monaco markers), for the agent's get_diagnostics and the fahh tie-in. */
import type { AgentDiagFile } from "./types";
import { relToRoot } from "./agentState";

/** The text selected in the editor showing `activePath`, or null. */
export function currentSelection(activePath: string | null): string | null {
  const monacoGlobal = typeof window !== "undefined" ? (window as any).monaco : undefined;
  if (!activePath || !monacoGlobal?.editor?.getEditors) return null;
  for (const ed of monacoGlobal.editor.getEditors()) {
    const model = ed.getModel();
    const sel = ed.getSelection();
    if (!model || !sel || sel.isEmpty()) continue;
    if (model.uri.path.replace(/^\/([A-Za-z]:)/, "$1").toLowerCase() !== activePath.replace(/\\/g, "/").toLowerCase()) continue;
    return model.getValueInRange(sel) || null;
  }
  return null;
}

export function collectMarkers(root: string): { files: AgentDiagFile[]; errors: number } {
  const byFile = new Map<string, AgentDiagFile>();
  let errors = 0;

  // Safe runtime check for monaco in browser/window environment
  const monacoGlobal = typeof window !== "undefined" ? (window as any).monaco : undefined;
  if (monacoGlobal?.editor?.getModelMarkers) {
    for (const m of monacoGlobal.editor.getModelMarkers({})) {
      const isError = m.severity === 8; // MarkerSeverity.Error is 8
      const isWarning = m.severity === 4; // MarkerSeverity.Warning is 4
      if (!isError && !isWarning) continue;
      const rel = relToRoot(root, m.resource?.path || m.resource?.toString() || "");
      if (!rel) continue;
      if (isError) errors++;
      const f = byFile.get(rel) ?? { path: rel, items: [] };
      f.items.push({ line: m.startLineNumber, severity: isError ? "error" : "warning", message: m.message });
      byFile.set(rel, f);
    }
  }
  return { files: [...byFile.values()], errors };
}
