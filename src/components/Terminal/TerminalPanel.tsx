import { useEffect, useRef, useState } from "react";
import { useTerminalStore } from "../../store/terminalStore";
import { useTerminal } from "../../hooks/useTerminal";
import { useFileStore } from "../../store/fileStore";

export function TerminalPanel() {
  const { lines } = useTerminalStore();
  const { run } = useTerminal();
  const { tree } = useFileStore();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = input.trim();
    if (!cmd) return;
    setInput("");
    run(cmd);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      if (!tree || !tree.children) return;
      
      const tokens = input.split(" ");
      const lastToken = tokens[tokens.length - 1];
      if (!lastToken) return;

      const matches = tree.children
        .filter((child) => child.name.toLowerCase().startsWith(lastToken.toLowerCase()))
        .map((child) => child.name + (child.is_dir ? "/" : ""));

      if (matches.length === 1) {
        tokens[tokens.length - 1] = matches[0];
        setInput(tokens.join(" "));
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0d1a] font-mono text-sm">
      <div className="flex items-center px-3 py-1 bg-fahh-sidebar border-b border-fahh-surface shrink-0">
        <span className="text-xs text-fahh-muted uppercase tracking-wider">Terminal</span>
      </div>
      <div id="terminal-output" className="flex-1 overflow-y-auto px-3 py-2 text-fahh-text">
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              line.type === "stderr"
                ? "text-fahh-error"
                : line.type === "info"
                ? "text-fahh-info"
                : "text-fahh-text"
            }
          >
            <pre className="whitespace-pre-wrap break-words">{line.text}</pre>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={handleSubmit}
        className="flex items-center px-3 py-2 border-t border-fahh-surface shrink-0"
      >
        <span className="text-fahh-accent mr-2">$</span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent outline-none text-fahh-text placeholder-fahh-muted text-sm"
          placeholder="Enter command..."
          autoComplete="off"
          spellCheck={false}
        />
      </form>
    </div>
  );
}
