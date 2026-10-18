import { useState, useEffect, useRef } from "react";
import {
  FileText,
  FolderOpen,
  Save,
  X,
  Undo2,
  Redo2,
  Scissors,
  Copy,
  Search,
  Replace,
  Terminal as TerminalIcon,
  Play,
  Sparkles,
  Blocks,
  Bell,
  ExternalLink,
  PanelBottom,
  PanelLeft,
  Bot,
  Wand2,
  PlusSquare,
  Cpu,
} from "lucide-react";
import { openNewWindow } from "../../lib/tauri";
import { runEditorAction } from "../../lib/monacoBridge";
import { OPEN_FOLDER_EVENT } from "../../lib/commands";
import { useFahhStore } from "../../store/fahhStore";
import { useEditorStore } from "../../store/editorStore";
import { useFileStore } from "../../store/fileStore";
import { useSpatialStore } from "../../store/spatialStore";
import { useComposerStore } from "../../store/composerStore";
import type { SidebarTab, BottomTab } from "../../App";

interface MenuItem {
  label: string;
  keys?: string[];
  icon?: React.ReactNode;
  action: () => void;
  separator?: boolean;
}

interface MenuDef {
  label: string;
  items: MenuItem[];
}

export function MenuBar({
  onOpenPalette,
  onOpenQuickOpen,
  onToggleSidebar,
  onToggleBottomPanel,
  onSetSidebarTab,
  onSetBottomTab,
  onSaveActive,
  onShowWelcome,
  onShowInstaller,
}: {
  onOpenPalette: () => void;
  onOpenQuickOpen: () => void;
  onToggleSidebar: () => void;
  onToggleBottomPanel: () => void;
  onSetSidebarTab: (tab: SidebarTab) => void;
  onSetBottomTab: (tab: BottomTab) => void;
  onSaveActive: () => void;
  onShowWelcome: () => void;
  onShowInstaller: () => void;
}) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const { activeTab, closeTab, openTabs } = useEditorStore();
  const root = useFileStore((s) => s.root);
  const isSpatial = useSpatialStore((s) => s.isSpatialMode);

  // Close menus on outside click or Escape
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const activeDocName = activeTab ? activeTab.split(/[\\/]/).pop() : null;
  const workspaceName = root ? root.split(/[\\/]/).pop() : "No Folder Open";

  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        {
          label: "New Window",
          keys: ["Ctrl", "Shift", "N"],
          icon: <PlusSquare size={13} />,
          action: () => void openNewWindow(),
        },
        {
          label: "Open Folder…",
          keys: ["Ctrl", "O"],
          icon: <FolderOpen size={13} />,
          action: () => {
            onSetSidebarTab("files");
            window.dispatchEvent(new Event(OPEN_FOLDER_EVENT));
          },
        },
        {
          label: "Save",
          keys: ["Ctrl", "S"],
          icon: <Save size={13} />,
          action: onSaveActive,
        },
        {
          label: "Close Tab",
          keys: ["Ctrl", "W"],
          icon: <X size={13} />,
          action: () => {
            if (activeTab) closeTab(activeTab);
          },
        },
        {
          label: "Close All Tabs",
          action: () => {
            [...openTabs].forEach((t) => closeTab(t.path));
          },
        },
      ],
    },
    {
      label: "Edit",
      items: [
        {
          label: "Undo",
          keys: ["Ctrl", "Z"],
          icon: <Undo2 size={13} />,
          action: () => runEditorAction("undo"),
        },
        {
          label: "Redo",
          keys: ["Ctrl", "Y"],
          icon: <Redo2 size={13} />,
          action: () => runEditorAction("redo"),
        },
        {
          label: "Cut",
          keys: ["Ctrl", "X"],
          icon: <Scissors size={13} />,
          action: () => runEditorAction("editor.action.clipboardCutAction"),
        },
        {
          label: "Copy",
          keys: ["Ctrl", "C"],
          icon: <Copy size={13} />,
          action: () => runEditorAction("editor.action.clipboardCopyAction"),
        },
        {
          label: "Find",
          keys: ["Ctrl", "F"],
          icon: <Search size={13} />,
          action: () => runEditorAction("actions.find"),
        },
        {
          label: "Replace",
          keys: ["Ctrl", "H"],
          icon: <Replace size={13} />,
          action: () => runEditorAction("editor.action.startFindReplaceAction"),
        },
        {
          label: "Format Document",
          keys: ["Shift", "Alt", "F"],
          icon: <Sparkles size={13} />,
          action: () => runEditorAction("editor.action.formatDocument"),
        },
        {
          label: "Composer (Cursor Multi-File Agent)",
          keys: ["Ctrl", "I"],
          icon: <Sparkles size={13} className="text-[#4a9eff]" />,
          action: () => useComposerStore.getState().toggleComposer(),
        },
        {
          label: "Inline Edit (Cursor Ctrl+K)",
          keys: ["Ctrl", "K"],
          icon: <Wand2 size={13} className="text-[#4a9eff]" />,
          action: () => {
            window.dispatchEvent(new CustomEvent("fahh-command", { detail: "edit.inline" }));
          },
        },
      ],
    },
    {
      label: "Selection",
      items: [
        {
          label: "Select All",
          keys: ["Ctrl", "A"],
          action: () => runEditorAction("editor.action.selectAll"),
        },
        {
          label: "Expand Selection",
          keys: ["Shift", "Alt", "→"],
          action: () => runEditorAction("editor.action.smartSelect.expand"),
        },
        {
          label: "Shrink Selection",
          keys: ["Shift", "Alt", "←"],
          action: () => runEditorAction("editor.action.smartSelect.shrink"),
        },
        {
          label: "Add Cursor Above",
          keys: ["Ctrl", "Alt", "↑"],
          action: () => runEditorAction("editor.action.insertCursorAbove"),
        },
        {
          label: "Add Cursor Below",
          keys: ["Ctrl", "Alt", "↓"],
          action: () => runEditorAction("editor.action.insertCursorBelow"),
        },
      ],
    },
    {
      label: "View",
      items: [
        {
          label: "Command Palette…",
          keys: ["Ctrl", "Shift", "P"],
          icon: <Search size={13} />,
          action: onOpenPalette,
        },
        {
          label: "Toggle Primary Sidebar",
          keys: ["Ctrl", "B"],
          icon: <PanelLeft size={13} />,
          action: onToggleSidebar,
        },
        {
          label: "Toggle Bottom Panel",
          keys: ["Ctrl", "`"],
          icon: <PanelBottom size={13} />,
          action: onToggleBottomPanel,
        },
        {
          label: "Explorer",
          keys: ["Ctrl", "Shift", "E"],
          action: () => onSetSidebarTab("files"),
        },
        {
          label: "Source Control",
          keys: ["Ctrl", "Shift", "G"],
          action: () => onSetSidebarTab("git"),
        },
        {
          label: "Extensions",
          keys: ["Ctrl", "Shift", "X"],
          icon: <Blocks size={13} />,
          action: () => onSetSidebarTab("extensions"),
        },
        {
          label: "Fahh Local (AI)",
          keys: ["Ctrl", "L"],
          icon: <Bot size={13} />,
          action: () => onSetSidebarTab("ai"),
        },
        {
          label: "REA Code Analysis (AST & Hex Dump)",
          keys: ["Ctrl", "Shift", "R"],
          icon: <Cpu size={13} className="text-[#a78bfa]" />,
          action: () => onSetSidebarTab("rea"),
        },
        {
          label: isSpatial ? "Exit Spatial Canvas Mode" : "Spatial Canvas Mode (CATE)",
          keys: ["Ctrl", "Shift", "C"],
          icon: <Sparkles size={13} className="text-[#4a9eff]" />,
          action: () => useSpatialStore.getState().toggleSpatialMode(),
        },
        {
          label: "Toggle Word Wrap",
          keys: ["Alt", "Z"],
          action: () => runEditorAction("editor.action.toggleWordWrap"),
        },
      ],
    },
    {
      label: "Go",
      items: [
        {
          label: "Go to File…",
          keys: ["Ctrl", "P"],
          icon: <FileText size={13} />,
          action: onOpenQuickOpen,
        },
        {
          label: "Next Problem",
          keys: ["F8"],
          action: () => runEditorAction("editor.action.marker.next"),
        },
        {
          label: "Previous Problem",
          keys: ["Shift", "F8"],
          action: () => runEditorAction("editor.action.marker.prev"),
        },
      ],
    },
    {
      label: "Run",
      items: [
        {
          label: "Run Active File",
          keys: ["F5"],
          icon: <Play size={13} />,
          action: () => {
            onSetBottomTab("run");
            onToggleBottomPanel();
          },
        },
        {
          label: "Open Run Panel",
          action: () => {
            onSetBottomTab("run");
          },
        },
      ],
    },
    {
      label: "Terminal",
      items: [
        {
          label: "New Terminal",
          keys: ["Ctrl", "Shift", "`"],
          icon: <TerminalIcon size={13} />,
          action: () => {
            onSetBottomTab("terminal");
          },
        },
        {
          label: "Clear Terminal",
          keys: ["Ctrl", "L"],
          action: () => {
            onSetBottomTab("terminal");
          },
        },
      ],
    },
    {
      label: "Help",
      items: [
        {
          label: "Documentation",
          icon: <ExternalLink size={13} />,
          action: () => window.open("https://fahhide.duckdns.org/docs.html", "_blank"),
        },
        {
          label: "Welcome Tour",
          action: onShowWelcome,
        },
        {
          label: "Optional Tools…",
          action: onShowInstaller,
        },
        {
          label: "Ring the Bell (Test Sound)",
          icon: <Bell size={13} />,
          action: () => useFahhStore.getState().ringBell(),
        },
      ],
    },
  ];

  return (
    <div
      ref={menuBarRef}
      className="h-7 w-full bg-fahh-sidebar border-b border-fahh-surface flex items-center px-2 select-none text-xs text-fahh-muted shrink-0 z-30"
      role="menubar"
    >
      {/* Brand logo & name */}
      <div className="flex items-center gap-1.5 mr-3 pr-2 border-r border-fahh-surface">
        <span className="font-semibold text-fahh-accent tracking-wider text-[11px]">FAHH</span>
        <span className="text-[9px] text-fahh-muted/70 font-mono">v0.6.0</span>
      </div>

      {/* Menus */}
      <div className="flex items-center gap-0.5">
        {menus.map((m) => {
          const isOpen = openMenu === m.label;
          return (
            <div key={m.label} className="relative">
              <button
                type="button"
                className={`px-2 py-0.5 rounded text-[11.5px] transition-colors ${
                  isOpen
                    ? "bg-fahh-surface text-fahh-text"
                    : "hover:bg-fahh-surface/60 hover:text-fahh-text"
                }`}
                onClick={() => setOpenMenu(isOpen ? null : m.label)}
                onMouseEnter={() => {
                  if (openMenu !== null) setOpenMenu(m.label);
                }}
              >
                {m.label}
              </button>

              {isOpen && (
                <div className="absolute top-full left-0 mt-1 min-w-[210px] bg-fahh-sidebar border border-fahh-surface rounded-md shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-75">
                  {m.items.map((item, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        item.action();
                      }}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-left text-xs text-fahh-text hover:bg-fahh-surface transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-4 flex items-center justify-center text-fahh-muted">
                          {item.icon}
                        </span>
                        <span>{item.label}</span>
                      </div>
                      {item.keys && (
                        <div className="flex items-center gap-0.5 ml-4">
                          {item.keys.map((k) => (
                            <kbd
                              key={k}
                              className="px-1 py-0.2 bg-fahh-surface border border-fahh-surface text-[10px] font-mono text-fahh-muted rounded"
                            >
                              {k}
                            </kbd>
                          ))}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Center title bar */}
      <div className="flex-1 flex justify-center items-center pointer-events-none">
        <div className="flex items-center gap-1.5 text-[11px] text-fahh-muted max-w-[400px] truncate">
          <span className="text-fahh-text font-medium">{workspaceName}</span>
          {activeDocName && (
            <>
              <span className="text-fahh-muted/50">—</span>
              <span className="text-fahh-accent font-mono">{activeDocName}</span>
            </>
          )}
        </div>
      </div>

      {/* Quick Search center-right button */}
      <button
        type="button"
        onClick={onOpenQuickOpen}
        className="flex items-center gap-2 px-2.5 py-0.5 rounded bg-fahh-surface/60 hover:bg-fahh-surface border border-fahh-surface text-[11px] text-fahh-muted hover:text-fahh-text transition-colors mr-2"
        title="Quick Open (Ctrl+P)"
      >
        <Search size={11} className="text-fahh-accent" />
        <span className="max-md:hidden">Search files & commands</span>
        <kbd className="px-1 py-0.2 bg-fahh-bg text-[9.5px] font-mono text-fahh-muted rounded border border-fahh-surface">
          Ctrl P
        </kbd>
      </button>

      {/* CATE Spatial Canvas Mode Toggle Pill */}
      <button
        type="button"
        onClick={() => useSpatialStore.getState().toggleSpatialMode()}
        className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all mr-2 ${
          isSpatial
            ? "bg-[#4a9eff] text-[#0a0907] font-semibold shadow-[0_0_14px_rgba(74,158,255,0.6)]"
            : "bg-fahh-surface hover:bg-fahh-surface/80 text-fahh-text border border-fahh-surface hover:border-white/20"
        }`}
        title="Toggle CATE Spatial Canvas Mode (Ctrl+Shift+C)"
      >
        <Sparkles size={11} className={isSpatial ? "text-[#0a0907]" : "text-[#4a9eff]"} />
        <span>{isSpatial ? "Spatial Canvas" : "Canvas Mode"}</span>
        <kbd className={`px-1 py-0.2 text-[9px] font-mono rounded ${
          isSpatial ? "bg-[#0a0907]/20 text-[#0a0907]" : "bg-fahh-bg text-fahh-muted"
        }`}>
          Ctrl+Shift+C
        </kbd>
      </button>

      {/* Right side layout toggle shortcuts */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggleSidebar}
          title="Toggle Sidebar (Ctrl+B)"
          className="p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface transition-colors"
        >
          <PanelLeft size={13} />
        </button>
        <button
          type="button"
          onClick={onToggleBottomPanel}
          title="Toggle Bottom Panel (Ctrl+`)"
          className="p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface transition-colors"
        >
          <PanelBottom size={13} />
        </button>
        <button
          type="button"
          onClick={() => onSetSidebarTab("ai")}
          title="Fahh Local AI (Ctrl+L)"
          className="p-1 rounded text-fahh-muted hover:text-fahh-accent hover:bg-fahh-surface transition-colors"
        >
          <Bot size={13} />
        </button>
      </div>
    </div>
  );
}
