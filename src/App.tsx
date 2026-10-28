import { useEffect, useMemo, useState } from "react";
import { initAgentEvents, useAgentStore } from "./store/agentStore";
import { debugKeyAction, isAgentToggle, isSessionSearch } from "./lib/hotkeys";
import { useLayoutModeStore } from "./store/layoutModeStore";
import { initFsWatch } from "./lib/fsWatch";
import { AgentMode, onSessionSearch } from "./components/AgentMode";
import { ago, listSessions } from "./lib/agentSessionsList";
import type { AgentSessionInfo } from "./lib/types";
import { useDebugStore } from "./store/debugStore";
import { createLaunchJson } from "./lib/debugSession";
import { runDebugAction, runWithoutDebugging } from "./lib/debugActions";
import { InstallerWizard } from "./components/InstallerWizard";
import { Welcome } from "./components/Welcome";
import { Toasts } from "./components/Toasts";
import { saveActive, unsavedMessage } from "./lib/tabActions";
import { handleOpenRequest } from "./lib/openRequest";
import { installCli, openNewWindow, readFile, takePendingOpen } from "./lib/tauri";
import { useToastStore } from "./store/toastStore";
import type { OpenRequest } from "./lib/types";
import { markWelcomeSeen, shouldShowWelcome } from "./lib/welcome";
import { LspBridge } from "./components/LspBridge";
import { initFahhSfx, teardownFahhSfx } from "./lib/fahh";
import { useThemeStore } from "./store/themeStore";
import { useFahhStore, type Intensity } from "./store/fahhStore";
import { StatusHud, HudControls, CleanSweep, LspStatusItem } from "./components/Fahh/StatusHud";
import { CommandPalette } from "./components/Fahh/CommandPalette";
import { FAHH_COMMAND, OPEN_FOLDER_EVENT, OPEN_FILE_EVENT } from "./lib/commands";
import { getActiveDocument, revealLine, runEditorAction } from "./lib/monacoBridge";
import type { PaletteCommand } from "./lib/palette";
import { usePreviewStore } from "./store/previewStore";
import { useEditorStore } from "./store/editorStore";
import { useFileStore } from "./store/fileStore";
import { previewKindFor } from "./lib/preview";
import { openBrowser } from "./lib/browser";
import { launchAgyTerminal } from "./lib/tauri";
import { flattenTree } from "./lib/quickOpen";
import { useWorkspace } from "./hooks/useWorkspace";
import { saveWorkspaceAs, openWorkspaceFromFile, applyWorkspaceConfig, openRecentEntry } from "./lib/workspaceManager";
import { DialogHost } from "./components/Dialog";
import { AboutDialog } from "./components/Dialog/AboutDialog";
import { CheckSetupDialog } from "./components/Dialog/CheckSetupDialog";
import { launchUpdateCheck } from "./lib/updates";
import { alertDialog, confirmDialog, promptDialog } from "./store/dialogStore";
import { cycleTabs, endCycle, goBack, goForward, initNavigation, reopenClosedTab } from "./lib/navigation";
import { loadRecent } from "./lib/recent";
import { useSettingsStore } from "./store/settingsStore";
import { allThemes, applyThemeCssVars } from "./components/ThemePanel";
import { useExtensionThemes } from "./store/extensionThemesStore";
import { Settings, Play, Globe } from "lucide-react";
import { MenuBar } from "./components/MenuBar";
import { SpatialCanvas } from "./components/SpatialCanvas";
import { useSpatialStore } from "./store/spatialStore";
import { Workbench } from "./components/Workbench";
import { getView, listViews } from "./lib/viewRegistry";
import type { Zone } from "./lib/dockLayout";
import {
  closeActiveEditor,
  closeAllEditors,
  moveView,
  resetLayout,
  revealView,
  splitActiveEditor,
  toggleMaximizePanel,
  toggleView,
  toggleZone,
  visibleViewIds,
} from "./lib/workbench";

// ─── Types ────────────────────────────────────────────────────────────────────

/** The old sidebar / bottom tab names (the menu bar still speaks them); each is a dock view now. */
export type SidebarTab = "files" | "search" | "git" | "ai" | "extensions" | "debug" | "theme";
export type BottomTab = "terminal" | "run" | "debug" | "problems";
const viewFor = (tab: SidebarTab | BottomTab): string => (tab === "files" ? "explorer" : tab === "ai" ? "agent" : tab);
const MOVE_TARGETS: Array<[Zone, string]> = [
  ["primary", "Left Side Bar"],
  ["secondary", "Right Side Bar"],
  ["panel", "Panel"],
  ["editor", "Editor Area"],
];

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
  const [showAbout, setShowAbout] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => shouldShowWelcome(typeof localStorage === "undefined" ? undefined : localStorage));
  const closeWelcome = () => {
    markWelcomeSeen(typeof localStorage === "undefined" ? undefined : localStorage);
    setShowWelcome(false);
  };
  const isSpatialMode = useSpatialStore((s) => s.isSpatialMode);
  // Which views are on screen, for the activity bar highlight (the dock announces changes).
  const [shownViews, setShownViews] = useState<string[]>([]);
  useEffect(() => {
    const on = () => setShownViews(visibleViewIds());
    window.addEventListener("fahh-dock-active", on);
    return () => window.removeEventListener("fahh-dock-active", on);
  }, []);
  /** Open one of the old sidebar / bottom tabs (a no-op in canvas mode, which has no dock, as before). */
  const show = (tab: SidebarTab | BottomTab) => revealView(viewFor(tab));

  const { activeTheme, setTheme } = useThemeStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const layoutMode = useLayoutModeStore((s) => s.mode);
  // Ctrl+Shift+A: search Fahh Local sessions (both modes); picking one opens it.
  const [sessionSearch, setSessionSearch] = useState<AgentSessionInfo[] | null>(null);
  const openSessionSearch = () => {
    setPaletteOpen(false);
    void listSessions().then(setSessionSearch);
  };
  useEffect(() => onSessionSearch(openSessionSearch), []);
  // The Explorer follows changes made in the terminal, by the agent or by other programs.
  useEffect(() => initFsWatch(), []);
  const sessionCommands = useMemo<PaletteCommand[]>(
    () =>
      (sessionSearch ?? []).map((s) => ({
        id: `session.${s.id}`,
        group: ago(s.updated),
        label: s.title || "Untitled",
        run: () => {
          void useAgentStore.getState().loadSession(s.id);
          if (useLayoutModeStore.getState().mode === "editor") revealView("agent");
        },
      })),
    [sessionSearch]
  );
  const [quickOpen, setQuickOpen] = useState(false);
  const cursorPosition = useEditorStore((s) => s.cursorPosition);
  const activeTab = useEditorStore((s) => s.activeTab);
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
        openWorkspace: (p) => readFile(p).then((text) => applyWorkspaceConfig(text, openFolder, openFileInEditor, p)),
      });
    let off: (() => void) | undefined;
    let gone = false;
    // Session restore: nothing asked for on the command line, so reopen the last folder (or workspace).
    const restoreLast = () => {
      if (!useSettingsStore.getState().restoreSession || useFileStore.getState().root) return;
      // "Reset session and reload" (ErrorBoundary): skip one restore so a crash can't loop.
      try {
        if (localStorage.getItem("fahh-skip-restore")) return void localStorage.removeItem("fahh-skip-restore");
      } catch {}
      const last = loadRecent()[0];
      if (last) void openRecentEntry(last, openFolder, openFileInEditor);
    };
    takePendingOpen()
      .then((req) => (req ? run(req) : restoreLast()))
      .catch(restoreLast);
    import("@tauri-apps/api/webviewWindow")
      .then(({ getCurrentWebviewWindow }) =>
        getCurrentWebviewWindow().listen<OpenRequest>("fahh://open", (e) => void run(e.payload))
      )
      .then((fn) => (gone ? fn() : (off = fn)))
      .catch(() => {});
    return () => {
      gone = true;
      off?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global open folder & open file listeners — works in both docked mode and spatial canvas mode
  useEffect(() => {
    const handleOpenFolder = async () => {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ directory: true, multiple: false });
        if (typeof selected === "string") {
          await openFolder(selected);
        }
      } catch (err) {
        useToastStore.getState().show(`Could not open the folder: ${String(err)}`, "error");
      }
    };
    const handleOpenFile = async () => {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ directory: false, multiple: false });
        if (typeof selected === "string") {
          await openFileInEditor(selected);
        }
      } catch (err) {
        useToastStore.getState().show(`Could not open the file: ${String(err)}`, "error");
      }
    };
    window.addEventListener(OPEN_FOLDER_EVENT, handleOpenFolder);
    window.addEventListener(OPEN_FILE_EVENT, handleOpenFile);
    return () => {
      window.removeEventListener(OPEN_FOLDER_EVENT, handleOpenFolder);
      window.removeEventListener(OPEN_FILE_EVENT, handleOpenFile);
    };
  }, [openFolder, openFileInEditor]);

  // Apply theme CSS vars on mount and whenever the active theme changes
  const installedThemes = useExtensionThemes((s) => s.themes);
  useEffect(() => {
    const def = allThemes(installedThemes).find((d) => d.id === activeTheme);
    if (def) applyThemeCssVars(def);
  }, [activeTheme, installedThemes]);

  // Fahh SFX. Errors from the backend (builds, language servers) go through
  // the HUD store, which owns the cooldown, the combo and the mute.
  useEffect(() => {
    initFahhSfx(() => useFahhStore.getState().external());
    return () => teardownFahhSfx();
  }, []);

  // A quiet update check at launch: once a day, a toast once per new version (Settings > Updates).
  useEffect(() => {
    let store: Storage | undefined;
    try {
      store = localStorage;
    } catch {
      return;
    }
    void launchUpdateCheck(useSettingsStore.getState().checkUpdatesOnLaunch, store, __APP_VERSION__).then((msg) => {
      if (msg) useToastStore.getState().show(msg);
    });
  }, []);

  // Fahh Local: keep hearing the agent while its panel is hidden.
  useEffect(() => initAgentEvents(), []);

  // Ctrl+Tab order and back / forward history follow the active tab.
  useEffect(() => initNavigation(), []);

  // The palette lists recent folders too: rebuild the commands when that list changes.
  const [recentTick, setRecentTick] = useState(0);
  useEffect(() => {
    const on = () => setRecentTick((n) => n + 1);
    window.addEventListener("fahh-recent-change", on);
    return () => window.removeEventListener("fahh-recent-change", on);
  }, []);

  // Everything the palette (and the welcome screen) can do.
  const commands = useMemo<PaletteCommand[]>(() => {
    const view = (tab: SidebarTab | BottomTab) => () => revealView(viewFor(tab));
    const bottom = view;
    const intensity = (i: Intensity) => () => useFahhStore.getState().setIntensity(i);
    return [
      {
        id: "file.new",
        group: "File",
        label: "New Untitled File",
        keys: ["Ctrl", "N"],
        keywords: "new file scratch buffer draft",
        run: () => {
          const id = Date.now().toString(36).slice(-4);
          useEditorStore.getState().openFile(
            { path: `untitled-${id}.ts`, language: "typescript", dirty: true },
            "// Untitled Document\n"
          );
        },
      },
      { id: "window.new", group: "File", label: "New Window", keys: ["Ctrl", "Shift", "N"], keywords: "new window multi instance process", run: () => void openNewWindow() },
      { id: "file.open", group: "File", label: "Open File…", keys: ["Ctrl", "O"], keywords: "open file picker document", run: () => {
        window.dispatchEvent(new Event(OPEN_FILE_EVENT));
      } },
      { id: "folder.open", group: "File", label: "Open Folder…", keys: ["Ctrl", "K", "Ctrl", "O"], keywords: "workspace project directory", run: () => {
        revealView("explorer");
        window.setTimeout(() => window.dispatchEvent(new Event(OPEN_FOLDER_EVENT)), 0);
      } },
      { id: "workspace.open", group: "File", label: "Open Workspace from File…", keywords: "workspace config file open fahh-workspace json", run: () => void openWorkspaceFromFile(openFolder, openFileInEditor) },
      { id: "workspace.saveAs", group: "File", label: "Save Workspace As…", keywords: "save workspace config export fahh-workspace json", run: () => void saveWorkspaceAs() },
      { id: "file.toggleAutoSave", group: "File", label: "Toggle Auto Save", keywords: "auto save toggle automatic background disk write", run: () => useEditorStore.getState().toggleAutoSave() },
      { id: "file.save", group: "File", label: "Save File", keys: ["Ctrl", "S"], keywords: "save write disk", run: () => void saveActive() },
      { id: "file.saveAll", group: "File", label: "Save All Files", keys: ["Ctrl", "K", "S"], keywords: "save all write dirty", run: () => void saveActive() },
      { id: "file.copyPath", group: "File", label: "Copy Active File Path", keywords: "copy full absolute path clipboard", run: () => {
        const tab = useEditorStore.getState().activeTab;
        if (tab) navigator.clipboard.writeText(tab);
      } },
      { id: "file.copyRelativePath", group: "File", label: "Copy Relative File Path", keywords: "copy relative path clipboard", run: () => {
        const tab = useEditorStore.getState().activeTab;
        const rootPath = useFileStore.getState().root;
        if (tab && rootPath) {
          navigator.clipboard.writeText(tab.replace(rootPath, "").replace(/^[\\/]/, ""));
        } else if (tab) {
          navigator.clipboard.writeText(tab);
        }
      } },
      { id: "file.closeTab", group: "File", label: "Close Active Tab", keys: ["Ctrl", "W"], keywords: "close tab window", run: () => void closeActiveEditor() },
      { id: "file.closeAll", group: "File", label: "Close All Tabs", keys: ["Ctrl", "K", "Ctrl", "W"], keywords: "close every tab editors", run: () => void closeAllEditors() },
      { id: "file.reopenClosed", group: "File", label: "Reopen Closed Tab", keys: ["Ctrl", "Shift", "T"], keywords: "undo close restore tab", run: () => void reopenClosedTab() },
      ...loadRecent().map((r, i) => ({
        id: `file.recent.${i}`,
        group: "File",
        label: `Open Recent: ${r.path.split(/[\\/]/).filter(Boolean).pop() ?? r.path}`,
        keywords: `recent ${r.kind} ${r.path}`,
        run: () => void openRecentEntry(r, openFolder, openFileInEditor),
      })),
      { id: "view.settings", group: "View", label: "Settings", keys: ["Ctrl", ","], keywords: "preferences options font size minimap wrap volume tab spaces line numbers terminal restore session", run: () => revealView("settings") },
      { id: "go.back", group: "Go", label: "Go Back", keys: ["Alt", "←"], keywords: "navigate history previous location", run: () => void goBack() },
      { id: "go.forward", group: "Go", label: "Go Forward", keys: ["Alt", "→"], keywords: "navigate history next location", run: () => void goForward() },
      { id: "help.about", group: "Help", label: "About Fahh Editor", keywords: "version update check release", run: () => setShowAbout(true) },
      { id: "edit.replace", group: "Edit", label: "Replace in File", keys: ["Ctrl", "H"], keywords: "substitute regex", run: () => runEditorAction("editor.action.startFindReplaceAction") },
      { id: "edit.commentLine", group: "Edit", label: "Toggle Line Comment", keys: ["Ctrl", "/"], keywords: "comment line", run: () => runEditorAction("editor.action.commentLine") },
      { id: "edit.commentBlock", group: "Edit", label: "Toggle Block Comment", keys: ["Shift", "Alt", "A"], keywords: "comment block", run: () => runEditorAction("editor.action.blockComment") },
      { id: "edit.format", group: "Edit", label: "Format Document", keys: ["Shift", "Alt", "F"], keywords: "prettier formatting indent lsp", run: () => runEditorAction("editor.action.formatDocument") },
      { id: "view.spatial", group: "View", label: "Spatial Canvas Mode (CATE Infinite Canvas)", keys: ["Ctrl", "Shift", "C"], keywords: "cate canvas spatial zoom infinite figma floating windows", run: () => useSpatialStore.getState().toggleSpatialMode() },
      { id: "view.explorer", group: "View", label: "Explorer", keys: ["Ctrl", "Shift", "E"], keywords: "files tree", run: view("files") },
      { id: "view.search", group: "View", label: "Search across Files", keys: ["Ctrl", "Shift", "F"], keywords: "search find in files grep replace workspace", run: view("search") },
      { id: "edit.findInFiles", group: "Edit", label: "Find in Files", keys: ["Ctrl", "Shift", "F"], keywords: "search find grep files workspace", run: view("search") },
      { id: "edit.replaceInFiles", group: "Edit", label: "Replace in Files", keys: ["Ctrl", "Shift", "H"], keywords: "replace substitute global workspace", run: view("search") },
      { id: "view.git", group: "View", label: "Source Control", keys: ["Ctrl", "Shift", "G"], keywords: "git branch commit diff", run: view("git") },
      { id: "view.debug", group: "View", label: "Debug", run: bottom("debug") },
      { id: "view.ai", group: "View", label: "Fahh Local (AI agent)", keys: ["Ctrl", "L"], keywords: "agent chat llm ollama groq devin cursor", run: view("ai") },
      // Layout: the keyboard path for everything drag and drop does.
      { id: "layout.reset", group: "View", label: "Reset Layout", keywords: "default workbench panels sidebar restore dock", run: resetLayout },
      { id: "view.sidebar", group: "View", label: "Toggle Primary Side Bar", keys: ["Ctrl", "B"], keywords: "explorer left hide show", run: () => toggleZone("primary") },
      { id: "view.secondary", group: "View", label: "Toggle Secondary Side Bar", keys: ["Ctrl", "Alt", "B"], keywords: "agent right hide show", run: () => toggleZone("secondary") },
      { id: "panel.maximize", group: "View", label: "Toggle Maximized Panel", keywords: "terminal bottom fullscreen", run: toggleMaximizePanel },
      { id: "editor.split", group: "View", label: "Split Editor Right", keys: ["Ctrl", "\\"], keywords: "group side by side", run: () => splitActiveEditor("right") },
      { id: "editor.splitDown", group: "View", label: "Split Editor Down", keywords: "group below", run: () => splitActiveEditor("below") },
      ...listViews().flatMap((v) =>
        MOVE_TARGETS.map(([zone, where]) => ({
          id: `layout.move.${v.id}.${zone}`,
          group: "View",
          label: `Move ${v.title} to ${where}`,
          keywords: `dock drag ${v.id} ${v.keywords ?? ""}`,
          run: () => moveView(v.id, zone),
        }))
      ),
      { id: "view.extensions", group: "View", label: "Extensions (Marketplace)", keys: ["Ctrl", "Shift", "X"], keywords: "plugins language packs marketplace open vsx", run: view("extensions") },
      { id: "view.theme", group: "View", label: "Colour Theme", keywords: "color appearance", run: view("theme") },
      { id: "view.wordwrap", group: "View", label: "Toggle Word Wrap", keys: ["Alt", "Z"], keywords: "wrap lines soft", run: () => runEditorAction("editor.action.toggleWordWrap") },
      { id: "panel.toggle", group: "View", label: "Toggle Panel", keys: ["Ctrl", "`"], keywords: "terminal bottom", run: () => toggleZone("panel") },
      { id: "panel.problems", group: "View", label: "Problems", keywords: "errors diagnostics warnings lsp", run: bottom("problems") },
      { id: "panel.debug", group: "View", label: "Debug Console", keywords: "eval debugger console", run: bottom("debug") },
      { id: "panel.terminal", group: "View", label: "Terminal", keywords: "shell console powershell bash", run: bottom("terminal") },
      { id: "panel.run", group: "Run", label: "Run Panel", keywords: "execute active file runner", run: bottom("run") },
      { id: "run.active", group: "Run", label: "Run Without Debugging", keys: ["Ctrl", "F5"], keywords: "execute active file script python node rust", run: runWithoutDebugging },
      { id: "debug.start", group: "Run", label: "Start Debugging / Continue", keys: ["F5"], keywords: "debugger debugpy delve lldb launch", run: () => runDebugAction("startOrContinue") },
      { id: "debug.stop", group: "Run", label: "Stop Debugging", keys: ["Shift", "F5"], keywords: "debugger end terminate", run: () => runDebugAction("stop") },
      { id: "debug.restart", group: "Run", label: "Restart Debugging", keys: ["Ctrl", "Shift", "F5"], keywords: "debugger", run: () => runDebugAction("restart") },
      { id: "debug.stepOver", group: "Run", label: "Step Over", keys: ["F10"], keywords: "debugger next", run: () => runDebugAction("stepOver") },
      { id: "debug.stepInto", group: "Run", label: "Step Into", keys: ["F11"], keywords: "debugger", run: () => runDebugAction("stepInto") },
      { id: "debug.stepOut", group: "Run", label: "Step Out", keys: ["Shift", "F11"], keywords: "debugger", run: () => runDebugAction("stepOut") },
      { id: "debug.toggleBreakpoint", group: "Run", label: "Toggle Breakpoint", keys: ["F9"], keywords: "debugger", run: () => runDebugAction("toggleBreakpoint") },
      { id: "debug.removeAllBreakpoints", group: "Run", label: "Remove All Breakpoints", keywords: "debugger clear", run: () => useDebugStore.getState().clearBreakpoints() },
      { id: "debug.launchJson", group: "Run", label: "Open launch.json (create if missing)", keywords: "debug configuration launch config", run: () => void createLaunchJson() },
      { id: "view.agentMode", group: "View", label: "Switch to Agent Mode", keywords: "chat sessions fahh local ai", run: () => useLayoutModeStore.getState().setMode("agent") },
      { id: "view.editorMode", group: "View", label: "Switch to Editor Mode", keywords: "workbench code files", run: () => useLayoutModeStore.getState().setMode("editor") },
      { id: "agent.searchSessions", group: "Fahh Local", label: "Search Sessions", keys: ["Ctrl", "Shift", "A"], keywords: "history chats agent", run: openSessionSearch },
      { id: "view.deepwiki", group: "View", label: "DeepWiki", keywords: "symbol wiki docs definition usages", run: () => revealView("deepwiki") },
      { id: "deepwiki.seeWiki", group: "DeepWiki", label: "See Wiki for Symbol at Cursor", keywords: "explain definition usages references docs", run: () => runEditorAction("fahh.seeWiki") },
      { id: "view.remote", group: "View", label: "Remote Explorer", keywords: "wsl ssh docker containers", run: () => revealView("remote") },
      { id: "view.runDebug", group: "View", label: "Run and Debug", keys: ["Ctrl", "Shift", "D"], keywords: "debugger breakpoints", run: () => revealView("runDebug") },
      { id: "problem.next", group: "Go", label: "Next Problem", keys: ["F8"], keywords: "error warning", run: () => { runEditorAction("editor.action.marker.next"); } },
      { id: "problem.prev", group: "Go", label: "Previous Problem", keys: ["Shift", "F8"], keywords: "error warning", run: () => { runEditorAction("editor.action.marker.prev"); } },
      ...allThemes(installedThemes).map((d) => ({ id: `theme.${d.id}`, group: "Theme", label: d.name, keywords: d.description, run: () => setTheme(d.id) })),
      { id: "preview.toggle", group: "Preview", label: "Toggle Preview (PDF, Markdown, HTML, SVG, CSV)", keys: ["Ctrl", "Shift", "V"], keywords: "markdown html image csv pdf document preview source", run: () => {
        const path = useEditorStore.getState().activeTab;
        if (path && previewKindFor(path)) usePreviewStore.getState().toggleInPlace(path);
      } },
      { id: "preview.side", group: "Preview", label: "Open Preview to the Side", keys: ["Ctrl", "K", "V"], keywords: "markdown html image csv pdf split", run: () => {
        const path = useEditorStore.getState().activeTab;
        if (path && previewKindFor(path)) usePreviewStore.getState().toggleSide(path);
      } },
      { id: "browser.open", group: "Browser", label: "Open Dev Browser…", keywords: "localhost web page dev server url preview site", run: async () => {
        const suggested = usePreviewStore.getState().localUrl ?? "http://localhost:5173";
        const typed = await promptDialog({ title: "Open Dev Browser", message: "A port like 5173, or a URL:", value: suggested, ok: "Open" });
        if (typed) openBrowser(typed);
      } },
      { id: "terminal.agy", group: "Terminal", label: "Launch Antigravity CLI (agy)", keywords: "agy antigravity terminal agent console interactive gemini cli", run: () => launchAgyTerminal().catch((e) => alertDialog({ title: "Could not launch agy", message: String(e) })) },
      { id: "fahh.ring", group: "Fahh", label: "Ring the Bell", keywords: "test sound play", run: () => useFahhStore.getState().ringBell() },
      { id: "fahh.epic", group: "Fahh", label: "Effects: Epic", keywords: "shake intensity power mode", run: intensity("epic") },
      { id: "fahh.subtle", group: "Fahh", label: "Effects: Subtle", keywords: "intensity quiet", run: intensity("subtle") },
      { id: "fahh.off", group: "Fahh", label: "Effects: Off", keywords: "intensity silent disable", run: intensity("off") },
      { id: "fahh.mute", group: "Fahh", label: "Mute / Unmute Sound", keywords: "volume silence", run: () => useFahhStore.getState().toggleMute() },
      { id: "help.welcome", group: "Help", label: "Show Welcome", keywords: "onboarding tour getting started intro first run", run: () => setShowWelcome(true) },
      { id: "help.checkSetup", group: "Fahh", label: "Check Setup", keywords: "doctor tools installed versions git python node cargo wsl language server lsp missing", run: () => setShowSetup(true) },
      { id: "cli.install", group: "Tools", label: "Install 'fahh' Command in PATH", keywords: "shell terminal code command line cli", run: () => {
        installCli().then((m) => useToastStore.getState().show(m)).catch((e) => useToastStore.getState().show(String(e), "error"));
      } },
      { id: "tools.optional", group: "Tools", label: "Optional Tools…", keywords: "installer n8n flowise setup", run: () => setShowInstaller(true) },
      { id: "file.quickOpen", group: "Go", label: "Go to File…", keys: ["Ctrl", "P"], keywords: "quick open find file", run: () => setQuickOpen(true) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setTheme, recentTick, installedThemes]);

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

  // Ctrl+Shift+P and F1 open the palette; Ctrl+P, Ctrl+L, Ctrl+W, Ctrl+N. Captured before
  // Monaco sees them, so its own bindings (F1 palette) do not fire underneath ours.
  useEffect(() => {
    // Ctrl+K starts a chord (Ctrl+K Ctrl+W: close all tabs). Any other key ends it.
    let chordAt = 0;
    const MODIFIERS = ["Control", "Meta", "Shift", "Alt"];
    const onKey = (e: KeyboardEvent) => {
      const debugAction = debugKeyAction(e, useDebugStore.getState().isDebugging);
      if (debugAction) {
        e.preventDefault();
        e.stopPropagation();
        runDebugAction(debugAction);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === "F5") {
        e.preventDefault();
        e.stopPropagation();
        runWithoutDebugging();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const inEditor = !!(e.target as Element | null)?.closest?.(".monaco-editor");
      const chord = chordAt > 0 && Date.now() - chordAt < 2000;
      if (!MODIFIERS.includes(e.key)) chordAt = 0;
      if (mod && !e.shiftKey && !e.altKey && k === "k") {
        chordAt = Date.now(); // not swallowed: Monaco has Ctrl+K chords of its own
        return;
      }
      const combo = mod && e.shiftKey && k === "p";
      if (chord && mod && !e.shiftKey && !e.altKey && k === "w") {
        // In the editor Monaco finishes the chord (its own binding runs file.closeAll); elsewhere we do.
        if (inEditor) return;
        e.preventDefault();
        e.stopPropagation();
        void closeAllEditors();
      } else if (e.ctrlKey && !e.altKey && e.key === "Tab") {
        // Ctrl+Tab / Ctrl+Shift+Tab: most recently used tabs, while Ctrl is held.
        e.preventDefault();
        e.stopPropagation();
        cycleTabs(e.shiftKey);
      } else if (mod && e.shiftKey && !e.altKey && k === "t") {
        e.preventDefault();
        e.stopPropagation();
        void reopenClosedTab();
      } else if (e.altKey && !mod && !e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        e.stopPropagation();
        void (e.key === "ArrowLeft" ? goBack() : goForward());
      } else if (mod && !e.shiftKey && !e.altKey && e.key === ",") {
        e.preventDefault();
        e.stopPropagation();
        revealView("settings");
      } else if (combo || e.key === "F1") {
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
      } else if (isSessionSearch(e)) {
        e.preventDefault();
        e.stopPropagation();
        openSessionSearch();
      } else if (isAgentToggle(e, e.target as Element | null)) {
        // Ctrl+L (not inside the editor or terminal, where it means select-line / clear): toggle Fahh Local
        e.preventDefault();
        e.stopPropagation();
        if (useLayoutModeStore.getState().mode === "agent") return;
        toggleView("agent");
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "w") {
        // Ctrl+W: close the active tab, asking first when it is unsaved.
        e.preventDefault();
        e.stopPropagation();
        void closeActiveEditor();
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
        // Ctrl+N: new untitled file.
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent(FAHH_COMMAND, { detail: "file.new" }));
      }
    };
    // Letting go of Ctrl ends a Ctrl+Tab walk (the tab you landed on becomes the most recent).
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") endCycle();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", endCycle);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", endCycle);
    };
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
        // Tauri waits for this handler before it closes the window, so the dialog can be awaited.
        getCurrentWindow().onCloseRequested(async (e) => {
          const msg = unsavedMessage();
          if (msg && !(await confirmDialog({ title: "Close Fahh Editor?", message: msg, ok: "Close and discard", danger: true }))) e.preventDefault();
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
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        useSpatialStore.getState().toggleSpatialMode();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        void openNewWindow();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "f" || e.key === "F" || e.key === "h" || e.key === "H")) {
        e.preventDefault();
        revealView("search");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-fahh-bg text-fahh-text select-none">
      {/* ── Native Menu Bar ── */}
      <MenuBar
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenQuickOpen={() => setQuickOpen(true)}
        onToggleSidebar={() => toggleZone("primary")}
        onToggleBottomPanel={() => toggleZone("panel")}
        onSetSidebarTab={show}
        onSetBottomTab={show}
        onSaveActive={() => void saveActive()}
        onShowWelcome={() => setShowWelcome(true)}
        onShowSetup={() => setShowSetup(true)}
        onShowInstaller={() => setShowInstaller(true)}
        onShowAbout={() => setShowAbout(true)}
      />

      {/* ── Spatial Canvas Mode (CATE) vs Docked Workspace Area ── */}
      {isSpatialMode ? (
        <div className="flex-1 min-h-0 relative overflow-hidden">
          <LspBridge />
          <SpatialCanvas />
        </div>
      ) : (
        <>
        {layoutMode === "agent" && <AgentMode />}
        {/* ── Workspace Area (Activity bar + the dock); kept mounted, hidden, in agent mode ── */}
        <div className="flex flex-1 min-h-0 overflow-hidden" style={layoutMode === "agent" ? { display: "none" } : undefined}>
          {/* Non-rendering LSP bridge */}
          <LspBridge />

          {/* ── Activity bar: shows a view, or hides its bar when it is already on screen ── */}
          <div className="w-10 shrink-0 flex flex-col items-center gap-1 pt-2 bg-fahh-sidebar border-r border-fahh-surface">
            {ACTIVITY.map((id) => <ViewBtn key={id} id={id} active={shownViews.includes(id)} />)}
            <div className="flex-1" />
            <ViewBtn id="theme" active={shownViews.includes("theme")} />

            {/* Settings (Optional Tools stay in Help and the palette) */}
            <button
              onClick={() => toggleView("settings")}
              title="Settings (Ctrl+,)"
              aria-label="Settings"
              className="w-8 h-8 mb-2 flex items-center justify-center rounded text-sm text-fahh-muted hover:text-fahh-text transition-colors"
            >
              <Settings size={18} />
            </button>
          </div>

      {/* ── Main area: the dock (editors, side bars, panel), then the status bar ── */}
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

          {/* Cursor position and Go To Line */}
          {activeTab && (
            <button
              type="button"
              onClick={() => runEditorAction("editor.action.gotoLine")}
              title="Go to Line/Column (Ctrl+G)"
              className="hover:text-fahh-text transition-colors font-mono text-[11px] flex items-center gap-1"
            >
              <span>Ln {cursorPosition.line}, Col {cursorPosition.column}</span>
              {cursorPosition.totalLines && (
                <span className="text-fahh-muted/50">({cursorPosition.totalLines} lines)</span>
              )}
            </button>
          )}

          <span className="max-[850px]:hidden text-fahh-muted/60 font-mono text-[11px]">UTF-8</span>

          <LspStatusItem />
          <HudControls />

          {/* Active theme indicator */}
          <span className="text-fahh-muted capitalize max-[860px]:hidden">
            {activeTheme.replace(/-/g, " ")}
          </span>

          <span className="max-[680px]:hidden font-mono">v{__APP_VERSION__}</span>
        </div>
      </div>
      </div>
        </>
      )}

      {showInstaller && (
        <InstallerWizard onClose={() => setShowInstaller(false)} />
      )}

      {showWelcome && <Welcome onClose={closeWelcome} />}

      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {showSetup && <CheckSetupDialog onClose={() => setShowSetup(false)} />}
      <DialogHost />
      <Toasts />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      <CommandPalette
        open={sessionSearch !== null}
        onClose={() => setSessionSearch(null)}
        commands={sessionCommands}
        label="Search sessions"
        placeholder="Search Fahh Local sessions"
        recentKey="fahh-session-search-recent"
        emptyText="No saved sessions in this folder yet."
      />
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

/** The activity bar, top to bottom (Colour Theme sits at the foot). */
const ACTIVITY = ["explorer", "search", "git", "deepwiki", "runDebug", "remote", "agent", "extensions"];

function ViewBtn({ id, active }: { id: string; active: boolean }) {
  const v = getView(id);
  if (!v) return null;
  return (
    <ActivityBtn active={active} title={v.keys ? `${v.title} (${v.keys})` : v.title} onClick={() => toggleView(id)}>
      <span className="relative">
        <v.icon size={18} />
        {id === "agent" && <AgentStatusDot />}
      </span>
    </ActivityBtn>
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
