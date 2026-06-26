export function AIPanel() {
  return (
    <div className="flex flex-col h-full bg-fahh-sidebar p-3">
      <div className="text-xs font-semibold text-fahh-muted uppercase tracking-wider mb-3">
        AI Assistant
      </div>
      <p className="text-xs text-fahh-muted">
        AI chat via MCP coming in Phase 2.
      </p>
      <p className="text-xs text-fahh-muted mt-1">
        Configure MCP servers in <code className="bg-fahh-surface px-1 rounded">~/.fahh/config.json</code>.
      </p>
    </div>
  );
}
