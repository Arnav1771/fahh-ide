import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useDebugStore } from "../../store/debugStore";
import { useEditorStore } from "../../store/editorStore";
import {
  debugStart,
  debugContinue,
  debugStepOver,
  debugStepIn,
  debugStop,
} from "../../lib/tauri";
import type { DapConfig, DebugEvent, StackFrame, Variable } from "../../lib/types";

// ─── DAP adapter map ──────────────────────────────────────────────────────────

const ADAPTER_MAP: Record<string, string> = {
  python: "debugpy",
  javascript: "js-debug",
  typescript: "js-debug",
  rust: "codelldb",
  go: "dlv-dap",
  cpp: "codelldb",
  c: "codelldb",
};

function adapterForLanguage(language: string): string {
  return ADAPTER_MAP[language.toLowerCase()] ?? "generic-dap";
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function shortPath(full: string): string {
  const parts = full.replace(/\\/g, "/").split("/");
  return parts.slice(-2).join("/");
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToolbarButton({
  onClick,
  disabled,
  title,
  children,
  variant = "default",
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  variant?: "default" | "green" | "red";
}) {
  const colours =
    variant === "green"
      ? "bg-fahh-success/20 text-fahh-success hover:bg-fahh-success/30"
      : variant === "red"
      ? "bg-fahh-error/20 text-fahh-error hover:bg-fahh-error/30"
      : "bg-fahh-surface text-fahh-text hover:bg-fahh-sidebar";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${colours}`}
    >
      {children}
    </button>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-1 text-[10px] uppercase tracking-widest text-fahh-muted font-semibold bg-fahh-sidebar border-b border-fahh-surface">
      {children}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DebugPanel() {
  const {
    sessionId,
    isDebugging,
    isPaused,
    currentFile,
    currentLine,
    breakpoints,
    stackFrames,
    variables,
    start,
    stop,
    pause,
    resume,
    setCurrentPosition,
    setStackFrames,
    setVariables,
    removeBreakpoint,
  } = useDebugStore();

  const { activeTab, openTabs } = useEditorStore();
  const activeDoc = openTabs.find((t) => t.path === activeTab) ?? null;

  // ── DAP event listener ──────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | null = null;

    listen<DebugEvent>("dap://event", (event) => {
      if (!mounted) return;
      const { session_id, event: evtKind, body } = event.payload;

      // Ignore events for sessions we didn't start
      if (sessionId !== null && session_id !== sessionId) return;

      switch (evtKind) {
        case "stopped": {
          // body: { reason, file, line, stack_frames, variables }
          const file = (body["file"] as string | undefined) ?? null;
          const line = (body["line"] as number | undefined) ?? null;
          const frames = (body["stack_frames"] as StackFrame[] | undefined) ?? [];
          const vars = (body["variables"] as Variable[] | undefined) ?? [];

          if (file && line !== null) setCurrentPosition(file, line);
          setStackFrames(frames);
          setVariables(vars);
          pause();
          break;
        }
        case "continued":
          resume();
          break;
        case "exited":
          stop();
          break;
        default:
          break;
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [sessionId, pause, resume, stop, setCurrentPosition, setStackFrames, setVariables]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleStartDebug = async () => {
    if (!activeDoc) return;
    const language = activeDoc.language;

    const config: DapConfig = {
      adapter: adapterForLanguage(language),
      language,
      program: activeDoc.path,
      stop_on_entry: true,
    };

    try {
      const sid = await debugStart(config);
      start(sid);
    } catch (err) {
      console.error("debug_start failed:", err);
    }
  };

  const handleContinue = async () => {
    if (sessionId === null) return;
    try {
      await debugContinue(sessionId);
      resume();
    } catch (err) {
      console.error("debug_continue failed:", err);
    }
  };

  const handleStepOver = async () => {
    if (sessionId === null) return;
    try {
      await debugStepOver(sessionId);
    } catch (err) {
      console.error("debug_step_over failed:", err);
    }
  };

  const handleStepIn = async () => {
    if (sessionId === null) return;
    try {
      await debugStepIn(sessionId);
    } catch (err) {
      console.error("debug_step_in failed:", err);
    }
  };

  const handleStop = async () => {
    if (sessionId === null) return;
    try {
      await debugStop(sessionId);
    } catch {
      // May already be gone
    }
    stop();
  };

  // ── Breakpoint list ─────────────────────────────────────────────────────────
  const breakpointEntries: Array<{ file: string; line: number }> = [];
  for (const [file, lines] of Object.entries(breakpoints)) {
    for (const line of lines) {
      breakpointEntries.push({ file, line });
    }
  }

  return (
    <div className="flex flex-col h-full bg-fahh-bg text-fahh-text text-xs font-mono overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-fahh-surface shrink-0 bg-fahh-sidebar">
        {!isDebugging ? (
          <ToolbarButton
            onClick={handleStartDebug}
            disabled={!activeDoc}
            title={activeDoc ? `Debug ${activeDoc.path}` : "Open a file first"}
            variant="green"
          >
            <span>▶</span>
            <span>Start Debug</span>
          </ToolbarButton>
        ) : (
          <>
            <ToolbarButton
              onClick={handleContinue}
              disabled={!isPaused}
              title="Continue (F5)"
              variant="green"
            >
              <span>▶</span>
              <span>Continue</span>
            </ToolbarButton>
            <ToolbarButton
              onClick={handleStepOver}
              disabled={!isPaused}
              title="Step Over (F10)"
            >
              <span>⤵</span>
              <span>Step Over</span>
            </ToolbarButton>
            <ToolbarButton
              onClick={handleStepIn}
              disabled={!isPaused}
              title="Step In (F11)"
            >
              <span>↓</span>
              <span>Step In</span>
            </ToolbarButton>
            <ToolbarButton
              onClick={handleStop}
              title="Stop debugging"
              variant="red"
            >
              <span>■</span>
              <span>Stop</span>
            </ToolbarButton>
          </>
        )}

        <div className="flex-1" />

        {/* Current position indicator */}
        {isDebugging && currentFile && currentLine !== null && (
          <span className="text-fahh-warn text-[10px]">
            ⏸ {shortPath(currentFile)}:{currentLine}
          </span>
        )}
        {isDebugging && !isPaused && (
          <span className="text-fahh-success text-[10px] animate-pulse">
            ● Running
          </span>
        )}
      </div>

      {/* ── Body (scrollable sections) ── */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Breakpoints ── */}
        <SectionHeader>Breakpoints ({breakpointEntries.length})</SectionHeader>
        {breakpointEntries.length === 0 ? (
          <div className="px-3 py-2 text-fahh-muted">
            No breakpoints set. Click the gutter in the editor to add one.
          </div>
        ) : (
          <ul>
            {breakpointEntries.map(({ file, line }) => (
              <li
                key={`${file}:${line}`}
                className="flex items-center gap-2 px-3 py-1 hover:bg-fahh-surface/50 group"
              >
                <span className="text-fahh-error">●</span>
                <span className="flex-1 truncate">
                  {shortPath(file)}
                  <span className="text-fahh-muted">:{line}</span>
                </span>
                <button
                  onClick={() => removeBreakpoint(file, line)}
                  title="Remove breakpoint"
                  className="opacity-0 group-hover:opacity-100 text-fahh-muted hover:text-fahh-error transition-all text-[10px]"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* ── Stack frames ── */}
        <SectionHeader>Call Stack ({stackFrames.length})</SectionHeader>
        {stackFrames.length === 0 ? (
          <div className="px-3 py-2 text-fahh-muted">
            {isDebugging ? "Not paused." : "Start a debug session to see frames."}
          </div>
        ) : (
          <ul>
            {stackFrames.map((frame, idx) => (
              <li
                key={frame.id}
                className={`flex flex-col px-3 py-1 ${
                  idx === 0
                    ? "bg-fahh-accent/10 border-l-2 border-fahh-accent"
                    : "hover:bg-fahh-surface/50"
                }`}
              >
                <span className="text-fahh-text truncate">{frame.name}</span>
                <span className="text-fahh-muted text-[10px]">
                  {shortPath(frame.file)}:{frame.line}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* ── Variables ── */}
        <SectionHeader>Variables ({variables.length})</SectionHeader>
        {variables.length === 0 ? (
          <div className="px-3 py-2 text-fahh-muted">
            {isDebugging ? "No variables in scope." : "Start a debug session."}
          </div>
        ) : (
          <ul>
            {variables.map((v, i) => (
              <li
                key={i}
                className="flex items-center gap-2 px-3 py-0.5 hover:bg-fahh-surface/50"
              >
                <span className="text-fahh-info truncate max-w-[8rem]">{v.name}</span>
                <span className="text-fahh-muted">=</span>
                <span className="flex-1 text-fahh-success truncate">{v.value}</span>
                {v.type && (
                  <span className="text-[10px] text-fahh-muted shrink-0">
                    {v.type}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
