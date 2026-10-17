/**
 * Every dockable view, in one place. To add a panel, add one registerView call
 * (or call it from your own module and import that module from here):
 *
 *   registerView({ id: "agent", title: "Agent", icon: Bot, component: AgentPanel, defaultLocation: "secondary" });
 *
 * It then gets an activity-bar button, a "View: Agent" palette command, and can be dragged
 * anywhere. Layout code never needs to know about it.
 */
import { Bug, Blocks, Bot, Eye, FolderTree, GitBranch, Palette, Play, SquareTerminal } from "lucide-react";
import { FileTree } from "../components/FileTree/FileTree";
import { GitSidebar } from "../components/GitSidebar";
import { AIPanel } from "../components/AIPanel";
import { ThemePanel } from "../components/ThemePanel";
import { ExtensionsPanel } from "../components/ExtensionsPanel";
import { DebugPanel } from "../components/DebugPanel";
import { RunPanel } from "../components/RunPanel";
import { TerminalPanel } from "../components/Terminal/TerminalPanel";
import { PreviewView } from "../components/Preview/PreviewView";
import { registerView } from "../lib/viewRegistry";

const Scroll = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-full flex-col overflow-y-auto bg-fahh-sidebar">{children}</div>
);

registerView({ id: "explorer", title: "Explorer", icon: FolderTree, component: FileTree, defaultLocation: "sidebar" });
registerView({ id: "git", title: "Source Control", icon: GitBranch, component: GitSidebar, defaultLocation: "sidebar" });
registerView({ id: "ai", title: "AI Assistant", icon: Bot, component: AIPanel, defaultLocation: "sidebar" });
registerView({
  id: "extensions",
  title: "Extensions",
  icon: Blocks,
  component: () => (
    <Scroll>
      <ExtensionsPanel />
    </Scroll>
  ),
  defaultLocation: "sidebar",
});
registerView({
  id: "theme",
  title: "Colour Theme",
  icon: Palette,
  component: () => (
    <Scroll>
      <ThemePanel />
    </Scroll>
  ),
  defaultLocation: "sidebar",
});
registerView({ id: "terminal", title: "Terminal", icon: SquareTerminal, component: TerminalPanel, defaultLocation: "panel", activityBar: false });
registerView({ id: "run", title: "Run", icon: Play, component: RunPanel, defaultLocation: "panel", activityBar: false });
registerView({ id: "debug", title: "Debug", icon: Bug, component: DebugPanel, defaultLocation: "panel" });
registerView({ id: "preview", title: "Preview", icon: Eye, component: PreviewView, defaultLocation: "secondary", defaultOpen: false });
