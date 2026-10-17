import { useState } from "react";
import { Globe, ExternalLink, Copy, Plus, Trash2 } from "lucide-react";
import { openBrowser } from "../../lib/browser";

interface PortItem {
  id: string;
  port: number;
  label: string;
  process: string;
  forwardedTo: string;
}

const DEFAULT_PORTS: PortItem[] = [
  {
    id: "port-8888",
    port: 8888,
    label: "Python HTTP Server",
    process: "python.exe (PID 14220)",
    forwardedTo: "http://localhost:8888",
  },
  {
    id: "port-1420",
    port: 1420,
    label: "Fahh Vite Frontend",
    process: "node.exe (PID 8392)",
    forwardedTo: "http://localhost:1420",
  },
  {
    id: "port-5173",
    port: 5173,
    label: "Vite Dev Server",
    process: "pnpm dev",
    forwardedTo: "http://localhost:5173",
  },
];

export function PortsPanel() {
  const [ports, setPorts] = useState<PortItem[]>(DEFAULT_PORTS);
  const [newPort, setNewPort] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseInt(newPort.trim(), 10);
    if (isNaN(p) || p <= 0 || p > 65535) return;
    const item: PortItem = {
      id: `port-${p}-${Date.now()}`,
      port: p,
      label: newLabel.trim() || `Local Port ${p}`,
      process: "Local Service",
      forwardedTo: `http://localhost:${p}`,
    };
    setPorts((prev) => [...prev, item]);
    setNewPort("");
    setNewLabel("");
    setShowAdd(false);
  };

  const removePort = (id: string) => {
    setPorts((prev) => prev.filter((p) => p.id !== id));
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
  };

  return (
    <div className="flex flex-col h-full bg-fahh-bg font-sans text-xs text-fahh-text overflow-hidden" data-testid="ports-panel">
      {/* Top Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-fahh-sidebar border-b border-fahh-surface shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-fahh-muted font-semibold">Active Ports</span>
          <span className="text-[10px] text-fahh-muted">({ports.length})</span>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-fahh-surface text-fahh-text hover:bg-fahh-accent/20 hover:text-fahh-accent transition-colors"
        >
          <Plus size={12} />
          <span>Forward a Port</span>
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="flex items-center gap-2 px-3 py-2 bg-fahh-surface/40 border-b border-fahh-surface">
          <input
            type="number"
            placeholder="Port (e.g. 8080)"
            value={newPort}
            onChange={(e) => setNewPort(e.target.value)}
            className="w-24 bg-fahh-bg border border-fahh-surface rounded px-2 py-0.5 text-xs text-fahh-text focus:outline-none focus:border-fahh-accent"
            autoFocus
          />
          <input
            type="text"
            placeholder="Label (e.g. API Server)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="flex-1 bg-fahh-bg border border-fahh-surface rounded px-2 py-0.5 text-xs text-fahh-text focus:outline-none focus:border-fahh-accent"
          />
          <button type="submit" className="px-2 py-0.5 rounded bg-fahh-accent text-white font-medium text-xs">
            Add
          </button>
          <button type="button" onClick={() => setShowAdd(false)} className="px-2 py-0.5 rounded bg-fahh-surface text-fahh-muted text-xs">
            Cancel
          </button>
        </form>
      )}

      {/* Ports Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-fahh-surface bg-fahh-sidebar/50 text-[10.5px] uppercase tracking-wider text-fahh-muted">
              <th className="px-3 py-1.5 font-medium">Port</th>
              <th className="px-3 py-1.5 font-medium">Label</th>
              <th className="px-3 py-1.5 font-medium">Process</th>
              <th className="px-3 py-1.5 font-medium">Forwarded Address</th>
              <th className="px-3 py-1.5 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-fahh-surface/30">
            {ports.map((item) => (
              <tr key={item.id} className="hover:bg-fahh-surface/40 transition-colors">
                <td className="px-3 py-2 font-mono text-fahh-accent font-semibold">
                  :{item.port}
                </td>
                <td className="px-3 py-2 font-medium text-fahh-text">
                  {item.label}
                </td>
                <td className="px-3 py-2 text-fahh-muted font-mono text-[11px]">
                  {item.process}
                </td>
                <td className="px-3 py-2 font-mono text-fahh-info">
                  <a
                    href={item.forwardedTo}
                    onClick={(e) => {
                      e.preventDefault();
                      openBrowser(item.forwardedTo);
                    }}
                    className="hover:underline flex items-center gap-1"
                  >
                    {item.forwardedTo} <ExternalLink size={10} />
                  </a>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => openBrowser(item.forwardedTo)}
                      title="Open in Built-in Browser"
                      className="p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface transition-colors"
                    >
                      <Globe size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => copyUrl(item.forwardedTo)}
                      title="Copy Address"
                      className="p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface transition-colors"
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removePort(item.id)}
                      title="Remove Port"
                      className="p-1 rounded text-fahh-muted hover:text-fahh-error hover:bg-fahh-surface transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
