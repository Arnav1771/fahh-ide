import { useEffect, useState } from "react";
import { FileTree } from "./components/FileTree/FileTree";
import { TabBar } from "./components/Editor/TabBar";
import { EditorPane } from "./components/Editor/EditorPane";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import { AIPanel } from "./components/AIPanel";
import { InstallerWizard } from "./components/InstallerWizard";
import { initFahhSfx, teardownFahhSfx } from "./lib/fahh";

type SidebarTab = "files" | "git" | "ai";

export default function App() {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("files");
  const [showInstaller, setShowInstaller] = useState(false);
  const [showTerminal, setShowTerminal] = useState(true);

  useEffect(() => {
    initFahhSfx();
    return () => teardownFahhSfx();
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-fahh-bg text-fahh-text">
      {/* Activity bar */}
      <div className="w-10 shrink-0 flex flex-col items-center gap-1 pt-2 bg-fahh-sidebar border-r border-fahh-surface">
        <button
          onClick={() => setSidebarTab("files")}
          title="Explorer"
          className={`w-8 h-8 flex items-center justify-center rounded text-sm transition-colors ${
            sidebarTab === "files" ? "bg-fahh-surface text-fahh-accent" : "text-fahh-muted hover:text-fahh-text"
          }`}
        >
          📁
        </button>
        <button
          onClick={() => setSidebarTab("git")}
          title="Source Control"
          className={`w-8 h-8 flex items-center justify-center rounded text-sm transition-colors ${
            sidebarTab === "git" ? "bg-fahh-surface text-fahh-accent" : "text-fahh-muted hover:text-fahh-text"
          }`}
        >
          ⑂
        </button>
        <button
          onClick={() => setSidebarTab("ai")}
          title="AI Assistant"
          className={`w-8 h-8 flex items-center justify-center rounded text-sm transition-colors ${
            sidebarTab === "ai" ? "bg-fahh-surface text-fahh-accent" : "text-fahh-muted hover:text-fahh-text"
          }`}
        >
          🤖
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setShowInstaller(true)}
          title="Optional Tools"
          className="w-8 h-8 mb-2 flex items-center justify-center rounded text-sm text-fahh-muted hover:text-fahh-text transition-colors"
        >
          ⚙
        </button>
      </div>

      {/* Sidebar panel */}
      <div className="w-60 shrink-0 flex flex-col border-r border-fahh-surface overflow-hidden">
        {sidebarTab === "files" && <FileTree />}
        {sidebarTab === "git" && (
          <div className="p-3 text-xs text-fahh-muted">
            Git sidebar — Phase 2
          </div>
        )}
        {sidebarTab === "ai" && <AIPanel />}
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Editor region */}
        <div className="flex flex-col flex-1 min-h-0">
          <TabBar />
          <EditorPane />
        </div>

        {/* Terminal panel */}
        {showTerminal && (
          <div className="h-48 shrink-0 border-t border-fahh-surface">
            <TerminalPanel />
          </div>
        )}

        {/* Status bar */}
        <div className="h-6 shrink-0 bg-fahh-sidebar border-t border-fahh-surface flex items-center px-3 gap-4 text-xs text-fahh-muted">
          <span className="text-fahh-success">● Fahh Editor</span>
          <button
            onClick={() => setShowTerminal((p) => !p)}
            className="hover:text-fahh-text transition-colors"
          >
            {showTerminal ? "Hide Terminal" : "Show Terminal"}
          </button>
          <div className="flex-1" />
          <span>v0.1.0</span>
        </div>
      </div>

      {showInstaller && (
        <InstallerWizard onClose={() => setShowInstaller(false)} />
      )}
    </div>
  );
}
