import { useEffect, useRef, useState } from "react";
import { useTerminalStore } from "../../store/terminalStore";
import { useTerminal } from "../../hooks/useTerminal";
import { useFileStore } from "../../store/fileStore";
import { promptLabel } from "../../lib/shellCwd";
import { stepHistory } from "../../lib/termHistory";
import { focusEditor } from "../../lib/monacoBridge";
import { homeDir } from "@tauri-apps/api/path";
import { X, HelpCircle, Sparkles, Plus, Trash2, Terminal as TerminalIcon } from "lucide-react";
import { useComposerStore } from "../../store/composerStore";

export function TerminalPanel() {
  const {
    sessions,
    activeSessionId,
    lines,
    cwd,
    history,
    remember,
    clearLines,
    createSession,
    closeSession,
    setActiveSession,
  } = useTerminalStore();
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
  const terminalOutputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (terminalOutputRef.current) {
      terminalOutputRef.current.scrollTop = terminalOutputRef.current.scrollHeight;
    }
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
    const handleNewTermShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "`" || e.key === "~")) {
        e.preventDefault();
        createSession();
      }
    };
    window.addEventListener("keydown", handleNewTermShortcut);
    return () => {
      window.removeEventListener("keydown", handleGlobalAltV);
      window.removeEventListener("keydown", handleNewTermShortcut);
    };
  }, [createSession]);

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
    { label: "agy (cli)", cmd: "agy" },
    { label: "python <file>", cmd: "python " },
    { label: "fahh .", cmd: "fahh ." },
    { label: "pnpm dev", cmd: "pnpm dev" },
    { label: "git status", cmd: "git status" },
    { label: "cls / clear", cmd: "clear" },
  ];

  return (
    <div className="flex flex-col h-full bg-fahh-bg font-mono text-sm" data-testid="terminal-panel">
      {/* ── Multi-Terminal VS Code Style Tabs Bar ── */}
      <div className="flex items-center justify-between px-2 bg-fahh-sidebar border-b border-fahh-surface shrink-0 h-8 select-none">
        {/* Left: Terminal Session Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 mr-2 h-full">
          {sessions.map((sess) => {
            const isActive = sess.id === activeSessionId;
            return (
              <div
                key={sess.id}
                onClick={() => setActiveSession(sess.id)}
                className={`flex items-center gap-1.5 px-2.5 h-full text-xs cursor-pointer rounded-t border-t-2 transition-all ${
                  isActive
                    ? "bg-fahh-bg text-fahh-text border-fahh-accent font-medium shadow-sm"
                    : "bg-fahh-sidebar/60 text-fahh-muted hover:text-fahh-text border-transparent hover:bg-fahh-surface"
                }`}
                title={sess.title}
              >
                <TerminalIcon size={12} className={isActive ? "text-fahh-accent" : "text-fahh-muted"} />
                <span className="truncate max-w-[110px] font-mono text-[11px]">{sess.title}</span>
                {sessions.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeSession(sess.id);
                    }}
                    className="opacity-40 hover:opacity-100 hover:text-fahh-error p-0.5 rounded transition-opacity ml-1"
                    title="Kill Terminal"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          })}

          {/* New Terminal Plus Button */}
          <button
            type="button"
            onClick={() => createSession()}
            title="New Terminal (Ctrl+Shift+`)"
            className="flex items-center gap-1 px-2 py-1 text-xs text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface rounded transition-colors ml-1"
          >
            <Plus size={13} />
          </button>

          {/* Dropdown for specific shells */}
          <select
            onChange={(e) => {
              if (e.target.value) {
                createSession(e.target.value, `${sessions.length + 1}: ${e.target.value}`);
                e.target.value = "";
              }
            }}
            value=""
            className="bg-transparent text-fahh-muted hover:text-fahh-text border border-white/10 rounded px-1.5 py-0.5 text-[11px] outline-none cursor-pointer"
            title="Launch specific shell"
          >
            <option value="" disabled className="bg-fahh-sidebar text-fahh-muted">+ Shell</option>
            <option value="powershell" className="bg-fahh-sidebar text-fahh-text">PowerShell</option>
            <option value="cmd" className="bg-fahh-sidebar text-fahh-text">Command Prompt</option>
            <option value="bash" className="bg-fahh-sidebar text-fahh-text">Bash / WSL</option>
          </select>
        </div>

        {/* Right: Actions (Clear, Kill, Help) */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowShortcuts((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-fahh-muted hover:text-fahh-accent transition-colors"
            title="Toggle command shortcuts"
          >
            <HelpCircle size={11} />
            <span className="max-sm:hidden">? shortcuts</span>
          </button>

          <button
            type="button"
            onClick={() => clearLines()}
            title="Clear the terminal (Ctrl+L)"
            className="text-xs text-fahh-muted hover:text-fahh-text transition-colors px-1"
          >
            Clear
          </button>

          {sessions.length > 1 && (
            <button
              type="button"
              onClick={() => closeSession(activeSessionId)}
              title="Kill active terminal"
              className="text-fahh-muted hover:text-fahh-error transition-colors p-1 rounded"
            >
              <Trash2 size={12} />
            </button>
          )}
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
      <div
        id="terminal-output"
        ref={terminalOutputRef}
        className="flex-1 overflow-y-auto px-3 py-2 text-fahh-text"
      >
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
