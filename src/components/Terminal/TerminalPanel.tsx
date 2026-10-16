import { useEffect, useRef, useState } from "react";
import { useTerminalStore } from "../../store/terminalStore";
import { useTerminal } from "../../hooks/useTerminal";
import { useFileStore } from "../../store/fileStore";
import { detectShell, promptLabel, shellName } from "../../lib/shellCwd";
import { stepHistory } from "../../lib/termHistory";
import { focusEditor } from "../../lib/monacoBridge";
import { homeDir } from "@tauri-apps/api/path";

export function TerminalPanel() {
  const { lines, cwd, history, remember, clearLines } = useTerminalStore();
  /** Where Up/Down is in the history; history.length means the line being typed. */
  const [histIdx, setHistIdx] = useState(0);
  const draftRef = useRef("");
  const [home, setHome] = useState<string | null>(null);
  useEffect(() => {
    homeDir().then(setHome).catch(() => setHome(null));
  }, []);
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
    remember(cmd);
    setHistIdx(useTerminalStore.getState().history.length);
    if (/^(clear|cls)$/i.test(cmd)) return clearLines();
    run(cmd);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      // Give the keyboard back to the editor.
      e.preventDefault();
      if (!focusEditor()) e.currentTarget.blur();
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      clearLines();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (histIdx >= history.length) draftRef.current = input;
      const step = stepHistory(history, histIdx, e.key === "ArrowUp" ? "up" : "down", draftRef.current);
      if (step) {
        e.preventDefault();
        setHistIdx(step.idx);
        setInput(step.value);
      }
    } else if (e.key === "Tab" && !e.shiftKey) {
      // Complete a file name when exactly one matches; otherwise Tab moves focus on as usual.
      const tokens = input.split(" ");
      const lastToken = tokens[tokens.length - 1];
      if (!tree?.children || !lastToken) return;
      const matches = tree.children
        .filter((child) => child.name.toLowerCase().startsWith(lastToken.toLowerCase()))
        .map((child) => child.name + (child.is_dir ? "/" : ""));
      if (matches.length === 1) {
        e.preventDefault();
        tokens[tokens.length - 1] = matches[0];
        setInput(tokens.join(" "));
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-fahh-bg font-mono text-sm">
      <div className="flex items-center justify-between px-3 py-1 bg-fahh-sidebar border-b border-fahh-surface shrink-0">
        <span className="fahh-label text-xs text-fahh-muted uppercase tracking-wider" title="The shell commands run in">{shellName(detectShell())}</span>
        <button
          type="button"
          onClick={clearLines}
          title="Clear the terminal (Ctrl+L)"
          className="text-xs text-fahh-muted hover:text-fahh-text transition-colors"
        >
          Clear
        </button>
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
        <span className="fahh-prompt text-fahh-muted mr-1 max-w-[40%] truncate" title={cwd || "home"}>{promptLabel(cwd, home)}</span>
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
