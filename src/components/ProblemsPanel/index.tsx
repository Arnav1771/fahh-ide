import { useState, useMemo } from "react";
import { AlertCircle, AlertTriangle, Info, Search, FileCode, CheckCircle2 } from "lucide-react";
import { useDiagnosticsStore, type DiagnosticItem } from "../../store/diagnosticsStore";
import { useWorkspace } from "../../hooks/useWorkspace";
import { openAt } from "../../lib/navigation";

export function ProblemsPanel() {
  const diagnostics = useDiagnosticsStore((s) => s.diagnostics);
  const [filter, setFilter] = useState("");
  const { openFileInEditor } = useWorkspace();

  const filtered = useMemo(() => {
    if (!filter.trim()) return diagnostics;
    const q = filter.toLowerCase();
    return diagnostics.filter(
      (d: DiagnosticItem) =>
        d.message.toLowerCase().includes(q) ||
        d.path.toLowerCase().includes(q) ||
        (d.source && d.source.toLowerCase().includes(q))
    );
  }, [diagnostics, filter]);

  // Group by file path
  const grouped = useMemo(() => {
    const map = new Map<string, DiagnosticItem[]>();
    filtered.forEach((d: DiagnosticItem) => {
      const list = map.get(d.path) || [];
      list.push(d);
      map.set(d.path, list);
    });
    return map;
  }, [filtered]);

  const errorCount = diagnostics.filter((d: DiagnosticItem) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d: DiagnosticItem) => d.severity === "warning").length;

  return (
    <div className="flex flex-col h-full bg-fahh-bg font-sans text-xs text-fahh-text overflow-hidden" data-testid="problems-panel">
      {/* Top Filter Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-fahh-sidebar border-b border-fahh-surface shrink-0 gap-2">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1.5 text-fahh-muted" />
            <input
              type="text"
              placeholder="Filter problems…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-fahh-bg border border-fahh-surface rounded pl-6 pr-2 py-0.5 text-xs text-fahh-text placeholder-fahh-muted focus:outline-none focus:border-fahh-accent w-48"
            />
          </div>
          <span className="text-[11px] text-fahh-muted flex items-center gap-2">
            <span className="flex items-center gap-1 text-fahh-error">
              <AlertCircle size={11} /> {errorCount} {errorCount === 1 ? "Error" : "Errors"}
            </span>
            <span className="flex items-center gap-1 text-yellow-400">
              <AlertTriangle size={11} /> {warningCount} {warningCount === 1 ? "Warning" : "Warnings"}
            </span>
          </span>
        </div>
      </div>

      {/* Problems List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {diagnostics.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-10 text-fahh-muted">
            <CheckCircle2 size={24} className="text-fahh-success/70 mb-2" />
            <p className="font-medium text-fahh-text">No problems detected in the workspace.</p>
            <p className="text-[11px] text-fahh-muted/70 mt-0.5">
              Diagnostics from language servers will appear here in real time.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-fahh-muted">
            No problems match your filter.
          </div>
        ) : (
          Array.from(grouped.entries()).map(([filePath, items]) => {
            const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
            return (
              <div key={filePath} className="border border-fahh-surface rounded-md overflow-hidden bg-fahh-surface/30">
                <div
                  onClick={() => openFileInEditor(filePath)}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-fahh-sidebar/60 border-b border-fahh-surface cursor-pointer hover:bg-fahh-surface/60 transition-colors"
                >
                  <FileCode size={12} className="text-fahh-accent" />
                  <span className="font-medium text-fahh-text text-[11px]">{fileName}</span>
                  <span className="text-[10px] text-fahh-muted font-mono truncate">{filePath}</span>
                  <span className="ml-auto text-[10px] text-fahh-muted">({items.length})</span>
                </div>

                <div className="divide-y divide-fahh-surface/40">
                  {items.map((item: DiagnosticItem, idx: number) => (
                    <div
                      key={idx}
                      onClick={() => void openAt(item.path, item.line ?? 1, item.column ?? 1)}
                      className="flex items-start gap-2 px-3 py-1.5 hover:bg-fahh-surface/50 cursor-pointer transition-colors"
                    >
                      {item.severity === "error" ? (
                         <AlertCircle size={13} className="text-fahh-error shrink-0 mt-0.5" />
                       ) : item.severity === "warning" ? (
                         <AlertTriangle size={13} className="text-yellow-400 shrink-0 mt-0.5" />
                       ) : (
                         <Info size={13} className="text-fahh-info shrink-0 mt-0.5" />
                       )}
                       <div className="flex-1 min-w-0">
                         <p className="text-xs text-fahh-text font-mono leading-tight">{item.message}</p>
                         <div className="flex items-center gap-2 mt-0.5 text-[10px] text-fahh-muted font-mono">
                           <span>[{item.source ?? "lsp"}]</span>
                           <span>Line {item.line ?? 1}, Col {item.column ?? 1}</span>
                         </div>
                       </div>
                     </div>
                   ))}
                 </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
