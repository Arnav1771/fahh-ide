import { useState } from "react";
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  Plus,
  Terminal,
  FileCode,
  Bot,
  Globe,
  StickyNote,
  AlertCircle,
  LayoutGrid,
  FolderTree,
  Blocks,
  Crosshair,
} from "lucide-react";
import { useSpatialStore, type SpatialNodeType } from "../../store/spatialStore";

export function SpatialHud() {
  const {
    zoom,
    zoomBy,
    resetView,
    fitAll,
    focusNode,
    addNode,
    toggleSpatialMode,
    nodes,
    pan,
  } = useSpatialStore();

  const [showAddMenu, setShowAddMenu] = useState(false);

  const handleAdd = (type: SpatialNodeType, title?: string) => {
    // Spawn near center of current view
    const viewW = window.innerWidth || 1200;
    const viewH = window.innerHeight || 800;
    const spawnX = Math.round((-pan.x + viewW / 2 - 250) / zoom);
    const spawnY = Math.round((-pan.y + viewH / 2 - 200) / zoom);
    addNode(type, title, spawnX, spawnY);
    setShowAddMenu(false);
  };

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 select-none">
      {/* Floating Glassmorphic Control Bar */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#181816]/90 border border-white/10 shadow-[0_10px_30px_-5px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.05)] backdrop-blur-xl text-xs font-sans">
        {/* Switch back to Docked IDE Mode */}
        <button
          type="button"
          onClick={toggleSpatialMode}
          title="Switch to Docked IDE mode"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[#a8a49e] hover:text-[#e8e6e3] hover:bg-white/[0.08] transition-colors"
        >
          <LayoutGrid size={13} className="text-[#4a9eff]" />
          <span className="font-medium text-[11px]">Docked Mode</span>
        </button>

        <div className="w-[1px] h-4 bg-white/10 mx-1" />

        {/* Zoom Controls */}
        <button
          type="button"
          onClick={() => zoomBy(-0.1)}
          title="Zoom out"
          className="p-1 rounded-full text-[#8a8780] hover:text-[#e8e6e3] hover:bg-white/[0.08] transition-colors"
        >
          <ZoomOut size={13} />
        </button>

        <button
          type="button"
          onClick={resetView}
          title="Click to reset to 100% and center editor"
          className="px-2 py-0.5 rounded text-[11px] font-mono text-[#e8e6e3] hover:bg-white/[0.08] transition-colors"
        >
          {Math.round(zoom * 100)}%
        </button>

        <button
          type="button"
          onClick={() => zoomBy(0.1)}
          title="Zoom in"
          className="p-1 rounded-full text-[#8a8780] hover:text-[#e8e6e3] hover:bg-white/[0.08] transition-colors"
        >
          <ZoomIn size={13} />
        </button>

        <button
          type="button"
          onClick={fitAll}
          title="Fit all nodes in view"
          className="p-1 rounded-full text-[#8a8780] hover:text-[#4a9eff] hover:bg-white/[0.08] transition-colors ml-0.5"
        >
          <Maximize size={13} />
        </button>

        <button
          type="button"
          onClick={() => focusNode("spatial-editor")}
          title="Focus Monaco Editor 1:1 (Center code editor at 100% zoom)"
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-[#4a9eff] hover:bg-[#4a9eff]/15 transition-colors font-medium ml-0.5"
        >
          <Crosshair size={12} />
          <span>Focus Editor</span>
        </button>

        <div className="w-[1px] h-4 bg-white/10 mx-1" />

        {/* Add Node Dropdown Trigger */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowAddMenu((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#4a9eff]/15 text-[#4a9eff] border border-[#4a9eff]/30 hover:bg-[#4a9eff]/25 font-medium transition-colors"
          >
            <Plus size={13} />
            <span className="text-[11px]">Add Window</span>
          </button>

          {/* Add Node Menu Popup */}
          {showAddMenu && (
            <div className="absolute bottom-full mb-3 left-0 w-48 py-1.5 rounded-xl bg-[#1a1917]/95 border border-white/15 shadow-2xl backdrop-blur-2xl flex flex-col gap-0.5 z-50">
              <button
                type="button"
                onClick={() => handleAdd("editor", "Canvas Monaco Editor")}
                className="flex items-center gap-2 px-3 py-1.5 text-left text-xs text-[#e8e6e3] hover:bg-white/[0.08] transition-colors"
              >
                <FileCode size={13} className="text-[#4a9eff]" />
                <span>Code Editor</span>
              </button>
              <button
                type="button"
                onClick={() => handleAdd("terminal", "Interactive Terminal")}
                className="flex items-center gap-2 px-3 py-1.5 text-left text-xs text-[#e8e6e3] hover:bg-white/[0.08] transition-colors"
              >
                <Terminal size={13} className="text-[#27c93f]" />
                <span>Terminal</span>
              </button>
              <button
                type="button"
                onClick={() => handleAdd("agent", "Fahh Local Agent")}
                className="flex items-center gap-2 px-3 py-1.5 text-left text-xs text-[#e8e6e3] hover:bg-white/[0.08] transition-colors"
              >
                <Bot size={13} className="text-[#e0a96d]" />
                <span>AI Assistant</span>
              </button>
              <button
                type="button"
                onClick={() => handleAdd("browser", "Browser Viewport")}
                className="flex items-center gap-2 px-3 py-1.5 text-left text-xs text-[#e8e6e3] hover:bg-white/[0.08] transition-colors"
              >
                <Globe size={13} className="text-[#ff9f0a]" />
                <span>Live Browser</span>
              </button>
              <button
                type="button"
                onClick={() => handleAdd("diagnostics", "Problems & Diagnostics")}
                className="flex items-center gap-2 px-3 py-1.5 text-left text-xs text-[#e8e6e3] hover:bg-white/[0.08] transition-colors"
              >
                <AlertCircle size={13} className="text-[#ff5f56]" />
                <span>Diagnostics</span>
              </button>
              <button
                type="button"
                onClick={() => handleAdd("note", "Architectural Sticky Note")}
                className="flex items-center gap-2 px-3 py-1.5 text-left text-xs text-[#e8e6e3] hover:bg-white/[0.08] transition-colors"
              >
                <StickyNote size={13} className="text-[#ffd666]" />
                <span>Sticky Note</span>
              </button>
              <button
                type="button"
                onClick={() => handleAdd("files", "Project Files")}
                className="flex items-center gap-2 px-3 py-1.5 text-left text-xs text-[#e8e6e3] hover:bg-white/[0.08] transition-colors"
              >
                <FolderTree size={13} className="text-[#38bdf8]" />
                <span>Project Explorer</span>
              </button>
              <button
                type="button"
                onClick={() => handleAdd("extensions", "Extensions Store")}
                className="flex items-center gap-2 px-3 py-1.5 text-left text-xs text-[#e8e6e3] hover:bg-white/[0.08] transition-colors"
              >
                <Blocks size={13} className="text-[#c084fc]" />
                <span>Extensions Store</span>
              </button>
            </div>
          )}
        </div>

        {/* Total nodes badge */}
        <span className="text-[10px] text-[#8a8780] font-mono ml-1 px-1">
          {nodes.length} nodes
        </span>
      </div>
    </div>
  );
}
