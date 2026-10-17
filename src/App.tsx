import { useEffect, useMemo, useState } from "react";
import { InstallerWizard } from "./components/InstallerWizard";
import { Welcome } from "./components/Welcome";
import { Toasts } from "./components/Toasts";
import { saveActive, unsavedMessage } from "./lib/tabActions";
import { handleOpenRequest } from "./lib/openRequest";
import { installCli, takePendingOpen } from "./lib/tauri";
import { useToastStore } from "./store/toastStore";
import type { OpenRequest } from "./lib/types";
import { markWelcomeSeen, shouldShowWelcome } from "./lib/welcome";
import { LspBridge } from "./components/LspBridge";
import { initFahhSfx, teardownFahhSfx } from "./lib/fahh";
import { useThemeStore } from "./store/themeStore";
import { useFahhStore, type Intensity } from "./store/fahhStore";
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
import { Workbench } from "./components/Workbench";
import { listViews } from "./lib/viewRegistry";
import { activeViewId, movePanel, resetLayout, revealView, splitActiveEditor, toggleMaximizePanel, toggleZone } from "./lib/workbench";
import { Settings, Play, Globe } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [showInstaller, setShowInstaller] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => shouldShowWelcome(typeof localStorage === "undefined" ? undefined : localStorage));
  const closeWelcome = () => {
    markWelcomeSeen(typeof localStorage === "undefined" ? undefined : localStorage);
    setShowWelcome(false);
  };
  const [shownView, setShownView] = useState<string | undefined>();
  useEffect(() => {
    const on = () => setShownView(activeViewId());
    window.addEventListener("fahh-dock-active", on);
    return () => window.removeEventListener("fahh-dock-active", on);
  }, []);

  const { activeTheme, setTheme } = useThemeStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const tree = useFileStore((s) => s.tree);
  const { openFileInEditor, openFolder } = useWorkspace();

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

  // Everything the palette (and the welcome screen) can do.
  const commands = useMemo<PaletteCommand[]>(() => {
    const intensity = (i: Intensity) => () => useFahhStore.getState().setIntensity(i);
    return [
      { id: "folder.open", group: "File", label: "Open Folder…", keywords: "workspace project", run: () => {
        revealView("explorer");
        window.setTimeout(() => window.dispatchEvent(new Event(OPEN_FOLDER_EVENT)), 0);
      } },
      // Every registered view gets a "View: <title>" command (view.explorer, view.git, view.terminal, ...).
      ...listViews().map((v) => ({ id: `view.${v.id}`, group: "View", label: v.title, keywords: `${v.id} ${v.defaultLocation}`, run: () => revealView(v.id) })),
      { id: "view.sidebar", group: "View", label: "Toggle Primary Side Bar", keys: ["Ctrl", "B"], keywords: "explorer left hide show", run: () => toggleZone("primary") },
      { id: "view.secondary", group: "View", label: "Toggle Secondary Side Bar", keys: ["Ctrl", "Alt", "B"], keywords: "right hide show", run: () => toggleZone("secondary") },
      { id: "panel.toggle", group: "View", label: "Toggle Panel", keys: ["Ctrl", "`"], keywords: "terminal bottom", run: () => toggleZone("panel") },
      { id: "panel.maximize", group: "View", label: "Toggle Maximized Panel", keywords: "terminal bottom fullscreen", run: toggleMaximizePanel },
      { id: "panel.bottom", group: "View", label: "Move Panel to Bottom", keywords: "terminal dock position", run: () => movePanel("bottom") },
      { id: "panel.left", group: "View", label: "Move Panel to Left", keywords: "terminal dock position", run: () => movePanel("left") },
      { id: "panel.right", group: "View", label: "Move Panel to Right", keywords: "terminal dock position", run: () => movePanel("right") },
      { id: "layout.reset", group: "View", label: "Reset Layout", keywords: "default workbench panels sidebar restore", run: resetLayout },
      { id: "editor.split", group: "View", label: "Split Editor", keys: ["Ctrl", "\\"], keywords: "group right side by side", run: () => splitActiveEditor("right") },
      { id: "editor.splitDown", group: "View", label: "Split Editor Down", keywords: "group below", run: () => splitActiveEditor("below") },
      { id: "panel.terminal", group: "View", label: "Terminal", keywords: "shell console", run: () => revealView("terminal") },
      { id: "panel.run", group: "Run", label: "Run Panel", keywords: "execute active file", run: () => revealView("run") },
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
        toggleZone("panel");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-fahh-bg text-fahh-text">
      {/* Non-rendering LSP bridge */}
      <LspBridge />

      {/* ── Activity bar: one button per registered view ── */}
      <div className="w-10 shrink-0 flex flex-col items-center gap-1 pt-2 bg-fahh-sidebar border-r border-fahh-surface">
        {listViews()
          .filter((v) => v.activityBar !== false)
          .map((v) => (
            <ActivityBtn key={v.id} active={shownView === v.id} title={v.title} onClick={() => revealView(v.id)}>
              <v.icon size={18} />
            </ActivityBtn>
          ))}

        <div className="flex-1" />

        {/* Optional tools wizard */}
        <button
          onClick={() => setShowInstaller(true)}
          title="Optional Tools"
          className="w-8 h-8 mb-2 flex items-center justify-center rounded text-sm text-fahh-muted hover:text-fahh-text transition-colors"
        >
          <Settings size={18} />
        </button>
      </div>

      {/* ── Main area: the dock (editors, side bars, panel) and the status bar ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Workbench />

        {/* Status bar */}
        <div className="fahh-statusbar relative overflow-hidden h-6 shrink-0 bg-fahh-sidebar border-t border-fahh-surface flex items-center px-3 gap-4 max-[900px]:gap-3 text-xs text-fahh-muted [&>*]:shrink-0 [&>*]:whitespace-nowrap">
          <CleanSweep />
          <StatusHud />
          <LocalServerItem />

          <button
            onClick={() => toggleZone("panel")}
            className="hover:text-fahh-text transition-colors max-[760px]:hidden"
          >
            Toggle Panel
          </button>

          {/* Quick run shortcut */}
          <button
            onClick={() => revealView("run")}
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
          onOpenAI={() => revealView("ai")}
          onOpenFolder={() => {
            revealView("explorer");
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
