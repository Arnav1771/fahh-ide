/** The editor's current problems (Monaco markers), for the agent's get_diagnostics and the fahh tie-in. */
import * as monaco from "monaco-editor";
import type { AgentDiagFile } from "./types";
import { relToRoot } from "./agentState";

/** The text selected in the editor showing `activePath`, or null. */
export function currentSelection(activePath: string | null): string | null {
  if (!activePath) return null;
  for (const ed of monaco.editor.getEditors()) {
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
  for (const m of monaco.editor.getModelMarkers({})) {
    const isError = m.severity === monaco.MarkerSeverity.Error;
    if (!isError && m.severity !== monaco.MarkerSeverity.Warning) continue;
    const rel = relToRoot(root, m.resource.path);
    if (!rel) continue;
    if (isError) errors++;
    const f = byFile.get(rel) ?? { path: rel, items: [] };
    f.items.push({ line: m.startLineNumber, severity: isError ? "error" : "warning", message: m.message });
    byFile.set(rel, f);
  }
  return { files: [...byFile.values()], errors };
}
