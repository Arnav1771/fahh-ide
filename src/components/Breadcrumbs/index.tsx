import { useEffect, useMemo, useState } from "react";
import { ChevronRight, AlertCircle, CheckCircle2 } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { useFileStore } from "../../store/fileStore";
import { useDiagnosticsStore, type DiagnosticItem } from "../../store/diagnosticsStore";
import { FileIcon, FolderIcon } from "../../lib/iconTheme";
import { openFilePath } from "../../hooks/useWorkspace";
import type { FileEntry } from "../../lib/types";

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
/** The tree node at `path`, or null. */
function nodeAt(tree: FileEntry | null, path: string): FileEntry | null {
  if (!tree) return null;
  if (norm(tree.path) === norm(path)) return tree;
  for (const c of tree.children ?? []) if (c.is_dir && norm(path).startsWith(norm(c.path))) return nodeAt(c, path);
  return null;
}

/** A folder's entries under its breadcrumb: click a file to open it, a folder to go into it. */
function FolderMenu({ start, at, onClose }: { start: FileEntry; at: { x: number; y: number }; onClose: () => void }) {
  const [dir, setDir] = useState(start);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const click = (e: MouseEvent) => !(e.target as HTMLElement).closest?.("[data-crumb-menu]") && onClose();
    window.addEventListener("keydown", key);
    window.addEventListener("mousedown", click);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mousedown", click);
    };
  }, [onClose]);
  const entries = [...(dir.children ?? [])].sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name));
  return (
    <div data-crumb-menu role="menu" style={{ left: at.x, top: at.y }} className="fixed z-50 max-h-80 w-64 overflow-y-auto rounded border border-fahh-surface bg-fahh-sidebar py-1 shadow-lg font-sans">
      {dir !== start && (
        <button role="menuitem" onClick={() => setDir(start)} className="block w-full px-3 py-1 text-left text-[11px] text-fahh-muted hover:bg-fahh-surface">
          ← {start.name}
        </button>
      )}
      {entries.length === 0 && <p className="px-3 py-1 text-[11px] text-fahh-muted">Empty folder</p>}
      {entries.map((e) => (
        <button
          key={e.path}
          role="menuitem"
          onClick={() => (e.is_dir ? setDir(e) : (void openFilePath(e.path), onClose()))}
          className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11px] text-fahh-text hover:bg-fahh-surface"
        >
          {e.is_dir ? <FolderIcon name={e.name} open={false} size={12} /> : <FileIcon name={e.name} size={12} />}
          <span className="truncate">{e.name}</span>
        </button>
      ))}
    </div>
  );
}

export function Breadcrumbs({ path }: { path?: string } = {}) {
  const { activeTab: storeActive, openTabs } = useEditorStore();
  const activeTab = path ?? storeActive;
  const root = useFileStore((s) => s.root);
  const diagnostics = useDiagnosticsStore((s) => s.diagnostics);
  const tree = useFileStore((s) => s.tree);
  const [menu, setMenu] = useState<{ node: FileEntry; x: number; y: number } | null>(null);

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

  const folderOf = (i: number): string | null => {
    if (!root) return null;
    const rel = activeTab.startsWith(root) ? activeTab.slice(root.length).replace(/^[/\\]+/, "") : "";
    const parts = rel.split(/[/\\]/).filter(Boolean).slice(0, i);
    return [root.replace(/[/\\]+$/, ""), ...parts].join(root.includes("\\") ? "\\" : "/");
  };
  const openMenu = (i: number, el: HTMLElement) => {
    const path = folderOf(i);
    const node = path ? nodeAt(tree, path) : null;
    if (!node) return;
    const r = el.getBoundingClientRect();
    setMenu({ node, x: r.left, y: r.bottom + 2 });
  };

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

          return (
            <div key={i} className="flex items-center gap-1 shrink-0">
              {i > 0 && <ChevronRight size={10} className="text-fahh-muted/40 shrink-0" />}
              <span
                onClick={isLast ? undefined : (e) => openMenu(i, e.currentTarget)}
                role={isLast ? undefined : "button"}
                title={isLast ? undefined : `Files in ${part}`}
                className={`flex items-center gap-1 transition-colors ${
                  isLast
                    ? "text-fahh-text font-medium"
                    : "text-fahh-muted hover:text-fahh-text cursor-pointer"
                }`}
              >
                {isLast ? (
                  <FileIcon name={fileName} language={activeDoc?.language} size={12} />
                ) : (
                  <FolderIcon name={part} open size={12} />
                )}
                <span className="truncate">{part}</span>
              </span>
            </div>
          );
        })}
      </div>

      {menu && <FolderMenu start={menu.node} at={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} />}

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
