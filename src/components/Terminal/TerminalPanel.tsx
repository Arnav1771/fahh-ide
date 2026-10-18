import { useEffect, useRef, useState } from "react";
import { useTerminalStore } from "../../store/terminalStore";
import { useTerminal } from "../../hooks/useTerminal";
import { useFileStore } from "../../store/fileStore";
import { detectShell, promptLabel, shellName } from "../../lib/shellCwd";
import { stepHistory } from "../../lib/termHistory";
import { focusEditor } from "../../lib/monacoBridge";
import { homeDir } from "@tauri-apps/api/path";
import { X, HelpCircle, Sparkles } from "lucide-react";
import { useComposerStore } from "../../store/composerStore";

export function TerminalPanel() {
  const { lines, cwd, history, remember, clearLines } = useTerminalStore();
  /** Where Up/Down is in the history; history.length means the line being typed. */
  const [histIdx, setHistIdx] = useState(0);
  const draftRef = useRef("");
  const [home, setHome] = useState<string | null>(null);
  const [pastedImage, setPastedImage] = useState<{ name: string; size: number; preview: string } | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    homeDir().then(setHome).catch(() => setHome(null));
  }, []);
  const { run } = useTerminal();
  const { tree } = useFileStore();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  // Alt+V image paste listener (Claude Code style)
  useEffect(() => {
    const handleGlobalAltV = async (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        try {
          const clipItems = await navigator.clipboard.read();
          for (const item of clipItems) {
            const imgType = item.types.find((t) => t.startsWith("image/"));
            if (imgType) {
              const blob = await item.getType(imgType);
              const reader = new FileReader();
              reader.onload = () => {
                const imgName = `pasted_${Date.now()}.png`;
                setPastedImage({
                  name: imgName,
                  size: blob.size,
                  preview: reader.result as string,
                });
                setInput((prev) => (prev ? `${prev} [Image: ${imgName}]` : `[Image: ${imgName}]`));
                inputRef.current?.focus();
              };
              reader.readAsDataURL(blob);
              break;
            }
          }
        } catch {
          // Plain clipboard text or permission denied
        }
      }
    };
    window.addEventListener("keydown", handleGlobalAltV);
    return () => window.removeEventListener("keydown", handleGlobalAltV);
  }, []);

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            const imgName = file.name || `image_${Date.now()}.png`;
            setPastedImage({
              name: imgName,
              size: file.size,
              preview: reader.result as string,
            });
            setInput((prev) => (prev ? `${prev} [Image: ${imgName}]` : `[Image: ${imgName}]`));
          };
          reader.readAsDataURL(file);
        }
        break;
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = input.trim();
    if (!cmd && !pastedImage) return;
    setInput("");
    setPastedImage(null);
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

  const shortcuts = [
    { label: "python <file>", cmd: "python " },
    { label: "fahh .", cmd: "fahh ." },
    { label: "pnpm dev", cmd: "pnpm dev" },
    { label: "git status", cmd: "git status" },
    { label: "cls / clear", cmd: "clear" },
  ];

  return (
    <div className="flex flex-col h-full bg-fahh-bg font-mono text-sm" data-testid="terminal-panel">
      {/* Terminal Header */}
      <div className="flex items-center justify-between px-3 py-1 bg-fahh-sidebar border-b border-fahh-surface shrink-0">
        <div className="flex items-center gap-2">
          <span className="fahh-label text-xs text-fahh-muted uppercase tracking-wider" title="The shell commands run in">
            {shellName(detectShell())}
          </span>
          <button
            type="button"
            onClick={() => setShowShortcuts((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-fahh-muted hover:text-fahh-accent transition-colors"
            title="Toggle command shortcuts"
          >
            <HelpCircle size={11} />
            <span>? shortcuts</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-fahh-muted/70 max-sm:hidden">
            Alt+V to paste image
          </span>
          <button
            type="button"
            onClick={clearLines}
            title="Clear the terminal (Ctrl+L)"
            className="text-xs text-fahh-muted hover:text-fahh-text transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Quick Shortcuts Bar */}
      {showShortcuts && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-fahh-surface/40 border-b border-fahh-surface overflow-x-auto no-scrollbar text-xs">
          <span className="text-[10px] uppercase tracking-wider text-fahh-muted font-sans font-semibold">Quick:</span>
          {shortcuts.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => {
                setInput(s.cmd);
                inputRef.current?.focus();
              }}
              className="px-2 py-0.5 rounded bg-fahh-bg hover:bg-fahh-accent/20 hover:text-fahh-accent text-[11px] font-mono text-fahh-text border border-fahh-surface transition-colors shrink-0"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Terminal Output */}
      <div id="terminal-output" className="flex-1 overflow-y-auto px-3 py-2 text-fahh-text">
        {lines.map((line, i) => (
          <div
            key={i}
            className={`group flex items-start justify-between gap-2 py-0.5 ${
              line.type === "stderr"
                ? "text-fahh-error"
                : line.type === "info"
                ? "text-fahh-info"
                : "text-fahh-text"
            }`}
          >
            <pre className="whitespace-pre-wrap break-words flex-1 font-mono text-xs">{line.text}</pre>
            {line.type === "stderr" && (
              <button
                type="button"
                onClick={() => {
                  const composer = useComposerStore.getState();
                  composer.openComposer();
                  composer.attachContext({
                    id: `term-err-${i}`,
                    type: "terminal",
                    label: "@terminal error",
                    content: line.text,
                  });
                  composer.setPrompt(`Fix terminal error:\n${line.text.slice(0, 150)}`);
                }}
                className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded bg-fahh-accent/15 hover:bg-fahh-accent/25 text-fahh-accent text-[10px] font-sans flex items-center gap-1 shrink-0 mt-0.5 border border-fahh-accent/30"
                title="Send error to Cursor Composer (Ctrl+I)"
              >
                <Sparkles size={10} /> Fix with AI
              </button>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Pasted Image Preview Chip */}
      {pastedImage && (
        <div className="mx-3 my-1 px-2.5 py-1 rounded bg-fahh-surface border border-fahh-accent/40 flex items-center justify-between gap-2 max-w-sm">
          <div className="flex items-center gap-2 min-w-0">
            <img src={pastedImage.preview} alt="" className="w-6 h-6 rounded object-cover border border-fahh-surface shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-fahh-text truncate font-sans">{pastedImage.name}</p>
              <p className="text-[10px] text-fahh-muted">{(pastedImage.size / 1024).toFixed(1)} KB attached</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setPastedImage(null);
              setInput((prev) => prev.replace(/\[Image:.*?\]/g, "").trim());
            }}
            className="p-1 rounded text-fahh-muted hover:text-fahh-error"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Input Form */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center px-3 py-2 border-t border-fahh-surface shrink-0"
      >
        <span className="fahh-prompt text-fahh-muted mr-1 max-w-[40%] truncate" title={cwd || "home"}>
          {promptLabel(cwd, home)}
        </span>
        <span className="text-fahh-accent mr-2">$</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className="flex-1 bg-transparent outline-none text-fahh-text placeholder-fahh-muted text-sm font-mono"
          placeholder="Enter command... (Alt+V to paste image)"
          autoComplete="off"
          spellCheck={false}
        />
      </form>
    </div>
  );
}
