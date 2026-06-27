import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useEditorStore } from "../../store/editorStore";
import { useRunnerStore } from "../../store/runnerStore";
import { runFile, stopRun as stopRunCmd } from "../../lib/tauri";
import type { RunOutputEvent } from "../../lib/types";

// ─── Language metadata ────────────────────────────────────────────────────────

interface LangMeta {
  label: string;
  icon: string;
  color: string;
  monacoId: string;
}

const LANGUAGE_META: Record<string, LangMeta> = {
  python: { label: "Python", icon: "🐍", color: "text-yellow-400", monacoId: "python" },
  javascript: { label: "JavaScript", icon: "☕", color: "text-yellow-300", monacoId: "javascript" },
  typescript: { label: "TypeScript", icon: "🔷", color: "text-blue-400", monacoId: "typescript" },
  rust: { label: "Rust", icon: "🦀", color: "text-orange-400", monacoId: "rust" },
  go: { label: "Go", icon: "🐹", color: "text-cyan-400", monacoId: "go" },
  java: { label: "Java", icon: "☕", color: "text-red-400", monacoId: "java" },
  c: { label: "C", icon: "⚙", color: "text-gray-400", monacoId: "c" },
  cpp: { label: "C++", icon: "⚙", color: "text-purple-400", monacoId: "cpp" },
  shell: { label: "Shell", icon: "🐚", color: "text-green-400", monacoId: "shell" },
  bash: { label: "Bash", icon: "🐚", color: "text-green-400", monacoId: "shell" },
  ruby: { label: "Ruby", icon: "💎", color: "text-red-500", monacoId: "ruby" },
  php: { label: "PHP", icon: "🐘", color: "text-violet-400", monacoId: "php" },
};

const SUPPORTED_LANGUAGES = Object.keys(LANGUAGE_META);

function getLangMeta(language: string): LangMeta {
  return (
    LANGUAGE_META[language.toLowerCase()] ?? {
      label: language,
      icon: "▶",
      color: "text-fahh-accent",
      monacoId: language,
    }
  );
}

function detectLanguage(filePath: string, docLanguage: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const extMap: Record<string, string> = {
    py: "python",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    mts: "typescript",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    sh: "shell",
    bash: "bash",
    rb: "ruby",
    php: "php",
  };
  return extMap[ext] ?? docLanguage;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RunPanel() {
  const { activeTab, openTabs } = useEditorStore();
  const {
    isRunning,
    pid,
    output,
    language: storedLanguage,
    exitCode,
    durationMs,
    startRun,
    stopRun,
    addOutput,
    clearOutput,
    setLanguage,
    finishRun,
  } = useRunnerStore();

  const activeDoc = openTabs.find((t) => t.path === activeTab) ?? null;

  // Detect language from the active file; fall back to stored override
  const detectedLanguage = activeDoc
    ? detectLanguage(activeDoc.path, activeDoc.language)
    : null;

  const [languageOverride, setLanguageOverride] = useState<string | null>(null);
  const effectiveLanguage = languageOverride ?? detectedLanguage ?? storedLanguage ?? "python";

  const outputRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Auto-scroll on new output
  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output.length]);

  // Reset language override when active file changes
  useEffect(() => {
    setLanguageOverride(null);
  }, [activeTab]);

  // Listen to runner://output events from Tauri
  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | null = null;

    listen<RunOutputEvent>("runner://output", (event) => {
      if (!mounted) return;
      const { line, stream, pid: eventPid } = event.payload;
      // Only accept events for the current pid
      if (pid !== null && eventPid !== pid) return;
      addOutput(line, stream);
    }).then((fn) => {
      unlisten = fn;
      unlistenRef.current = fn;
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [pid, addOutput]);

  // Listen to runner://exit events
  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | null = null;

    listen<{ pid: number; exit_code: number | null; duration_ms: number }>(
      "runner://exit",
      (event) => {
        if (!mounted) return;
        const { pid: eventPid, exit_code, duration_ms } = event.payload;
        if (pid !== null && eventPid !== pid) return;
        finishRun(exit_code, duration_ms);
      }
    ).then((fn) => {
      unlisten = fn;
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [pid, finishRun]);

  const handleRun = async () => {
    if (!activeDoc) return;
    clearOutput();
    setLanguage(effectiveLanguage);

    const info = `Running ${activeDoc.path} [${effectiveLanguage}]…`;
    addOutput(info, "info");

    try {
      const result = await runFile({
        path: activeDoc.path,
        language: effectiveLanguage,
      });
      startRun(result.pid, effectiveLanguage);
    } catch (err) {
      addOutput(`Failed to start: ${String(err)}`, "stderr");
    }
  };

  const handleStop = async () => {
    if (pid === null) return;
    try {
      await stopRunCmd(pid);
    } catch {
      // process may have already exited
    }
    stopRun();
  };

  const langMeta = getLangMeta(effectiveLanguage);
  const hasActiveFile = activeDoc !== null;

  return (
    <div className="flex flex-col h-full bg-fahh-bg text-fahh-text text-xs font-mono">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-fahh-surface shrink-0 bg-fahh-sidebar">
        {/* Language selector */}
        <span className={`${langMeta.color} text-sm`}>{langMeta.icon}</span>
        <select
          value={effectiveLanguage}
          onChange={(e) => {
            setLanguageOverride(e.target.value);
          }}
          disabled={isRunning}
          className="bg-fahh-surface text-fahh-text border border-fahh-surface rounded px-1 py-0.5 text-xs focus:outline-none focus:border-fahh-accent disabled:opacity-50 cursor-pointer"
        >
          {SUPPORTED_LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {LANGUAGE_META[lang].label}
            </option>
          ))}
        </select>

        {/* Run / Stop */}
        {!isRunning ? (
          <button
            onClick={handleRun}
            disabled={!hasActiveFile}
            title={hasActiveFile ? `Run ${activeDoc?.path}` : "Open a file first"}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-fahh-success text-fahh-bg font-semibold hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>▶</span>
            <span>Run</span>
          </button>
        ) : (
          <button
            onClick={handleStop}
            title="Stop process"
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-fahh-error text-fahh-bg font-semibold hover:opacity-80 transition-opacity"
          >
            <span>■</span>
            <span>Stop</span>
          </button>
        )}

        {/* Running indicator */}
        {isRunning && (
          <span className="text-fahh-warn animate-pulse">● Running (pid {pid})</span>
        )}

        {/* Exit code badge */}
        {!isRunning && exitCode !== null && (
          <span
            className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
              exitCode === 0
                ? "bg-fahh-success/20 text-fahh-success"
                : "bg-fahh-error/20 text-fahh-error"
            }`}
          >
            exit {exitCode} · {durationMs}ms
          </span>
        )}

        <div className="flex-1" />

        {/* Clear */}
        <button
          onClick={clearOutput}
          disabled={output.length === 0}
          className="px-2 py-0.5 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Clear
        </button>
      </div>

      {/* Output area */}
      <div
        ref={outputRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 space-y-0.5"
      >
        {output.length === 0 ? (
          <span className="text-fahh-muted select-none">
            Press ▶ Run to execute the active file.
          </span>
        ) : (
          output.map((item, i) => (
            <div
              key={i}
              className={`leading-5 whitespace-pre-wrap break-all ${
                item.stream === "stderr"
                  ? "text-fahh-error"
                  : item.stream === "info"
                  ? "text-fahh-muted"
                  : "text-fahh-success"
              }`}
            >
              {item.line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
