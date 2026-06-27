import { useEffect, useState } from "react";
import { FileTree } from "./components/FileTree/FileTree";
import { TabBar } from "./components/Editor/TabBar";
import { EditorPane } from "./components/Editor/EditorPane";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import { AIPanel } from "./components/AIPanel";
import { InstallerWizard } from "./components/InstallerWizard";
import { RunPanel } from "./components/RunPanel";
import { DebugPanel } from "./components/DebugPanel";
import { ThemePanel } from "./components/ThemePanel";
import { ExtensionsPanel } from "./components/ExtensionsPanel";
import { LspBridge } from "./components/LspBridge";
import { initFahhSfx, teardownFahhSfx } from "./lib/fahh";
import { useThemeStore } from "./store/themeStore";
import { THEME_DEFINITIONS, applyThemeCssVars } from "./components/ThemePanel";

// ─── Types ────────────────────────────────────────────────────────────────────

type SidebarTab = "files" | "git" | "ai" | "extensions" | "debug";
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

  const { activeTheme } = useThemeStore();

  // Apply theme CSS vars on mount and whenever the active theme changes
  useEffect(() => {
    const def = THEME_DEFINITIONS.find((d) => d.id === activeTheme);
    if (def) applyThemeCssVars(def);
  }, [activeTheme]);

  // Fahh SFX
  useEffect(() => {
    initFahhSfx();
    return () => teardownFahhSfx();
  }, []);

  // Derive Monaco theme from the active Fahh theme
  const monacoTheme =
    THEME_DEFINITIONS.find((d) => d.id === activeTheme)?.monacoTheme ??
    "vs-dark";

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
          📁
        </ActivityBtn>

        <ActivityBtn
          active={sidebarTab === "git"}
          title="Source Control"
          onClick={() => setSidebarTab("git")}
        >
          ⑂
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
          🐛
        </ActivityBtn>

        <ActivityBtn
          active={sidebarTab === "ai"}
          title="AI Assistant"
          onClick={() => setSidebarTab("ai")}
        >
          🤖
        </ActivityBtn>

        <ActivityBtn
          active={sidebarTab === "extensions"}
          title="Extensions"
          onClick={() => setSidebarTab("extensions")}
        >
          🔌
        </ActivityBtn>

        <div className="flex-1" />

        {/* Theme picker */}
        <ActivityBtn
          active={sidebarTab === ("theme" as SidebarTab)}
          title="Colour Theme"
          onClick={() => setSidebarTab("extensions")}
        >
          🎨
        </ActivityBtn>

        {/* Optional tools wizard */}
        <button
          onClick={() => setShowInstaller(true)}
          title="Optional Tools"
          className="w-8 h-8 mb-2 flex items-center justify-center rounded text-sm text-fahh-muted hover:text-fahh-text transition-colors"
        >
          ⚙
        </button>
      </div>

      {/* ── Sidebar panel ── */}
      <div className="w-60 shrink-0 flex flex-col border-r border-fahh-surface overflow-hidden">
        {sidebarTab === "files" && <FileTree />}

        {sidebarTab === "git" && (
          <div className="p-3 text-xs text-fahh-muted">
            Git sidebar — Phase 2
          </div>
        )}

        {sidebarTab === "debug" && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-fahh-muted font-semibold border-b border-fahh-surface bg-fahh-sidebar shrink-0">
              Debug
            </div>
            <DebugPanel />
          </div>
        )}

        {sidebarTab === "ai" && <AIPanel />}

        {sidebarTab === "extensions" && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-fahh-muted font-semibold border-b border-fahh-surface bg-fahh-sidebar shrink-0">
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
        {/* Editor region */}
        <div className="flex flex-col flex-1 min-h-0">
          <TabBar />
          <EditorPane monacoTheme={monacoTheme} />
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
                ✕
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
        <div className="h-6 shrink-0 bg-fahh-sidebar border-t border-fahh-surface flex items-center px-3 gap-4 text-xs text-fahh-muted">
          <span className="text-fahh-success">● Fahh Editor</span>

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
            className="hover:text-fahh-text transition-colors"
          >
            ▶ Run
          </button>

          <div className="flex-1" />

          {/* Active theme indicator */}
          <span className="text-fahh-muted capitalize">
            {activeTheme.replace(/-/g, " ")}
          </span>

          <span>v0.2.0</span>
        </div>
      </div>

      {showInstaller && (
        <InstallerWizard onClose={() => setShowInstaller(false)} />
      )}
    </div>
  );
}
