import { Columns2, Eye, Globe } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { modeOf, usePreviewStore } from "../../store/previewStore";
import { isPreviewOnly, previewKindFor } from "../../lib/preview";
import { runCommand } from "../../lib/commands";
import { requestClose } from "../../lib/tabActions";
import { openBrowser } from "../../lib/browser";
import { FileIcon } from "../../lib/iconTheme";

export function TabBar() {
  const { openTabs, activeTab, setActiveTab } = useEditorStore();
  const mode = usePreviewStore((s) => (activeTab ? modeOf(s.modes, activeTab) : undefined));
  const localUrl = usePreviewStore((s) => s.localUrl);

  if (openTabs.length === 0) return null;

  // Editor title actions: direct preview for supported files (Markdown, HTML, SVG, CSV)
  const directPreviewKind = activeTab ? previewKindFor(activeTab) : null;
  const showDirectPreview = !!activeTab && !!directPreviewKind && !isPreviewOnly(activeTab);

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
              <FileIcon name={fileName} language={tab.language} />
              <span className={tab.dirty ? "text-fahh-warn" : ""}>
                {tab.dirty ? "● " : ""}
                {fileName}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  requestClose(tab.path);
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

      {/* ── Preview Controls Bar ── */}
      <div className="fahh-preview-actions flex shrink-0 items-center gap-1 px-2">
        {showDirectPreview ? (
          <>
            <button
              type="button"
              onClick={() => runCommand("preview.side")}
              title="Open Preview to the Side (Ctrl+K V)"
              aria-label="Open preview to the side"
              aria-pressed={mode === "side"}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-fahh-surface ${
                mode === "side" ? "bg-fahh-accent/15 text-fahh-accent font-medium" : "text-fahh-muted hover:text-fahh-text"
              }`}
            >
              <Columns2 size={13} aria-hidden="true" />
              <span>Split Preview</span>
            </button>
            <button
              type="button"
              onClick={() => runCommand("preview.toggle")}
              title="Toggle In-place Preview (Ctrl+Shift+V)"
              aria-label="Open preview"
              aria-pressed={mode === "only"}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-fahh-surface ${
                mode === "only" ? "bg-fahh-accent/15 text-fahh-accent font-medium" : "text-fahh-muted hover:text-fahh-text"
              }`}
            >
              <Eye size={13} aria-hidden="true" />
              <span>{mode === "only" ? "Show Code" : "Full Preview"}</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              openBrowser(localUrl || "http://localhost:5173");
            }}
            title="Open Web / UI Live Preview (Ctrl+Shift+B)"
            aria-label="Open UI Preview"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#4a9eff]/10 hover:bg-[#4a9eff]/20 border border-[#4a9eff]/30 text-xs font-medium text-[#4a9eff] hover:text-[#7bb7ff] transition-all"
          >
            <Globe size={13} />
            <span>UI Preview</span>
          </button>
        )}
      </div>
    </div>
  );
}
