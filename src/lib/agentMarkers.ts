/** The editor's current problems (Monaco markers), for the agent's get_diagnostics and the fahh tie-in. */
import type { AgentDiagFile } from "./types";
import { relToRoot } from "./agentState";

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
