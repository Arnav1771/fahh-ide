import { useEffect, useMemo, useRef, useState } from "react";
import { FileTree } from "./components/FileTree/FileTree";
import { TabBar } from "./components/Editor/TabBar";
import { EditorPane } from "./components/Editor/EditorPane";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import { AgentPanel } from "./components/AgentPanel";
import { initAgentEvents, useAgentStore } from "./store/agentStore";
import { GitSidebar } from "./components/GitSidebar";
import { InstallerWizard } from "./components/InstallerWizard";
import { Welcome } from "./components/Welcome";
import { ResizeHandle } from "./components/ResizeHandle";
import { Toasts } from "./components/Toasts";
import { clampSize, loadSize, saveSize } from "./lib/panelSize";
import { saveActive, unsavedMessage } from "./lib/tabActions";
import { handleOpenRequest } from "./lib/openRequest";
import { installCli, takePendingOpen } from "./lib/tauri";
import { useToastStore } from "./store/toastStore";
import type { OpenRequest } from "./lib/types";
import { markWelcomeSeen, shouldShowWelcome } from "./lib/welcome";
import { RunPanel } from "./components/RunPanel";
import { DebugPanel } from "./components/DebugPanel";
import { ThemePanel } from "./components/ThemePanel";
import { ExtensionsPanel } from "./components/ExtensionsPanel";
import { LspBridge } from "./components/LspBridge";
import { initFahhSfx, teardownFahhSfx } from "./lib/fahh";
import { useThemeStore } from "./store/themeStore";
import { useFahhStore, type Intensity } from "./store/fahhStore";
import { ImpactLayer } from "./components/Fahh/ImpactLayer";
import { StatusHud, HudControls, CleanSweep, LspStatusItem } from "./components/Fahh/StatusHud";
import { CommandPalette } from "./components/Fahh/CommandPalette";
import { FAHH_COMMAND, OPEN_FOLDER_EVENT } from "./lib/commands";
import { getActiveDocument, revealLine, runEditorAction } from "./lib/monacoBridge";
import type { PaletteCommand } from "./lib/palette";
import { usePreviewStore } from "./store/previewStore";
import { useEditorStore } from "./store/editorStore";
import { useFileStore } from "./store/fileStore";
import { previewKindFor } from "./lib/preview";
import { openBrowser } from "./lib/browser";
import { flattenTree } from "./lib/quickOpen";
import { useWorkspace } from "./hooks/useWorkspace";
import { THEME_DEFINITIONS, applyThemeCssVars } from "./components/ThemePanel";
import { FolderTree, GitBranch, Bug, Bot, Blocks, Palette, Settings, X, Play, Globe } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

const store = () => (typeof localStorage === "undefined" ? undefined : localStorage);
const SIDEBAR = { key: "fahh-sidebar-w", def: 240, min: 160, max: 560 };
const BOTTOM = { key: "fahh-bottom-h", def: 208, min: 80 };
/** Leave room for the editor: the bottom panel may take at most the window minus 220px. */
const bottomMax = () => (typeof window === "undefined" ? 600 : Math.max(BOTTOM.min, window.innerHeight - 220));

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
  const [showWelcome, setShowWelcome] = useState(() => shouldShowWelcome(typeof localStorage === "undefined" ? undefined : localStorage));
  const closeWelcome = () => {
    markWelcomeSeen(typeof localStorage === "undefined" ? undefined : localStorage);
    setShowWelcome(false);
  };
  const [showBottomPanel, setShowBottomPanel] = useState(true);
  const [sidebarW, setSidebarW] = useState(() => loadSize(SIDEBAR.key, SIDEBAR.def, SIDEBAR.min, SIDEBAR.max, store()));
  const [bottomH, setBottomH] = useState(() => loadSize(BOTTOM.key, BOTTOM.def, BOTTOM.min, bottomMax(), store()));
  useEffect(() => saveSize(SIDEBAR.key, sidebarW, store()), [sidebarW]);
  useEffect(() => saveSize(BOTTOM.key, bottomH, store()), [bottomH]);
  const [bottomTab, setBottomTab] = useState<BottomTab>("terminal");

  const { activeTheme, setTheme } = useThemeStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const tree = useFileStore((s) => s.tree);
  const { openFileInEditor, openFolder } = useWorkspace();
  const editorRegionRef = useRef<HTMLDivElement>(null);

  // `fahh <folder|file>` from a shell: the first launch's path, then any later ones the
  // running window is handed (src-tauri/src/app/mod.rs, single-instance).
  useEffect(() => {
    const run = (req: OpenRequest) =>
      handleOpenRequest(req, {
        openFolder,
        openFile: openFileInEditor,
        hasFolder: () => !!useFileStore.getState().root,
        isActive: (p) => getActiveDocument() === p,
        goToLine: revealLine,
        notify: (t, k) => useToastStore.getState().show(t, k),
      });
    let off: (() => void) | undefined;
    let gone = false;
    takePendingOpen().then((req) => req && run(req)).catch(() => {});
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen<OpenRequest>("fahh://open", (e) => void run(e.payload)))
      .then((fn) => (gone ? fn() : (off = fn)))
      .catch(() => {});
    return () => {
      gone = true;
      off?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Fahh Local: keep hearing the agent while its panel is hidden.
  useEffect(() => initAgentEvents(), []);

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
      { id: "view.ai", group: "View", label: "Fahh Local (AI agent)", keywords: "agent chat llm ollama groq composer", run: view("ai") },
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
      { id: "help.welcome", group: "Help", label: "Show Welcome", keywords: "onboarding tour getting started intro", run: () => setShowWelcome(true) },
      { id: "cli.install", group: "Tools", label: "Install 'fahh' Command in PATH", keywords: "shell terminal code command line cli", run: () => {
        installCli().then((m) => useToastStore.getState().show(m)).catch((e) => useToastStore.getState().show(String(e), "error"));
      } },
      { id: "tools.optional", group: "Tools", label: "Optional Tools…", keywords: "installer n8n flowise setup", run: () => setShowInstaller(true) },
      { id: "file.quickOpen", group: "Go", label: "Go to File…", keys: ["Ctrl", "P"], keywords: "quick open find file", run: () => setQuickOpen(true) },
      { id: "preview.side", group: "Preview", label: "Open Preview to the Side", keys: ["Ctrl", "K", "V"], keywords: "markdown html image csv split", run: () => {
        const path = useEditorStore.getState().activeTab;
        if (path && previewKindFor(path)) usePreviewStore.getState().toggleSide(path);
      } },
      { id: "preview.toggle", group: "Preview", label: "Toggle Preview", keys: ["Ctrl", "Shift", "V"], keywords: "markdown html image csv source", run: () => {
        const path = useEditorStore.getState().activeTab;
        if (path && previewKindFor(path)) usePreviewStore.getState().toggleInPlace(path);
      } },
      { id: "browser.open", group: "Browser", label: "Open Browser…", keywords: "localhost web page dev server url preview site", run: () => {
        const suggested = usePreviewStore.getState().localUrl ?? "http://localhost:5173";
        const typed = window.prompt("Open in the built-in browser (a port like 5173, or a URL):", suggested);
        if (typed && typed.trim()) openBrowser(typed);
      } },
    ];
  }, [setTheme]);

  // Quick Open lists every file in the opened folder (VS Code's Ctrl+P).
  const quickOpenFiles = useMemo<PaletteCommand[]>(
    () =>
      quickOpen
        ? flattenTree(tree).map((f) => ({
            id: f.path,
            group: f.folder,
            label: f.name,
            keywords: f.folder.replace(/[\\/]/g, " "),
            run: () => {
              openFileInEditor(f.path).catch((err) => console.error("open failed:", err));
            },
          }))
        : [],
    [quickOpen, tree, openFileInEditor]
  );

  // Ctrl+Shift+P and F1 open the palette. Captured before Monaco sees them,
  // so its own F1 palette does not open underneath ours.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const combo = mod && e.shiftKey && e.key.toLowerCase() === "p";
      if (combo || e.key === "F1") {
        e.preventDefault();
        e.stopPropagation();
        setQuickOpen(false);
        setPaletteOpen((v) => !v);
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        // Ctrl+P: Quick Open (and never the webview's print dialog).
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen(false);
        setQuickOpen((v) => !v);
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

  // Ctrl+S saves the open file from anywhere: editor, explorer, terminal, panels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveActive();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Closing the window with unsaved tabs asks first (Tauri close-requested).
  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onCloseRequested((e) => {
          const msg = unsavedMessage();
          if (msg && !window.confirm(msg)) e.preventDefault();
        })
      )
      .then((fn) => (gone ? fn() : (off = fn)))
      .catch(() => {
        // plain browser build: no native window to guard
      });
    return () => {
      gone = true;
      off?.();
    };
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
          title="Fahh Local (AI agent)"
          onClick={() => setSidebarTab("ai")}
        >
          <span className="relative">
            <Bot size={18} />
            <AgentStatusDot />
          </span>
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
      <div style={{ width: sidebarW }} className="fahh-sidebar shrink-0 flex flex-col overflow-hidden">
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

        {sidebarTab === "ai" && <AgentPanel onClose={() => setSidebarTab("files")} />}

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

      <ResizeHandle dir="col" size={sidebarW} onResize={(n) => setSidebarW(clampSize(n, SIDEBAR.min, SIDEBAR.max))} label="Resize sidebar" />

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
          <ResizeHandle dir="row" growsBackward size={bottomH} onResize={(n) => setBottomH(clampSize(n, BOTTOM.min, bottomMax()))} label="Resize panel" />
        )}
        {showBottomPanel && (
          <div style={{ height: Math.min(bottomH, bottomMax()) }} className="shrink-0 flex flex-col">
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
        <div className="fahh-statusbar relative overflow-hidden h-6 shrink-0 bg-fahh-sidebar border-t border-fahh-surface flex items-center px-3 gap-4 max-[900px]:gap-3 text-xs text-fahh-muted [&>*]:shrink-0 [&>*]:whitespace-nowrap">
          <CleanSweep />
          <StatusHud />
          <LocalServerItem />

          <button
            onClick={() => setShowBottomPanel((p) => !p)}
            className="hover:text-fahh-text transition-colors max-[760px]:hidden"
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

          <LspStatusItem />
          <HudControls />

          {/* Active theme indicator */}
          <span className="text-fahh-muted capitalize max-[860px]:hidden">
            {activeTheme.replace(/-/g, " ")}
          </span>

          <span className="max-[680px]:hidden">v0.5.0</span>
        </div>
      </div>

      {showInstaller && (
        <InstallerWizard onClose={() => setShowInstaller(false)} />
      )}

      {showWelcome && (
        <Welcome
          onClose={closeWelcome}
          onOpenAI={() => setSidebarTab("ai")}
          onOpenFolder={() => {
            setSidebarTab("files");
            window.setTimeout(() => window.dispatchEvent(new Event(OPEN_FOLDER_EVENT)), 0);
          }}
        />
      )}

      <Toasts />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      <CommandPalette
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        commands={quickOpenFiles}
        label="Go to file"
        placeholder="Search files by name"
        recentKey="fahh-quickopen-recent"
        variant="file"
        emptyText="Open a folder first: Ctrl+Shift+P, then “Open Folder…”."
      />
    </div>
  );
}

/** Fahh Local state on the activity bar: pulses while working, solid when it needs you. */
function AgentStatusDot() {
  const status = useAgentStore((s) => s.status);
  if (status !== "running" && status !== "needs_input") return null;
  return (
    <span
      aria-label={status === "needs_input" ? "Fahh Local needs your approval" : "Fahh Local is working"}
      className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${status === "needs_input" ? "bg-fahh-error" : "bg-fahh-accent animate-pulse"}`}
    />
  );
}

/** Status bar: the dev server the terminal or a run just started, one click from the built-in browser. */
function LocalServerItem() {
  const url = usePreviewStore((s) => s.localUrl);
  if (!url) return null;
  const label = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <button
      onClick={() => openBrowser(url)}
      title={`Open ${url} in the built-in browser`}
      className="flex items-center gap-1 hover:text-fahh-text transition-colors"
    >
      <Globe size={12} aria-hidden="true" /> {label}
    </button>
  );
}
