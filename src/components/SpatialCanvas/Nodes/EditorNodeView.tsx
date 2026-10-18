import { useState } from "react";
import { TabBar } from "../../Editor/TabBar";
import { EditorPane } from "../../Editor/EditorPane";
import { Breadcrumbs } from "../../Breadcrumbs";
import { FileTree } from "../../FileTree/FileTree";
import { FolderTree } from "lucide-react";

export function EditorNodeView() {
  const [showExplorer, setShowExplorer] = useState(false);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#141311] h-full w-full">
      <div className="flex items-center bg-[#161513] border-b border-white/[0.07] shrink-0">
        <button
          type="button"
          onClick={() => setShowExplorer((s) => !s)}
          title={showExplorer ? "Hide File Explorer" : "Show File Explorer"}
          className={`px-2.5 py-1.5 flex items-center gap-1.5 text-xs transition-colors border-r border-white/[0.07] ${
            showExplorer ? "text-[#4a9eff] bg-white/[0.06]" : "text-[#8a8780] hover:text-[#e8e6e3] hover:bg-white/[0.03]"
          }`}
        >
          <FolderTree size={13} />
          <span className="text-[11px] font-sans">Files</span>
        </button>
        <div className="flex-1 min-w-0">
          <TabBar />
        </div>
      </div>
      <Breadcrumbs />
      <div className="flex-1 min-h-0 flex flex-row relative h-full w-full overflow-hidden">
        {showExplorer && (
          <div className="w-56 shrink-0 border-r border-white/[0.08] bg-fahh-sidebar overflow-y-auto flex flex-col">
            <FileTree />
          </div>
        )}
        <div className="flex-1 min-h-0 min-w-0 relative flex flex-col h-full w-full">
          <EditorPane monacoTheme="cate-obsidian" />
        </div>
      </div>
    </div>
  );
}
