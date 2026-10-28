import { useMemo } from "react";
import { ListTree } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { currentItem, outline } from "../../lib/outline";
import { openAt } from "../../lib/navigation";

const KIND_COLOUR: Record<string, string> = {
  class: "text-fahh-warn",
  struct: "text-fahh-warn",
  interface: "text-fahh-accent",
  type: "text-fahh-accent",
  enum: "text-fahh-warn",
  trait: "text-fahh-accent",
};

/** Outline: the symbols in the active file. Click one to jump there. */
export function Outline() {
  const path = useEditorStore((s) => s.activeTab);
  const text = useEditorStore((s) => (s.activeTab ? s.fileContents[s.activeTab] : undefined));
  const language = useEditorStore((s) => s.openTabs.find((t) => t.path === s.activeTab)?.language ?? "");
  const line = useEditorStore((s) => s.cursorPosition.line);
  const items = useMemo(() => (text ? outline(text, language) : []), [text, language]);
  const here = currentItem(items, line);

  return (
    <div className="h-full flex flex-col text-xs">
      <div className="px-3 py-2 border-b border-fahh-surface shrink-0 fahh-label text-[10px] uppercase tracking-widest text-fahh-muted font-semibold">Outline</div>
      <div className="flex-1 overflow-auto py-1" role="tree" aria-label="Outline">
        {!path || text === undefined ? (
          <p className="px-3 py-2 text-fahh-muted">Open a file to see its symbols.</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-2 text-fahh-muted">No symbols found in this file.</p>
        ) : (
          items.map((it) => (
            <button
              key={it.line}
              role="treeitem"
              aria-selected={it === here}
              onClick={() => void openAt(path, it.line)}
              title={`Line ${it.line}`}
              style={{ paddingLeft: 12 + it.depth * 12 }}
              className={`w-full flex items-center gap-1.5 pr-2 py-0.5 text-left hover:bg-fahh-surface/60 ${it === here ? "bg-fahh-surface/40 text-fahh-text" : "text-fahh-text/90"}`}
            >
              <ListTree size={11} className={`shrink-0 ${KIND_COLOUR[it.kind] ?? "text-fahh-muted"}`} />
              <span className="truncate">{it.name}</span>
              <span className="ml-auto text-[10px] text-fahh-muted/70 shrink-0">{it.kind}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
