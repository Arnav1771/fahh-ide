/**
 * Every dockable view, in one place. To add a panel, add one registerView call:
 *
 *   registerView({ id: "agent", title: "Fahh Local", icon: Bot, component: AgentPanel, defaultLocation: "secondary" });
 *
 * It then gets an activity-bar button, "View: <title>" and "View: Move <title> to …" palette
 * commands, and can be dragged anywhere. Layout code never needs to know about it.
 * Ids are saved in layouts: never rename a shipped one.
 */
import { useMemo } from "react";
import { AlertCircle, Blocks, BookOpenText, Bot, Bug, BugPlay, FolderTree, MonitorCloud, GitBranch, Palette, Play, Search, Settings as SettingsIcon, SquareTerminal } from "lucide-react";
import { SettingsPanel } from "../components/SettingsPanel";
import { FileTree } from "../components/FileTree/FileTree";
import { SearchSidebar } from "../components/SearchSidebar/SearchSidebar";
import { GitSidebar } from "../components/GitSidebar";
import { AgentPanel } from "../components/AgentPanel";
import { ThemePanel } from "../components/ThemePanel";
import { ExtensionsPanel } from "../components/ExtensionsPanel";
import { DebugPanel } from "../components/DebugPanel";
import { RunDebugView } from "../components/DebugPanel/RunDebugView";
import { RemoteExplorer } from "../components/RemoteExplorer";
import { DeepWiki } from "../components/DeepWiki";
import { RunPanel } from "../components/RunPanel";
import { ProblemsPanel } from "../components/ProblemsPanel";
import { TerminalPanel } from "../components/Terminal/TerminalPanel";
import { useDiagnosticsStore } from "../store/diagnosticsStore";
import { registerView } from "../lib/viewRegistry";
import { toggleView } from "../lib/workbench";

function ProblemsBadge() {
  const diagnostics = useDiagnosticsStore((s) => s.diagnostics);
  const errors = useMemo(() => diagnostics.filter((d) => d.severity === "error").length, [diagnostics]);
  if (!diagnostics.length) return null;
  return (
    <span className={`ml-1.5 px-1.5 rounded-full text-[10px] ${errors > 0 ? "bg-red-500/20 text-red-400 font-bold" : "bg-yellow-500/20 text-yellow-400"}`}>
      {diagnostics.length}
    </span>
  );
}

registerView({ id: "explorer", title: "Explorer", icon: FolderTree, component: FileTree, defaultLocation: "sidebar", keys: "Ctrl+Shift+E", keywords: "files tree" });
registerView({ id: "search", title: "Search", icon: Search, component: () => <SearchSidebar />, defaultLocation: "sidebar", keys: "Ctrl+Shift+F", keywords: "find in files grep replace" });
registerView({ id: "git", title: "Source Control", icon: GitBranch, component: GitSidebar, defaultLocation: "sidebar", keys: "Ctrl+Shift+G", keywords: "git branch commit diff" });
registerView({ id: "deepwiki", title: "DeepWiki", icon: BookOpenText, component: DeepWiki, defaultLocation: "sidebar", keywords: "symbol wiki docs definition usages references explain" });
registerView({ id: "remote", title: "Remote Explorer", icon: MonitorCloud, component: RemoteExplorer, defaultLocation: "sidebar", keywords: "wsl ssh docker dev containers remote distro host" });
registerView({ id: "runDebug", title: "Run and Debug", icon: BugPlay, component: RunDebugView, defaultLocation: "sidebar", keys: "Ctrl+Shift+D", keywords: "debugger breakpoints launch.json step variables call stack debugpy delve lldb" });
registerView({
  id: "extensions",
  title: "Extensions",
  icon: Blocks,
  component: () => (
    <div className="flex-1 overflow-y-auto">
      <ThemePanel />
      <div className="border-t border-fahh-surface mt-1" />
      <ExtensionsPanel />
    </div>
  ),
  defaultLocation: "sidebar",
  keys: "Ctrl+Shift+X",
  keywords: "plugins language packs marketplace open vsx",
});
registerView({
  id: "theme",
  title: "Colour Theme",
  icon: Palette,
  component: () => (
    <div className="flex flex-col h-full overflow-y-auto">
      <ThemePanel />
    </div>
  ),
  defaultLocation: "sidebar",
  keywords: "color appearance",
});
// /exit in the panel hides the view, wherever it is docked (a stable handler: the panel stores it in an effect)
const hideAgent = () => toggleView("agent");
registerView({ id: "agent", title: "Fahh Local", icon: Bot, component: () => <AgentPanel onClose={hideAgent} />, defaultLocation: "secondary", keys: "Ctrl+L", keywords: "ai agent chat llm ollama groq" });
registerView({ id: "problems", title: "Problems", icon: AlertCircle, component: ProblemsPanel, defaultLocation: "panel", badge: ProblemsBadge, keywords: "errors diagnostics warnings lsp" });
registerView({ id: "debug", title: "Debug Console", icon: Bug, component: DebugPanel, defaultLocation: "panel", keywords: "debugger eval breakpoints" });
registerView({ id: "terminal", title: "Terminal", icon: SquareTerminal, component: TerminalPanel, defaultLocation: "panel", keywords: "shell console powershell bash" });
registerView({ id: "run", title: "Run", icon: Play, component: RunPanel, defaultLocation: "panel", keywords: "execute active file runner" });
registerView({ id: "settings", title: "Settings", icon: SettingsIcon, component: SettingsPanel, defaultLocation: "editor", keys: "Ctrl+,", keywords: "preferences options font size minimap wrap volume tab" });
