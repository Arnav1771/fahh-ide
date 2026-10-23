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
  PlusSquare,
  Minus,
  Square,
  Check,
  FilePlus,
  FolderTree,
  Bug,
  Flame,
} from "lucide-react";
import {
  openNewWindow,
  minimizeWindow,
  toggleMaximizeWindow,
  isWindowMaximized,
  closeWindow,
  launchAgyTerminal,
} from "../../lib/tauri";
import { runEditorAction } from "../../lib/monacoBridge";
import { OPEN_FOLDER_EVENT, OPEN_FILE_EVENT } from "../../lib/commands";
import { useFahhStore } from "../../store/fahhStore";
import { useEditorStore } from "../../store/editorStore";
import { useFileStore } from "../../store/fileStore";
import { useSpatialStore } from "../../store/spatialStore";
import { saveWorkspaceAs, openWorkspaceFromFile } from "../../lib/workspaceManager";
import { useWorkspace } from "../../hooks/useWorkspace";
import { requestClose } from "../../lib/tabActions";
import type { SidebarTab, BottomTab } from "../../App";
import { resetLayout, splitActiveEditor, toggleZone } from "../../lib/workbench";

export interface MenuItem {
  label: string;
  keys?: string[];
  icon?: React.ReactNode;
  action: () => void;
  separator?: boolean;
  checked?: boolean;
}

export interface MenuDef {
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
  const [isMaximized, setIsMaximized] = useState(false);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const { activeTab, openTabs, openFile, autoSave, toggleAutoSave } = useEditorStore();
  const { openFolder, openFileInEditor } = useWorkspace();
  const root = useFileStore((s) => s.root);
  const isSpatial = useSpatialStore((s) => s.isSpatialMode);

  // Sync maximized state on mount
  useEffect(() => {
    isWindowMaximized().then(setIsMaximized).catch(() => {});
  }, []);

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

  const handleNewFile = () => {
    const id = Date.now().toString(36).slice(-4);
    openFile(
      {
        path: `untitled-${id}.ts`,
        language: "typescript",
        dirty: true,
      },
      "// Untitled Document\n"
    );
  };

  const handleCopyPath = () => {
    if (activeTab) navigator.clipboard.writeText(activeTab);
  };

  const handleCopyRelativePath = () => {
    if (activeTab && root) {
      const rel = activeTab.replace(root, "").replace(/^[\\/]/, "");
      navigator.clipboard.writeText(rel);
    } else if (activeTab) {
      navigator.clipboard.writeText(activeTab);
    }
  };

  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        {
          label: "New File",
          keys: ["Ctrl", "N"],
          icon: <FilePlus size={13} />,
          action: handleNewFile,
        },
        {
          label: "New Window",
          keys: ["Ctrl", "Shift", "N"],
          icon: <PlusSquare size={13} />,
          action: () => void openNewWindow(),
        },
        {
          label: "Open File…",
          keys: ["Ctrl", "O"],
          icon: <FileText size={13} />,
          action: () => window.dispatchEvent(new Event(OPEN_FILE_EVENT)),
        },
        {
          label: "Open Folder…",
          keys: ["Ctrl", "K", "Ctrl", "O"],
          icon: <FolderOpen size={13} />,
          action: () => {
            onSetSidebarTab("files");
            window.dispatchEvent(new Event(OPEN_FOLDER_EVENT));
          },
        },
        {
          label: "Open Workspace…",
          icon: <FolderTree size={13} />,
          action: () => void openWorkspaceFromFile(openFolder, openFileInEditor),
        },
        {
          label: "Save Workspace As…",
          icon: <Save size={13} className="text-[#a0c4ff]" />,
          action: () => void saveWorkspaceAs(),
        },
        { separator: true, label: "", action: () => {} },
        {
          label: "Save",
          keys: ["Ctrl", "S"],
          icon: <Save size={13} />,
          action: onSaveActive,
        },
        {
          label: "Save All",
          keys: ["Ctrl", "K", "S"],
          icon: <Save size={13} className="text-[#e0a96d]" />,
          action: onSaveActive,
        },
        {
          label: "Auto Save",
          checked: autoSave,
          icon: autoSave ? <Check size={13} className="text-emerald-400" /> : undefined,
          action: toggleAutoSave,
        },
        { separator: true, label: "", action: () => {} },
        {
          label: "Close Tab",
          keys: ["Ctrl", "W"],
          icon: <X size={13} />,
          action: () => {
            if (activeTab) requestClose(activeTab);
          },
        },
        {
          label: "Close All Tabs",
          keys: ["Ctrl", "K", "Ctrl", "W"],
          action: () => {
            [...openTabs].forEach((t) => requestClose(t.path));
          },
        },
        { separator: true, label: "", action: () => {} },
        {
          label: "Exit Fahh",
          keys: ["Alt", "F4"],
          action: () => void closeWindow(),
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
        { separator: true, label: "", action: () => {} },
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
          label: "Copy Path",
          action: handleCopyPath,
        },
        {
          label: "Copy Relative Path",
          action: handleCopyRelativePath,
        },
        {
          label: "Paste",
          keys: ["Ctrl", "V"],
          action: () => runEditorAction("editor.action.clipboardPasteAction"),
        },
        { separator: true, label: "", action: () => {} },
        {
          label: "Find",
          keys: ["Ctrl", "F"],
          icon: <Search size={13} />,
          action: () => runEditorAction("actions.find"),
        },
        {
          label: "Find in Files",
          keys: ["Ctrl", "Shift", "F"],
          icon: <Search size={13} className="text-fahh-accent" />,
          action: () => onSetSidebarTab("search"),
        },
        {
          label: "Replace",
          keys: ["Ctrl", "H"],
          icon: <Replace size={13} />,
          action: () => runEditorAction("editor.action.startFindReplaceAction"),
        },
        {
          label: "Replace in Files",
          keys: ["Ctrl", "Shift", "H"],
          icon: <Replace size={13} className="text-fahh-accent" />,
          action: () => onSetSidebarTab("search"),
        },
        { separator: true, label: "", action: () => {} },
        {
          label: "Toggle Line Comment",
          keys: ["Ctrl", "/"],
          action: () => runEditorAction("editor.action.commentLine"),
        },
        {
          label: "Toggle Block Comment",
          keys: ["Shift", "Alt", "A"],
          action: () => runEditorAction("editor.action.blockComment"),
        },
        {
          label: "Format Document",
          keys: ["Shift", "Alt", "F"],
          icon: <Sparkles size={13} />,
          action: () => runEditorAction("editor.action.formatDocument"),
        },
        {
          label: "Transform to Uppercase",
          action: () => runEditorAction("editor.action.transformToUppercase"),
        },
        {
          label: "Transform to Lowercase",
          action: () => runEditorAction("editor.action.transformToLowercase"),
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
        { separator: true, label: "", action: () => {} },
        {
          label: "Copy Line Up",
          keys: ["Shift", "Alt", "↑"],
          action: () => runEditorAction("editor.action.copyLinesUpAction"),
        },
        {
          label: "Copy Line Down",
          keys: ["Shift", "Alt", "↓"],
          action: () => runEditorAction("editor.action.copyLinesDownAction"),
        },
        {
          label: "Move Line Up",
          keys: ["Alt", "↑"],
          action: () => runEditorAction("editor.action.moveLinesUpAction"),
        },
        {
          label: "Move Line Down",
          keys: ["Alt", "↓"],
          action: () => runEditorAction("editor.action.moveLinesDownAction"),
        },
        {
          label: "Duplicate Selection",
          action: () => runEditorAction("editor.action.duplicateSelection"),
        },
        { separator: true, label: "", action: () => {} },
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
        {
          label: "Add Next Occurrence",
          keys: ["Ctrl", "D"],
          action: () => runEditorAction("editor.action.addSelectionToNextFindMatch"),
        },
        {
          label: "Select All Occurrences",
          keys: ["Ctrl", "Shift", "L"],
          action: () => runEditorAction("editor.action.selectHighlights"),
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
        { separator: true, label: "", action: () => {} },
        {
          label: isSpatial ? "Exit Spatial Canvas Mode" : "Spatial Canvas Mode (CATE)",
          keys: ["Ctrl", "Shift", "C"],
          icon: <Sparkles size={13} className="text-[#4a9eff]" />,
          action: () => useSpatialStore.getState().toggleSpatialMode(),
        },
        {
          label: "Extensions Store (Marketplace)",
          keys: ["Ctrl", "Shift", "X"],
          icon: <Blocks size={13} className="text-[#c084fc]" />,
          action: () => onSetSidebarTab("extensions"),
        },
        {
          label: "Fahh Local Agent",
          keys: ["Ctrl", "L"],
          icon: <Bot size={13} className="text-[#e0a96d]" />,
          action: () => onSetSidebarTab("ai"),
        },
        { separator: true, label: "", action: () => {} },
        {
          label: "Toggle Primary Sidebar",
          icon: <PanelLeft size={13} />,
          action: onToggleSidebar,
        },
        {
          label: "Toggle Secondary Sidebar",
          keys: ["Ctrl", "Alt", "B"],
          action: () => toggleZone("secondary"),
        },
        {
          label: "Toggle Bottom Panel",
          keys: ["Ctrl", "`"],
          icon: <PanelBottom size={13} />,
          action: onToggleBottomPanel,
        },
        {
          label: "Split Editor Right",
          keys: ["Ctrl", "\\"],
          action: () => splitActiveEditor("right"),
        },
        {
          label: "Split Editor Down",
          action: () => splitActiveEditor("below"),
        },
        {
          label: "Reset Layout",
          action: resetLayout,
        },
        {
          label: "Project Explorer",
          keys: ["Ctrl", "Shift", "E"],
          icon: <FolderTree size={13} />,
          action: () => onSetSidebarTab("files"),
        },
        {
          label: "Search across Files",
          keys: ["Ctrl", "Shift", "F"],
          icon: <Search size={13} />,
          action: () => onSetSidebarTab("search"),
        },
        {
          label: "Source Control",
          keys: ["Ctrl", "Shift", "G"],
          action: () => onSetSidebarTab("git"),
        },
        {
          label: "Problems & Diagnostics",
          keys: ["Ctrl", "Shift", "M"],
          action: () => onSetBottomTab("problems"),
        },
        { separator: true, label: "", action: () => {} },
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
          label: "Go to Line/Column…",
          keys: ["Ctrl", "G"],
          action: () => runEditorAction("editor.action.gotoLine"),
        },
        { separator: true, label: "", action: () => {} },
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
        { separator: true, label: "", action: () => {} },
        {
          label: "Go to Definition",
          keys: ["F12"],
          action: () => runEditorAction("editor.action.revealDefinition"),
        },
        {
          label: "Go to References",
          keys: ["Shift", "F12"],
          action: () => runEditorAction("editor.action.referenceSearch.trigger"),
        },
      ],
    },
    {
      label: "Run",
      items: [
        {
          label: "Run Active File",
          keys: ["F5"],
          icon: <Play size={13} className="text-emerald-400" />,
          action: () => onSetBottomTab("run"),
        },
        {
          label: "Open Run Panel",
          action: () => onSetBottomTab("run"),
        },
        { separator: true, label: "", action: () => {} },
        {
          label: "Toggle Breakpoint",
          keys: ["F9"],
          action: () => runEditorAction("editor.debug.action.toggleBreakpoint"),
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
          action: () => onSetBottomTab("terminal"),
        },
        {
          label: "Launch Antigravity CLI (agy)",
          icon: <Sparkles size={13} className="text-amber-400" />,
          action: () => void launchAgyTerminal(),
        },
        { separator: true, label: "", action: () => {} },
        {
          label: "Clear Terminal",
          keys: ["Ctrl", "L"],
          action: () => onSetBottomTab("terminal"),
        },
      ],
    },
    {
      label: "Help",
      items: [
        {
          label: "Welcome Tour",
          icon: <Flame size={13} className="text-amber-400" />,
          action: onShowWelcome,
        },
        {
          label: "Documentation Hub",
          icon: <ExternalLink size={13} />,
          action: () => window.open("https://fahhide.duckdns.org/docs.html", "_blank"),
        },
        {
          label: "Extensions & Themes Store",
          icon: <Blocks size={13} />,
          action: () => onSetSidebarTab("extensions"),
        },
        {
          label: "Optional Tools Setup…",
          action: onShowInstaller,
        },
        { separator: true, label: "", action: () => {} },
        {
          label: "Ring the Bell (Test Sound)",
          icon: <Bell size={13} />,
          action: () => useFahhStore.getState().ringBell(),
        },
        {
          label: "Report Issue (GitHub)",
          icon: <Bug size={13} />,
          action: () => window.open("https://github.com/Arnav1771/fahh-ide/issues", "_blank"),
        },
        {
          label: "About Fahh Editor",
          action: () => alert(`Fahh Editor v${__APP_VERSION__}\nThe Next-Generation Spatial AI Editor.\nBuilt with Tauri 2, Rust & Monaco.`),
        },
      ],
    },
  ];

  return (
    <div
      ref={menuBarRef}
      data-tauri-drag-region
      className="h-8 w-full bg-[#12110f] border-b border-fahh-surface flex items-center px-2 select-none text-xs text-fahh-muted shrink-0 z-30 justify-between"
      role="menubar"
    >
      {/* ── Left Side: App Icon + Menu Dropdowns ── */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Brand logo & version */}
        <div
          data-tauri-drag-region
          className="flex items-center gap-1.5 mr-2 pr-2.5 border-r border-fahh-surface select-none cursor-default"
        >
          <span className="font-bold text-fahh-accent tracking-wider text-[11px] font-mono">FAHH</span>
          <span className="text-[9.5px] text-fahh-muted/70 font-mono">v{__APP_VERSION__}</span>
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
                  <div className="absolute top-full left-0 mt-1 min-w-[230px] bg-[#161513] border border-fahh-surface rounded-md shadow-2xl py-1 z-50 animate-in fade-in zoom-in-95 duration-75">
                    {m.items.map((item, idx) => {
                      if (item.separator) {
                        return <div key={idx} className="my-1 border-t border-fahh-surface/70" />;
                      }
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setOpenMenu(null);
                            item.action();
                          }}
                          className="w-full flex items-center justify-between px-3 py-1.5 text-left text-xs text-fahh-text hover:bg-fahh-surface/80 hover:text-white transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-4 flex items-center justify-center text-fahh-muted shrink-0">
                              {item.icon}
                            </span>
                            <span className="truncate">{item.label}</span>
                          </div>
                          {item.keys && (
                            <div className="flex items-center gap-0.5 ml-4 shrink-0">
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
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Center: Draggable Workspace Title Bar ── */}
      <div
        data-tauri-drag-region
        onDoubleClick={async () => {
          await toggleMaximizeWindow();
          setIsMaximized(await isWindowMaximized());
        }}
        className="flex-1 flex justify-center items-center h-full px-4 overflow-hidden cursor-default"
      >
        <div
          data-tauri-drag-region
          className="flex items-center gap-2 text-[11px] text-fahh-muted max-w-[500px] truncate select-none pointer-events-none"
        >
          <span className="text-fahh-text font-medium">{workspaceName}</span>
          {activeDocName && (
            <>
              <span className="text-fahh-muted/50">—</span>
              <span className="text-fahh-accent font-mono truncate">{activeDocName}</span>
            </>
          )}
        </div>
      </div>

      {/* ── Right Side: Quick Search, Canvas Toggle, Layout & Native Window Controls ── */}
      <div className="flex items-center gap-1 shrink-0 h-full">
        {/* Quick Search */}
        <button
          type="button"
          onClick={onOpenQuickOpen}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-fahh-surface/50 hover:bg-fahh-surface border border-fahh-surface text-[11px] text-fahh-muted hover:text-fahh-text transition-colors mr-1 max-md:hidden"
          title="Quick Open (Ctrl+P)"
        >
          <Search size={11} className="text-fahh-accent" />
          <span>Search</span>
          <kbd className="px-1 py-0.2 bg-fahh-bg text-[9px] font-mono text-fahh-muted rounded border border-fahh-surface">
            Ctrl P
          </kbd>
        </button>

        {/* Spatial Canvas Toggle Pill */}
        <button
          type="button"
          onClick={() => useSpatialStore.getState().toggleSpatialMode()}
          className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all mr-1.5 ${
            isSpatial
              ? "bg-[#4a9eff] text-[#0a0907] font-semibold shadow-[0_0_12px_rgba(74,158,255,0.5)]"
              : "bg-fahh-surface/60 hover:bg-fahh-surface text-fahh-text border border-fahh-surface"
          }`}
          title="Toggle CATE Spatial Canvas Mode (Ctrl+Shift+C)"
        >
          <Sparkles size={11} className={isSpatial ? "text-[#0a0907]" : "text-[#4a9eff]"} />
          <span className="max-lg:hidden">{isSpatial ? "Spatial Canvas" : "Canvas"}</span>
        </button>

        {/* Layout & Window Actions */}
        <div className="flex items-center gap-0.5 mr-2">
          <button
            type="button"
            onClick={() => void openNewWindow()}
            title="New Window (Ctrl+Shift+N)"
            className="p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface transition-colors"
          >
            <PlusSquare size={13} />
          </button>
          <button
            type="button"
            onClick={onToggleSidebar}
            title="Toggle Primary Sidebar"
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

        {/* Vertical divider before window controls */}
        <div className="w-[1px] h-3.5 bg-fahh-surface mr-1" />

        {/* ── Native Custom Window Controls (Minimize, Maximize/Restore, Close) ── */}
        <div className="flex items-center h-full -mr-2">
          <button
            type="button"
            onClick={() => void minimizeWindow()}
            title="Minimize"
            className="h-full px-3.5 flex items-center justify-center text-fahh-muted hover:text-fahh-text hover:bg-white/10 transition-colors"
          >
            <Minus size={13} />
          </button>
          <button
            type="button"
            onClick={async () => {
              await toggleMaximizeWindow();
              setIsMaximized(await isWindowMaximized());
            }}
            title={isMaximized ? "Restore Down" : "Maximize"}
            className="h-full px-3.5 flex items-center justify-center text-fahh-muted hover:text-fahh-text hover:bg-white/10 transition-colors"
          >
            {isMaximized ? <Copy size={11} className="rotate-180" /> : <Square size={11} />}
          </button>
          <button
            type="button"
            onClick={() => void closeWindow()}
            title="Close"
            className="h-full px-4 flex items-center justify-center text-fahh-muted hover:text-white hover:bg-[#e81123] transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
