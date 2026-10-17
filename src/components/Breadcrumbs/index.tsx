import { useMemo } from "react";
import { Folder, FileCode, FileText, ChevronRight, AlertCircle, CheckCircle2 } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { useFileStore } from "../../store/fileStore";
import { useDiagnosticsStore, type DiagnosticItem } from "../../store/diagnosticsStore";

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) {
    return <FileCode size={12} className="text-yellow-400" />;
  }
  if (["py"].includes(ext)) {
    return <FileCode size={12} className="text-yellow-300" />;
  }
  if (["rs"].includes(ext)) {
    return <FileCode size={12} className="text-orange-400" />;
  }
  if (["json", "yaml", "yml", "toml"].includes(ext)) {
    return <FileText size={12} className="text-cyan-400" />;
  }
  if (["html", "css", "scss"].includes(ext)) {
    return <FileCode size={12} className="text-blue-400" />;
  }
  return <FileText size={12} className="text-fahh-muted" />;
}

export function Breadcrumbs() {
  const { activeTab, openTabs } = useEditorStore();
  const root = useFileStore((s) => s.root);
  const diagnostics = useDiagnosticsStore((s) => s.diagnostics);

  const activeDoc = openTabs.find((t) => t.path === activeTab) ?? null;

  const crumbs = useMemo(() => {
    if (!activeTab) return [];
    let rel = activeTab;
    if (root && activeTab.startsWith(root)) {
      rel = activeTab.slice(root.length).replace(/^[/\\]+/, "");
    }
    const rootName = root ? root.split(/[/\\]/).filter(Boolean).pop() : "Workspace";
    const parts = rel.split(/[/\\]/).filter(Boolean);
    return [rootName ?? "Workspace", ...parts];
  }, [activeTab, root]);

  const fileErrors = useMemo(() => {
    if (!activeTab) return 0;
    const norm = activeTab.replace(/\\/g, "/");
    return diagnostics.filter(
      (d: DiagnosticItem) =>
        d.path.replace(/\\/g, "/") === norm ||
        d.path.endsWith(norm.split("/").pop() ?? "")
    ).length;
  }, [activeTab, diagnostics]);

  if (!activeTab || crumbs.length === 0) return null;

  const fileName = crumbs[crumbs.length - 1];

  return (
    <div
      className="h-6 w-full bg-fahh-bg/95 border-b border-fahh-surface flex items-center justify-between px-3 text-[11px] font-mono text-fahh-muted select-none shrink-0"
      aria-label="Breadcrumb navigation"
    >
      {/* Path segments */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
        {crumbs.map((part, i) => {
          const isLast = i === crumbs.length - 1;
          const isFirst = i === 0;

          return (
            <div key={i} className="flex items-center gap-1 shrink-0">
              {i > 0 && <ChevronRight size={10} className="text-fahh-muted/40 shrink-0" />}
              <span
                className={`flex items-center gap-1 transition-colors ${
                  isLast
                    ? "text-fahh-text font-medium"
                    : "text-fahh-muted hover:text-fahh-text cursor-pointer"
                }`}
              >
                {isFirst ? (
                  <Folder size={11} className="text-fahh-accent shrink-0" />
                ) : isLast ? (
                  getFileIcon(fileName)
                ) : (
                  <Folder size={11} className="text-fahh-muted/70 shrink-0" />
                )}
                <span className="truncate">{part}</span>
              </span>
            </div>
          );
        })}
      </div>

      {/* Right meta badges */}
      <div className="flex items-center gap-2.5 shrink-0 ml-2">
        {fileErrors > 0 ? (
          <span className="flex items-center gap-1 text-[10px] text-fahh-error font-medium">
            <AlertCircle size={10} />
            <span>{fileErrors} {fileErrors === 1 ? "problem" : "problems"}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] text-fahh-success/80">
            <CheckCircle2 size={10} />
            <span className="max-sm:hidden">Clean</span>
          </span>
        )}

        {activeDoc && (
          <span className="text-[10px] text-fahh-muted/80 bg-fahh-surface/80 px-1.5 py-0.2 rounded uppercase tracking-wider">
            {activeDoc.language}
          </span>
        )}
      </div>
    </div>
  );
}
