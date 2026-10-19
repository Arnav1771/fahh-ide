import { useState, useEffect, useCallback } from "react";
import { TabBar } from "../../Editor/TabBar";
import { EditorPane } from "../../Editor/EditorPane";
import { Breadcrumbs } from "../../Breadcrumbs";
import { FileTree } from "../../FileTree/FileTree";
import {
  FolderTree,
  WrapText,
  Crosshair,
  Map,
  Plus,
  Minus,
  FileCode,
} from "lucide-react";
import { useEditorStore } from "../../../store/editorStore";
import { useFileStore } from "../../../store/fileStore";
import { useSpatialStore } from "../../../store/spatialStore";
import { useWorkspace } from "../../../hooks/useWorkspace";
import type { FileEntry } from "../../../lib/types";

const FONT_STORAGE_KEY = "fahh-canvas-font-size";
const WRAP_STORAGE_KEY = "fahh-canvas-word-wrap";
const MAP_STORAGE_KEY = "fahh-canvas-minimap";

function findPrimaryCandidate(node: FileEntry): string | null {
  if (!node.is_dir) return node.path;
  if (node.children && node.children.length > 0) {
    const priorities = [
      "App.tsx",
      "index.ts",
      "main.rs",
      "index.tsx",
      "index.js",
      "main.py",
      "index.html",
      "README.md",
      "package.json",
      "Cargo.toml",
    ];
    for (const p of priorities) {
      const match = node.children.find(
        (c) => !c.is_dir && c.name.toLowerCase() === p.toLowerCase()
      );
      if (match) return match.path;
    }
    for (const child of node.children) {
      const found = findPrimaryCandidate(child);
      if (found) return found;
    }
  }
  return null;
}

export function EditorNodeView() {
  const [showExplorer, setShowExplorer] = useState(false);
  const [fontSize, setFontSize] = useState<number>(() => {
    if (typeof localStorage === "undefined") return 17;
    const saved = localStorage.getItem(FONT_STORAGE_KEY);
    const n = saved ? parseInt(saved, 10) : 17;
    return Number.isFinite(n) && n >= 12 && n <= 32 ? n : 17;
  });
  const [wordWrap, setWordWrap] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return true;
    const saved = localStorage.getItem(WRAP_STORAGE_KEY);
    return saved !== null ? saved === "true" : true;
  });
  const [minimap, setMinimap] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return false;
    const saved = localStorage.getItem(MAP_STORAGE_KEY);
    return saved !== null ? saved === "true" : false;
  });

  const { activeTab, openTabs, setActiveTab } = useEditorStore();
  const tree = useFileStore((s) => s.tree);
  const { nodes, setPan, setZoom } = useSpatialStore();
  const { openFileInEditor } = useWorkspace();

  // Auto-open active file if entering canvas with unselected tab or root project file
  useEffect(() => {
    if (!activeTab) {
      if (openTabs.length > 0) {
        setActiveTab(openTabs[0].path);
      } else if (tree) {
        const candidate = findPrimaryCandidate(tree);
        if (candidate) {
          openFileInEditor(candidate).catch(() => {});
        }
      }
    }
  }, [activeTab, openTabs, tree, setActiveTab, openFileInEditor]);

  const changeFontSize = useCallback((delta: number) => {
    setFontSize((prev) => {
      const next = Math.max(12, Math.min(28, prev + delta));
      try {
        localStorage.setItem(FONT_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  const toggleWordWrap = useCallback(() => {
    setWordWrap((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(WRAP_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  const toggleMinimap = useCallback(() => {
    setMinimap((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MAP_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  // 1:1 Crisp Focus: centers camera on editor node and resets zoom to 1.0 for pixel-perfect readability
  const focusNode = useCallback(() => {
    const node = nodes.find((n) => n.id === "spatial-editor");
    if (!node) return;
    const targetX = Math.round(window.innerWidth / 2 - (node.x + node.w / 2));
    const targetY = Math.round(window.innerHeight / 2 - (node.y + node.h / 2));
    setZoom(1.0);
    setPan({ x: targetX, y: targetY });
    setTimeout(() => {
      window.dispatchEvent(new Event("fahh-layout"));
    }, 50);
  }, [nodes, setPan, setZoom]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#141311] h-full w-full">
      {/* ── Top Bar: Explorer Toggle + TabBar + Readability Controls ── */}
      <div className="flex items-center bg-[#161513] border-b border-white/[0.07] shrink-0">
        <button
          type="button"
          onClick={() => setShowExplorer((s) => !s)}
          title={showExplorer ? "Hide File Explorer" : "Show File Explorer"}
          className={`px-2.5 py-1.5 flex items-center gap-1.5 text-xs transition-colors border-r border-white/[0.07] ${
            showExplorer
              ? "text-[#60a5fa] bg-white/[0.06]"
              : "text-[#8a8780] hover:text-[#e8e6e3] hover:bg-white/[0.03]"
          }`}
        >
          <FolderTree size={13} />
          <span className="text-[11px] font-sans">Files</span>
        </button>

        <div className="flex-1 min-w-0">
          <TabBar />
        </div>

        {/* ── Canvas Readability Toolbar ── */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 border-l border-white/[0.07] shrink-0 text-xs">
          {/* Font Size Stepper */}
          <div
            className="flex items-center bg-white/[0.04] rounded-md border border-white/[0.08] px-1 py-0.5 gap-1"
            title="Adjust Monaco Font Size for Spatial Canvas Readability"
          >
            <button
              type="button"
              onClick={() => changeFontSize(-1)}
              title="Decrease Font Size (A-)"
              className="p-1 text-[#8a8780] hover:text-[#e8e6e3] hover:bg-white/[0.08] rounded transition-colors"
            >
              <Minus size={11} />
            </button>
            <span className="font-mono text-[11px] font-semibold text-[#60a5fa] px-1 min-w-[28px] text-center select-none">
              {fontSize}px
            </span>
            <button
              type="button"
              onClick={() => changeFontSize(1)}
              title="Increase Font Size (A+)"
              className="p-1 text-[#8a8780] hover:text-[#e8e6e3] hover:bg-white/[0.08] rounded transition-colors"
            >
              <Plus size={11} />
            </button>
          </div>

          {/* Word Wrap Toggle */}
          <button
            type="button"
            onClick={toggleWordWrap}
            title={wordWrap ? "Word Wrap: ON (lines wrap cleanly)" : "Word Wrap: OFF"}
            className={`px-2 py-1 rounded flex items-center gap-1 text-[11px] font-medium transition-colors border ${
              wordWrap
                ? "bg-[#60a5fa]/15 text-[#60a5fa] border-[#60a5fa]/30"
                : "bg-white/[0.03] text-[#8a8780] border-white/[0.07] hover:text-[#e8e6e3]"
            }`}
          >
            <WrapText size={12} />
            <span>Wrap</span>
          </button>

          {/* Minimap Toggle */}
          <button
            type="button"
            onClick={toggleMinimap}
            title={minimap ? "Minimap: ON" : "Minimap: OFF (Extra reading space)"}
            className={`px-2 py-1 rounded flex items-center gap-1 text-[11px] font-medium transition-colors border ${
              minimap
                ? "bg-[#60a5fa]/15 text-[#60a5fa] border-[#60a5fa]/30"
                : "bg-white/[0.03] text-[#8a8780] border-white/[0.07] hover:text-[#e8e6e3]"
            }`}
          >
            <Map size={12} />
            <span>Map</span>
          </button>

          {/* 1:1 Crisp Focus Recenter */}
          <button
            type="button"
            onClick={focusNode}
            title="Focus 1:1 Sharp View (Center camera at 100% zoom)"
            className="px-2 py-1 rounded flex items-center gap-1 text-[11px] font-medium bg-[#60a5fa]/10 hover:bg-[#60a5fa]/20 border border-[#60a5fa]/30 text-[#60a5fa] hover:text-[#93c5fd] transition-all"
          >
            <Crosshair size={12} />
            <span>1:1 Focus</span>
          </button>
        </div>
      </div>

      <Breadcrumbs />

      {/* ── Editor Body with Optional Explorer Drawer ── */}
      <div className="flex-1 min-h-0 flex flex-row relative h-full w-full overflow-hidden">
        {showExplorer && (
          <div className="w-56 shrink-0 border-r border-white/[0.08] bg-fahh-sidebar overflow-y-auto flex flex-col">
            <FileTree />
          </div>
        )}

        {!activeTab && openTabs.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none bg-[#141311]">
            <div className="w-14 h-14 rounded-2xl bg-[#60a5fa]/10 border border-[#60a5fa]/20 flex items-center justify-center text-[#60a5fa] mb-4 shadow-lg shadow-[#60a5fa]/5">
              <FileCode size={28} />
            </div>
            <h3 className="text-sm font-semibold text-[#f8fafc] mb-1">Canvas Code Editor</h3>
            <p className="text-xs text-[#9ca3af] max-w-sm mb-4 leading-relaxed">
              Open files from your workspace or create new ones to inspect and edit code directly on the spatial canvas.
            </p>
            <button
              type="button"
              onClick={() => setShowExplorer(true)}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#60a5fa] hover:bg-[#3b82f6] text-black font-semibold text-xs transition-colors shadow-md"
            >
              <FolderTree size={14} />
              <span>Browse Project Files</span>
            </button>
          </div>
        ) : (
          <div className="flex-1 min-h-0 min-w-0 relative flex flex-col h-full w-full">
            <EditorPane
              monacoTheme="cate-obsidian"
              fontSize={fontSize}
              wordWrap={wordWrap ? "on" : "off"}
              minimapEnabled={minimap}
              fontWeight="500"
              lineHeight={Math.round(fontSize * 1.55)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
