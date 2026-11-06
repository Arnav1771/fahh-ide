import { TerminalPanel } from "../../Terminal/TerminalPanel";

export function TerminalNodeView() {
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-fahh-bg">
      <TerminalPanel />
    </div>
  );
}
