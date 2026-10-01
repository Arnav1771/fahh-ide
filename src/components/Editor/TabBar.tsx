import { Columns2, Eye } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { usePreviewStore } from "../../store/previewStore";
import { isPreviewOnly, previewKindFor } from "../../lib/preview";
import { runCommand } from "../../lib/commands";

export function TabBar() {
  const { openTabs, activeTab, setActiveTab, closeFile } = useEditorStore();
  const mode = usePreviewStore((s) => (activeTab ? s.modes[activeTab] : undefined));

  if (openTabs.length === 0) return null;

  // Editor title actions, as in VS Code: only for files that have a preview.
  const showActions = !!activeTab && !!previewKindFor(activeTab) && !isPreviewOnly(activeTab);

  return (
    <div className="flex shrink-0 items-stretch bg-fahh-sidebar border-b border-fahh-surface">
      <div className="flex flex-1 items-center overflow-x-auto h-9">
        {openTabs.map((tab) => {
          const isActive = tab.path === activeTab;
          const fileName = tab.path.split(/[\\/]/).pop() ?? tab.path;
          return (
            <div
              key={tab.path}
              onClick={() => setActiveTab(tab.path)}
              className={`flex items-center gap-2 px-3 h-full text-sm cursor-pointer select-none whitespace-nowrap border-r border-fahh-surface transition-colors ${
                isActive
                  ? "bg-fahh-bg text-fahh-text"
                  : "text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface"
              }`}
            >
              <span className={tab.dirty ? "text-fahh-warn" : ""}>
                {tab.dirty ? "● " : ""}
                {fileName}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(tab.path);
                }}
                className="ml-1 opacity-50 hover:opacity-100 text-xs leading-none"
                aria-label="Close tab"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      {showActions && (
        <div className="fahh-preview-actions flex shrink-0 items-center gap-0.5 px-2">
          <button
            type="button"
            onClick={() => runCommand("preview.side")}
            title="Open Preview to the Side (Ctrl+K V)"
            aria-label="Open preview to the side"
            aria-pressed={mode === "side"}
            className={`rounded p-1.5 hover:bg-fahh-surface ${mode === "side" ? "text-fahh-accent" : "text-fahh-muted hover:text-fahh-text"}`}
          >
            <Columns2 size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => runCommand("preview.toggle")}
            title="Open Preview (Ctrl+Shift+V)"
            aria-label="Open preview"
            aria-pressed={mode === "only"}
            className={`rounded p-1.5 hover:bg-fahh-surface ${mode === "only" ? "text-fahh-accent" : "text-fahh-muted hover:text-fahh-text"}`}
          >
            <Eye size={15} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
