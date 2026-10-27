import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useDebugStore } from "../../store/debugStore";
import { evaluate } from "../../lib/debugSession";

const COLOURS: Record<string, string> = {
  stderr: "text-fahh-error",
  input: "text-fahh-accent",
  console: "text-fahh-muted",
  important: "text-fahh-warn",
};

/** Debug Console: the program's output while debugging, and a REPL for the paused frame. */
export function DebugPanel() {
  const lines = useDebugStore((s) => s.console);
  const isDebugging = useDebugStore((s) => s.isDebugging);
  const isPaused = useDebugStore((s) => s.isPaused);
  const clear = useDebugStore((s) => s.clearConsole);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);

  const submit = () => {
    const expr = input.trim();
    if (!expr) return;
    setHistory((h) => [expr, ...h.filter((x) => x !== expr)].slice(0, 50));
    setCursor(-1);
    setInput("");
    void evaluate(expr);
  };

  return (
    <div className="fahh-debug-console flex flex-col h-full bg-fahh-bg text-fahh-text text-xs font-mono">
      <div className="flex items-center px-3 py-1 border-b border-fahh-surface text-fahh-muted shrink-0">
        <span>{isDebugging ? (isPaused ? "Paused" : "Running") : "No debug session"}</span>
        <button title="Clear Console" aria-label="Clear Console" onClick={clear} className="ml-auto hover:text-fahh-text">
          <Trash2 size={12} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-1 whitespace-pre-wrap break-all">
        {lines.length === 0 && <div className="text-fahh-muted">Program output appears here. Start debugging with F5.</div>}
        {lines.map((l, i) => (
          <div key={i} className={COLOURS[l.category] ?? ""}>
            {l.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="flex items-center gap-2 px-3 py-1 border-t border-fahh-surface shrink-0">
        <span className="text-fahh-accent">›</span>
        <input
          aria-label="Evaluate expression"
          value={input}
          disabled={!isDebugging}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            else if (e.key === "ArrowUp" && history.length) {
              const next = Math.min(cursor + 1, history.length - 1);
              setCursor(next);
              setInput(history[next]);
              e.preventDefault();
            } else if (e.key === "ArrowDown") {
              const next = cursor - 1;
              setCursor(next);
              setInput(next >= 0 ? history[next] : "");
              e.preventDefault();
            }
          }}
          placeholder={isDebugging ? (isPaused ? "Evaluate in the paused frame" : "Evaluate (pause for locals)") : "Start debugging to evaluate"}
          className="flex-1 bg-transparent outline-none placeholder:text-fahh-muted disabled:opacity-60"
        />
      </div>
    </div>
  );
}
