import { useEffect, useMemo, useRef, useState } from "react";
import { FileTree } from "./components/FileTree/FileTree";
import { TabBar } from "./components/Editor/TabBar";
import { EditorPane } from "./components/Editor/EditorPane";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import { AIPanel } from "./components/AIPanel";
import { GitSidebar } from "./components/GitSidebar";
import { InstallerWizard } from "./components/InstallerWizard";
import { RunPanel } from "./components/RunPanel";
import { DebugPanel } from "./components/DebugPanel";
import { ThemePanel } from "./components/ThemePanel";
import { ExtensionsPanel } from "./components/ExtensionsPanel";
import { LspBridge } from "./components/LspBridge";
import { initFahhSfx, teardownFahhSfx } from "./lib/fahh";
import { useThemeStore } from "./store/themeStore";
import { useFahhStore, type Intensity } from "./store/fahhStore";
import { ImpactLayer } from "./components/Fahh/ImpactLayer";
import { StatusHud, HudControls, CleanSweep } from "./components/Fahh/StatusHud";
import { CommandPalette } from "./components/Fahh/CommandPalette";
import { FAHH_COMMAND, OPEN_FOLDER_EVENT } from "./lib/commands";
import { runEditorAction } from "./lib/monacoBridge";
import type { PaletteCommand } from "./lib/palette";
import { THEME_DEFINITIONS, applyThemeCssVars } from "./components/ThemePanel";
import { FolderTree, GitBranch, Bug, Bot, Blocks, Palette, Settings, X, Play } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type SidebarTab = "files" | "git" | "ai" | "extensions" | "debug" | "theme";
type BottomTab = "terminal" | "run" | "debug";

// ─── Activity bar button ──────────────────────────────────────────────────────

function ActivityBtn({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 flex items-center justify-center rounded text-sm transition-colors ${
        active
          ? "bg-fahh-surface text-fahh-accent"
          : "text-fahh-muted hover:text-fahh-text"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Bottom tab bar button ────────────────────────────────────────────────────

function BottomTabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-xs font-medium border-t-2 transition-colors ${
        active
          ? "border-fahh-accent text-fahh-accent bg-fahh-bg"
          : "border-transparent text-fahh-muted hover:text-fahh-text"
      }`}
    >
      {children}
    </button>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("files");
  const [showInstaller, setShowInstaller] = useState(false);
  const [showBottomPanel, setShowBottomPanel] = useState(true);
  const [bottomTab, setBottomTab] = useState<BottomTab>("terminal");

  const { activeTheme, setTheme } = useThemeStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const editorRegionRef = useRef<HTMLDivElement>(null);

  // Apply theme CSS vars on mount and whenever the active theme changes
  useEffect(() => {
    const def = THEME_DEFINITIONS.find((d) => d.id === activeTheme);
    if (def) applyThemeCssVars(def);
  }, [activeTheme]);

  // Fahh SFX. Errors from the backend (builds, language servers) go through
  // the HUD store, which owns the cooldown, the combo and the mute.
  useEffect(() => {
    initFahhSfx(() => useFahhStore.getState().external());
    return () => teardownFahhSfx();
  }, []);

  // Everything the palette (and the welcome screen) can do.
  const commands = useMemo<PaletteCommand[]>(() => {
    const view = (tab: SidebarTab) => () => setSidebarTab(tab);
    const bottom = (tab: BottomTab) => () => {
      setBottomTab(tab);
      setShowBottomPanel(true);
    };
    const intensity = (i: Intensity) => () => useFahhStore.getState().setIntensity(i);
    return [
      { id: "folder.open", group: "File", label: "Open Folder…", keywords: "workspace project", run: () => {
        setSidebarTab("files");
        window.setTimeout(() => window.dispatchEvent(new Event(OPEN_FOLDER_EVENT)), 0);
      } },
      { id: "view.explorer", group: "View", label: "Explorer", keywords: "files tree", run: view("files") },
      { id: "view.git", group: "View", label: "Source Control", keywords: "git branch commit", run: view("git") },
      { id: "view.debug", group: "View", label: "Debug", run: () => { setSidebarTab("debug"); bottom("debug")(); } },
      { id: "view.ai", group: "View", label: "AI Assistant", keywords: "chat llm ollama", run: view("ai") },
      { id: "view.extensions", group: "View", label: "Extensions", keywords: "plugins language packs", run: view("extensions") },
      { id: "view.theme", group: "View", label: "Colour Theme", keywords: "color appearance", run: view("theme") },
      { id: "panel.toggle", group: "View", label: "Toggle Panel", keys: ["Ctrl", "`"], keywords: "terminal bottom", run: () => setShowBottomPanel((v) => !v) },
      { id: "panel.terminal", group: "View", label: "Terminal", keywords: "shell console", run: bottom("terminal") },
      { id: "panel.run", group: "Run", label: "Run Panel", keywords: "execute active file", run: bottom("run") },
      { id: "problem.next", group: "Go", label: "Next Problem", keys: ["F8"], keywords: "error warning", run: () => { runEditorAction("editor.action.marker.next"); } },
      { id: "problem.prev", group: "Go", label: "Previous Problem", keys: ["Shift", "F8"], keywords: "error warning", run: () => { runEditorAction("editor.action.marker.prev"); } },
      ...THEME_DEFINITIONS.map((d) => ({ id: `theme.${d.id}`, group: "Theme", label: d.name, keywords: d.description, run: () => setTheme(d.id) })),
      { id: "fahh.ring", group: "Fahh", label: "Ring the Bell", keywords: "test sound play", run: () => useFahhStore.getState().ringBell() },
      { id: "fahh.epic", group: "Fahh", label: "Effects: Epic", keywords: "shake intensity power mode", run: intensity("epic") },
      { id: "fahh.subtle", group: "Fahh", label: "Effects: Subtle", keywords: "intensity quiet", run: intensity("subtle") },
      { id: "fahh.off", group: "Fahh", label: "Effects: Off", keywords: "intensity silent disable", run: intensity("off") },
      { id: "fahh.mute", group: "Fahh", label: "Mute / Unmute Sound", keywords: "volume silence", run: () => useFahhStore.getState().toggleMute() },
      { id: "tools.optional", group: "Tools", label: "Optional Tools…", keywords: "installer n8n flowise setup", run: () => setShowInstaller(true) },
    ];
  }, [setTheme]);

  // Ctrl+Shift+P and F1 open the palette. Captured before Monaco sees them,
  // so its own F1 palette does not open underneath ours.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p";
      if (combo || e.key === "F1") {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Commands asked for by id (the welcome screen uses this).
  useEffect(() => {
    const onCommand = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id === "palette.open") setPaletteOpen(true);
      else commands.find((c) => c.id === id)?.run();
    };
    window.addEventListener(FAHH_COMMAND, onCommand);
    return () => window.removeEventListener(FAHH_COMMAND, onCommand);
  }, [commands]);

  // Derive Monaco theme from the active Fahh theme
  const monacoTheme =
    THEME_DEFINITIONS.find((d) => d.id === activeTheme)?.monacoTheme ??
    "vs-dark";

  // Disable WebView2 browser context menu (prevents Reload/Share/More Tools)
  useEffect(() => {
    const block = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", block);
    return () => document.removeEventListener("contextmenu", block);
  }, []);

  // Disable F5 / Ctrl+R page reload (would wipe all editor state)
  useEffect(() => {
    const blockReload = (e: KeyboardEvent) => {
      if (
        e.key === "F5" ||
        ((e.ctrlKey || e.metaKey) && e.key === "r") ||
        ((e.ctrlKey || e.metaKey) && e.key === "R")
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", blockReload);
    return () => window.removeEventListener("keydown", blockReload);
  }, []);

  // Toggle bottom panel via keyboard shortcut (Ctrl+`)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        setShowBottomPanel((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-fahh-bg text-fahh-text">
      {/* Non-rendering LSP bridge */}
      <LspBridge />

      {/* ── Activity bar ── */}
      <div className="w-10 shrink-0 flex flex-col items-center gap-1 pt-2 bg-fahh-sidebar border-r border-fahh-surface">
        <ActivityBtn
          active={sidebarTab === "files"}
          title="Explorer"
          onClick={() => setSidebarTab("files")}
        >
          <FolderTree size={18} />
        </ActivityBtn>

        <ActivityBtn
          active={sidebarTab === "git"}
          title="Source Control"
          onClick={() => setSidebarTab("git")}
        >
          <GitBranch size={18} />
        </ActivityBtn>

        <ActivityBtn
          active={sidebarTab === "debug"}
          title="Debug"
          onClick={() => {
            setSidebarTab("debug");
            setBottomTab("debug");
            setShowBottomPanel(true);
          }}
        >
          <Bug size={18} />
        </ActivityBtn>

        <ActivityBtn
          active={sidebarTab === "ai"}
          title="AI Assistant"
          onClick={() => setSidebarTab("ai")}
        >
          <Bot size={18} />
        </ActivityBtn>

        <ActivityBtn
          active={sidebarTab === "extensions"}
          title="Extensions"
          onClick={() => setSidebarTab("extensions")}
        >
          <Blocks size={18} />
        </ActivityBtn>

        <div className="flex-1" />

        {/* Theme picker */}
        <ActivityBtn
          active={sidebarTab === "theme"}
          title="Colour Theme"
          onClick={() => setSidebarTab("theme")}
        >
          <Palette size={18} />
        </ActivityBtn>

        {/* Optional tools wizard */}
        <button
          onClick={() => setShowInstaller(true)}
          title="Optional Tools"
          className="w-8 h-8 mb-2 flex items-center justify-center rounded text-sm text-fahh-muted hover:text-fahh-text transition-colors"
        >
          <Settings size={18} />
        </button>
      </div>

      {/* ── Sidebar panel ── */}
      <div className="w-60 shrink-0 flex flex-col border-r border-fahh-surface overflow-hidden">
        {sidebarTab === "files" && <FileTree />}

        {sidebarTab === "git" && <GitSidebar />}

        {sidebarTab === "debug" && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="fahh-label px-3 py-2 text-[10px] uppercase tracking-widest text-fahh-muted font-semibold border-b border-fahh-surface bg-fahh-sidebar shrink-0">
              Debug
            </div>
            <DebugPanel />
          </div>
        )}

        {sidebarTab === "ai" && <AIPanel />}

        {sidebarTab === "theme" && (
          <div className="flex flex-col h-full overflow-y-auto bg-fahh-sidebar">
            <ThemePanel />
          </div>
        )}

        {sidebarTab === "extensions" && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="fahh-label px-3 py-2 text-[10px] uppercase tracking-widest text-fahh-muted font-semibold border-b border-fahh-surface bg-fahh-sidebar shrink-0">
              Extensions
            </div>
            <div className="flex-1 overflow-y-auto">
              {/* Theme switcher at top of extensions */}
              <ThemePanel />
              <div className="border-t border-fahh-surface mt-1" />
              <ExtensionsPanel />
            </div>
          </div>
        )}
      </div>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Editor region (the fahh effects play over this, and only this) */}
        <div ref={editorRegionRef} className="relative flex flex-col flex-1 min-h-0">
          <TabBar />
          <EditorPane monacoTheme={monacoTheme} />
          <ImpactLayer targetRef={editorRegionRef} />
        </div>

        {/* Bottom panel (Terminal / Run / Debug) */}
        {showBottomPanel && (
          <div className="h-52 shrink-0 border-t border-fahh-surface flex flex-col">
            {/* Panel tab bar */}
            <div className="flex items-center shrink-0 border-b border-fahh-surface bg-fahh-sidebar">
              <BottomTabBtn
                active={bottomTab === "terminal"}
                onClick={() => setBottomTab("terminal")}
              >
                Terminal
              </BottomTabBtn>
              <BottomTabBtn
                active={bottomTab === "run"}
                onClick={() => setBottomTab("run")}
              >
                Run
              </BottomTabBtn>
              <BottomTabBtn
                active={bottomTab === "debug"}
                onClick={() => setBottomTab("debug")}
              >
                Debug
              </BottomTabBtn>
              <div className="flex-1" />
              <button
                onClick={() => setShowBottomPanel(false)}
                title="Close panel (Ctrl+`)"
                className="px-2 text-fahh-muted hover:text-fahh-text text-xs mr-1 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {/* Panel content */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {bottomTab === "terminal" && <TerminalPanel />}
              {bottomTab === "run" && <RunPanel />}
              {bottomTab === "debug" && <DebugPanel />}
            </div>
          </div>
        )}

        {/* Status bar */}
        <div className="fahh-statusbar relative overflow-hidden h-6 shrink-0 bg-fahh-sidebar border-t border-fahh-surface flex items-center px-3 gap-4 text-xs text-fahh-muted">
          <CleanSweep />
          <StatusHud />

          <button
            onClick={() => setShowBottomPanel((p) => !p)}
            className="hover:text-fahh-text transition-colors"
          >
            {showBottomPanel ? "Hide Panel" : "Show Panel"}
          </button>

          {/* Quick run shortcut */}
          <button
            onClick={() => {
              setBottomTab("run");
              setShowBottomPanel(true);
            }}
            className="flex items-center gap-1 hover:text-fahh-text transition-colors"
          >
            <Play size={12} /> Run
          </button>

          <div className="flex-1" />

          <HudControls />

          {/* Active theme indicator */}
          <span className="text-fahh-muted capitalize">
            {activeTheme.replace(/-/g, " ")}
          </span>

          <span>v0.4.0</span>
        </div>
      </div>

      {showInstaller && (
        <InstallerWizard onClose={() => setShowInstaller(false)} />
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );
}
