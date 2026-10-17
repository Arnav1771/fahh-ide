import { useState, useRef, useEffect } from "react";
import { Trash2, Copy } from "lucide-react";

interface LogEntry {
  timestamp: string;
  channel: string;
  text: string;
  type?: "info" | "warn" | "error";
}

const DEFAULT_LOGS: LogEntry[] = [
  {
    timestamp: "00:24:24",
    channel: "Tasks",
    text: "python -m http.server 8888 --directory C:\\Users\\arnav.STEALTH\\arcade running",
    type: "info",
  },
  {
    timestamp: "00:24:25",
    channel: "Tasks",
    text: "Serving HTTP on 0.0.0.0 port 8888 (http://0.0.0.0:8888/)...",
    type: "info",
  },
  {
    timestamp: "00:24:26",
    channel: "Fahh Core",
    text: "Fahh Editor v0.5.2 initialized. Audio cooldown engine armed (sfx_cooldown_secs: 5s).",
    type: "info",
  },
];

export function OutputPanel() {
  const [channel, setChannel] = useState("Tasks");
  const [logs, setLogs] = useState<LogEntry[]>(DEFAULT_LOGS);
  const bottomRef = useRef<HTMLDivElement>(null);

  const channels = ["Tasks", "Fahh Core", "Git", "Language Server", "Dev Server"];

  const filtered = logs.filter((l) => l.channel === channel);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, channel]);

  const clearChannel = () => {
    setLogs((prev) => prev.filter((l) => l.channel !== channel));
  };

  const copyChannel = () => {
    const text = filtered.map((l) => `[${l.timestamp}] ${l.text}`).join("\n");
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex flex-col h-full bg-fahh-bg font-mono text-xs text-fahh-text overflow-hidden" data-testid="output-panel">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-fahh-sidebar border-b border-fahh-surface shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-fahh-muted font-sans font-semibold">Channel</span>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="bg-fahh-bg border border-fahh-surface rounded px-2 py-0.5 text-xs text-fahh-accent focus:outline-none focus:border-fahh-accent font-sans"
          >
            {channels.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={copyChannel}
            title="Copy Output"
            className="p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface transition-colors"
          >
            <Copy size={13} />
          </button>
          <button
            type="button"
            onClick={clearChannel}
            title="Clear Output"
            className="p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Output Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1 select-text">
        {filtered.length === 0 ? (
          <div className="text-fahh-muted/70 py-4 italic">No output for channel &quot;{channel}&quot;.</div>
        ) : (
          filtered.map((item, idx) => (
            <div key={idx} className="flex items-start gap-2 leading-relaxed">
              <span className="text-fahh-muted/50 select-none text-[11px]">[{item.timestamp}]</span>
              <pre
                className={`whitespace-pre-wrap break-words flex-1 font-mono text-xs ${
                  item.type === "error"
                    ? "text-fahh-error"
                    : item.type === "warn"
                    ? "text-yellow-400"
                    : "text-fahh-text"
                }`}
              >
                {item.text}
              </pre>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
