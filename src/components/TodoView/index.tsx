import { useCallback, useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { useFileStore } from "../../store/fileStore";
import { searchWorkspace } from "../../lib/tauri";
import { openAt } from "../../lib/navigation";
import { groupTodos, relativeTo, TODO_QUERY, type TodoItem } from "../../lib/todos";
import { FILE_SAVED_EVENT } from "../../lib/tabActions";

const TAG_COLOUR: Record<TodoItem["tag"], string> = {
  TODO: "text-fahh-accent",
  FIXME: "text-red-400",
  HACK: "text-yellow-400",
};

/** TODO / FIXME / HACK across the workspace (the workspace search, refreshed on save). Click to jump. */
export function TodoView() {
  const root = useFileStore((s) => s.root);
  const [groups, setGroups] = useState<{ file: string; items: TodoItem[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!root) return;
    setLoading(true);
    setError(null);
    try {
      const res = await searchWorkspace(root, TODO_QUERY, { isRegex: true, caseSensitive: true, maxResults: 2000 });
      setGroups(groupTodos(res.matches));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [root]);

  useEffect(() => {
    void refresh();
    const onSaved = () => void refresh();
    window.addEventListener(FILE_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(FILE_SAVED_EVENT, onSaved);
  }, [refresh]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="h-full flex flex-col text-xs">
      <div className="px-3 py-2 border-b border-fahh-surface shrink-0 flex items-center gap-2">
        <span className="fahh-label text-[10px] uppercase tracking-widest text-fahh-muted font-semibold">TODOs</span>
        {total > 0 && <span className="text-[10px] text-fahh-muted">{total}</span>}
        <button type="button" onClick={() => void refresh()} title="Refresh" aria-label="Refresh TODOs" className="ml-auto text-fahh-muted hover:text-fahh-text">
          <RotateCw size={12} className={loading ? "animate-spin" : ""} aria-hidden="true" />
        </button>
      </div>
      <div className="flex-1 overflow-auto py-1" role="tree" aria-label="TODOs">
        {!root && <p className="px-3 py-2 text-fahh-muted">Open a folder to list its TODO, FIXME and HACK comments.</p>}
        {root && error && <p className="px-3 py-2 text-red-400">{error}</p>}
        {root && !error && !loading && total === 0 && <p className="px-3 py-2 text-fahh-muted">No TODO, FIXME or HACK comments in this folder.</p>}
        {groups.map((g) => (
          <div key={g.file} role="group" aria-label={g.file}>
            <div className="px-3 pt-1.5 pb-0.5 text-fahh-muted truncate" title={g.file}>
              {relativeTo(root, g.file)}
            </div>
            {g.items.map((it) => (
              <button
                key={`${it.line}:${it.column}`}
                type="button"
                role="treeitem"
                onClick={() => void openAt(it.file, it.line, it.column)}
                className="w-full flex items-center gap-1.5 pl-5 pr-2 py-0.5 text-left hover:bg-fahh-surface/60 text-fahh-text/90"
                title={`${it.tag}: ${it.text} (line ${it.line})`}
              >
                <span className={`shrink-0 font-semibold ${TAG_COLOUR[it.tag]}`}>{it.tag}</span>
                <span className="truncate">{it.text || "(no note)"}</span>
                <span className="ml-auto text-[10px] text-fahh-muted/70 shrink-0">{it.line}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
