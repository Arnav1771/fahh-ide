import { useEffect, useRef, useState } from "react";
import { useTerminalStore, TerminalSession } from "../../store/terminalStore";
import { useTerminal } from "../../hooks/useTerminal";
import { useFileStore } from "../../store/fileStore";
import { promptLabel } from "../../lib/shellCwd";
import { stepHistory } from "../../lib/termHistory";
import { focusEditor } from "../../lib/monacoBridge";
import { homeDir } from "@tauri-apps/api/path";
import {
  X,
  HelpCircle,
  Plus,
  Trash2,
  Terminal as TerminalIcon,
  Columns2,
  Rows2,
} from "lucide-react";

interface SingleTerminalPaneProps {
  session: TerminalSession;
  isActive: boolean;
  onFocus: () => void;
  showPaneHeader?: boolean;
  onClosePane?: () => void;
  home: string | null;
}

function SingleTerminalPane({
  session,
  isActive,
  onFocus,
  showPaneHeader = false,
  onClosePane,
  home,
}: SingleTerminalPaneProps) {
  const { remember, clearLines } = useTerminalStore();
  const { run } = useTerminal();
  const { tree } = useFileStore();

  const [input, setInput] = useState("");
  const [histIdx, setHistIdx] = useState(session.history.length);
  const draftRef = useRef("");

  const terminalOutputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (terminalOutputRef.current) {
      terminalOutputRef.current.scrollTop = terminalOutputRef.current.scrollHeight;
    }
  }, [session.lines]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = input.trim();
    if (!cmd) return;
    setInput("");
    remember(cmd, session.id);
    setHistIdx(session.history.length + 1);
    if (/^(clear|cls)$/i.test(cmd)) return clearLines(session.id);
    run(cmd);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (!focusEditor()) e.currentTarget.blur();
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      clearLines(session.id);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (histIdx >= session.history.length) draftRef.current = input;
      const step = stepHistory(session.history, histIdx, e.key === "ArrowUp" ? "up" : "down", draftRef.current);
      if (step) {
        e.preventDefault();
        setHistIdx(step.idx);
        setInput(step.value);
      }
    } else if (e.key === "Tab" && !e.shiftKey) {
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
    <div
      onClick={onFocus}
      className={`flex flex-col h-full min-w-0 min-h-0 bg-fahh-bg transition-colors ${
        isActive ? "ring-1 ring-inset ring-fahh-accent/40" : "opacity-90 hover:opacity-100"
      }`}
    >
      {/* Mini Pane Header for Split Views */}
      {showPaneHeader && (
        <div className="flex items-center justify-between px-2.5 py-1 bg-fahh-sidebar/80 border-b border-fahh-surface text-[11px] select-none shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <TerminalIcon size={11} className={isActive ? "text-fahh-accent" : "text-fahh-muted"} />
            <span className={`truncate font-mono font-medium ${isActive ? "text-fahh-text" : "text-fahh-muted"}`}>
              {session.title}
            </span>
          </div>
          {onClosePane && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClosePane();
              }}
              className="text-fahh-muted hover:text-fahh-error p-0.5 rounded transition-colors"
              title="Close this split pane"
            >
              <X size={11} />
            </button>
          )}
        </div>
      )}

      {/* Terminal Output Stream */}
      <div
        ref={terminalOutputRef}
        className="flex-1 overflow-y-auto px-3 py-2 text-fahh-text min-h-0 select-text"
      >
        {session.lines.map((line, i) => (
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
          </div>
        ))}
      </div>

      {/* Prompt Form */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center px-3 py-2 border-t border-fahh-surface shrink-0"
      >
        <span className="fahh-prompt text-fahh-muted mr-1 max-w-[40%] truncate" title={session.cwd || "home"}>
          {promptLabel(session.cwd, home)}
        </span>
        <span className="text-fahh-accent mr-2">$</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent outline-none text-fahh-text placeholder-fahh-muted text-sm font-mono min-w-0"
          placeholder="Enter command..."
          autoComplete="off"
          spellCheck={false}
        />
      </form>
    </div>
  );
}

export function TerminalPanel() {
  const {
    sessions,
    activeSessionId,
    splitSessionIds,
    isSplitView,
    splitLayout,
    clearLines,
    createSession,
    closeSession,
    setActiveSession,
    splitTerminal,
    setSplitLayout,
    closeSplitPane,
  } = useTerminalStore();

  const [home, setHome] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    homeDir().then(setHome).catch(() => setHome(null));
  }, []);

  // Global Keyboard Shortcuts (Ctrl+Shift+` for new, Ctrl+Shift+5 for split)
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      if (isCmdOrCtrl && e.shiftKey && (e.key === "`" || e.key === "~")) {
        e.preventDefault();
        createSession();
      } else if (isCmdOrCtrl && e.shiftKey && (e.key === "5" || e.key === "%")) {
        e.preventDefault();
        splitTerminal();
      }
    };
    window.addEventListener("keydown", handleGlobalShortcuts);
    return () => window.removeEventListener("keydown", handleGlobalShortcuts);
  }, [createSession, splitTerminal]);

  const shortcuts = [
    { label: "agy (cli)", cmd: "agy" },
    { label: "python <file>", cmd: "python " },
    { label: "fahh .", cmd: "fahh ." },
    { label: "pnpm dev", cmd: "pnpm dev" },
    { label: "git status", cmd: "git status" },
    { label: "cls / clear", cmd: "clear" },
  ];

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
  const splitSessions = sessions.filter((s) => splitSessionIds.includes(s.id));

  return (
    <div className="flex flex-col h-full bg-fahh-bg font-mono text-sm overflow-hidden" data-testid="terminal-panel">
      {/* ── Multi-Terminal VS Code Style Tabs & Controls Bar ── */}
      <div className="flex items-center justify-between px-2 bg-fahh-sidebar border-b border-fahh-surface shrink-0 h-8 select-none">
        {/* Left: Terminal Session Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 mr-2 h-full">
          {sessions.map((sess) => {
            const isActive = sess.id === activeSessionId;
            const isInSplit = isSplitView && splitSessionIds.includes(sess.id);
            return (
              <div
                key={sess.id}
                onClick={() => setActiveSession(sess.id)}
                className={`flex items-center gap-1.5 px-2.5 h-full text-xs cursor-pointer rounded-t border-t-2 transition-all ${
                  isActive
                    ? "bg-fahh-bg text-fahh-text border-fahh-accent font-medium shadow-sm"
                    : isInSplit
                    ? "bg-fahh-bg/60 text-fahh-text border-fahh-accent/40"
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

        {/* Right: Split Terminal, Layout, Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Split Terminal Button (VS Code style Ctrl+Shift+5) */}
          <button
            type="button"
            onClick={() => splitTerminal()}
            title="Split Terminal Side-by-Side (Ctrl+Shift+5)"
            className={`p-1 rounded text-xs transition-colors flex items-center gap-1 ${
              isSplitView
                ? "bg-fahh-accent/20 text-fahh-accent hover:bg-fahh-accent/30"
                : "text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface"
            }`}
          >
            <Columns2 size={13} />
            <span className="text-[10px] max-md:hidden">Split</span>
          </button>

          {/* Split Layout Switcher (when split is active) */}
          {isSplitView && (
            <button
              type="button"
              onClick={() => setSplitLayout(splitLayout === "horizontal" ? "vertical" : "horizontal")}
              title={`Switch split layout (currently ${splitLayout})`}
              className="p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface transition-colors"
            >
              {splitLayout === "horizontal" ? <Rows2 size={13} /> : <Columns2 size={13} />}
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowShortcuts((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-fahh-muted hover:text-fahh-accent transition-colors px-1"
            title="Toggle command shortcuts"
          >
            <HelpCircle size={11} />
            <span className="max-sm:hidden">? shortcuts</span>
          </button>

          <button
            type="button"
            onClick={() => clearLines(activeSessionId)}
            title="Clear the active terminal (Ctrl+L)"
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
        <div className="flex items-center gap-1.5 px-3 py-1 bg-fahh-surface/40 border-b border-fahh-surface overflow-x-auto no-scrollbar text-xs shrink-0">
          <span className="text-[10px] uppercase tracking-wider text-fahh-muted font-sans font-semibold">Quick:</span>
          {shortcuts.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => {
                useTerminalStore.getState().addLine(`$ ${s.cmd}`, "info");
              }}
              className="px-2 py-0.5 rounded bg-fahh-bg hover:bg-fahh-accent/20 hover:text-fahh-accent text-[11px] font-mono text-fahh-text border border-fahh-surface transition-colors shrink-0"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Terminal Viewport: Single Pane OR Multi-Pane Split View */}
      <div className="flex-1 min-h-0 w-full overflow-hidden">
        {isSplitView && splitSessions.length > 1 ? (
          <div
            className={`grid h-full w-full ${
              splitLayout === "horizontal"
                ? `grid-cols-${Math.min(splitSessions.length, 4)} divide-x`
                : `grid-rows-${Math.min(splitSessions.length, 4)} divide-y`
            } divide-fahh-surface overflow-hidden`}
          >
            {splitSessions.map((sess) => (
              <SingleTerminalPane
                key={sess.id}
                session={sess}
                isActive={sess.id === activeSessionId}
                onFocus={() => setActiveSession(sess.id)}
                showPaneHeader={true}
                onClosePane={() => closeSplitPane(sess.id)}
                home={home}
              />
            ))}
          </div>
        ) : (
          <SingleTerminalPane
            key={activeSession.id}
            session={activeSession}
            isActive={true}
            onFocus={() => {}}
            showPaneHeader={false}
            home={home}
          />
        )}
      </div>
    </div>
  );
}
