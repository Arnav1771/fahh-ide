/**
 * Fahh Local: the in-editor coding agent. Replaces the old AI Composer panel.
 *
 * Chat stream, a card per tool call, approval prompts (commands are editable
 * before they run), per-file diff review with revert, Ask / Auto-edit / Plan
 * modes and a provider picker. The agent itself runs in Rust (src-tauri/src/agent).
 * Keys live in this machine's localStorage, like the old panel, and go to the
 * backend only for the request; nothing is written into the project.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Plus, Send, Settings2, Sparkles, Square } from "lucide-react";

import { agentListModels, PROVIDER_PRESETS, settingsProblem, toProviderConfig } from "../../lib/agent";
import { parseSlashCommand, pendingReview } from "../../lib/agentState";
import { calculateContextTokens } from "../../lib/tokenEstimator";
import type { AgentMode } from "../../lib/types";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useAgentStore } from "../../store/agentStore";
import { useEditorStore } from "../../store/editorStore";
import { useFileStore } from "../../store/fileStore";
import { ApprovalCard, PlanCard, ReviewCard, ToolCard } from "./cards";

const MODES: { id: AgentMode; label: string; hint: string }[] = [
  { id: "ask", label: "Ask", hint: "Asks before every edit and command" },
  { id: "auto-edit", label: "Auto-edit", hint: "Edits files freely; still asks before commands" },
  { id: "plan", label: "Plan", hint: "Read-only: researches and writes a plan first" },
];

const SLASH_SUGGESTIONS = [
  { cmd: "/plan", label: "Plan Mode", desc: "Read-only research; writes a plan first" },
  { cmd: "/auto", label: "Auto-edit Mode", desc: "Direct file editing without per-file approval" },
  { cmd: "/ask", label: "Ask Mode", desc: "Interactive; asks for your confirmation on each edit" },
  { cmd: "/undo", label: "Revert Turn", desc: "Revert files touched in the latest turn" },
  { cmd: "/clear", label: "Clear Chat", desc: "Reset and clear conversation history" },
];

const QUICK_ACTIONS = [
  {
    label: "Find Bugs",
    prompt: "Analyze the open file and current diagnostics for any bugs, type errors, or syntax issues.",
  },
  {
    label: "Generate Plan",
    prompt: "/plan Research the open file and write a step-by-step implementation plan.",
  },
  {
    label: "Add Tests",
    prompt: "Write unit tests for the active file.",
  },
  {
    label: "Explain Selection",
    prompt: "Explain the selected code and its purpose in the architecture.",
  },
];

const field = "mt-0.5 w-full bg-fahh-bg border border-fahh-surface rounded px-2 py-1 text-xs text-fahh-text placeholder:text-fahh-muted focus:outline-none focus:border-fahh-accent";

function Settings({ onDone }: { onDone: () => void }) {
  const { settings, updateSettings } = useAgentStore();
  const [models, setModels] = useState<string[]>([]);
  const [modelsMsg, setModelsMsg] = useState<string | null>(null);
  const pick = (id: string) => {
    const p = PROVIDER_PRESETS.find((x) => x.id === id);
    // no default model: models come and go, so the picker asks the provider
    if (p) updateSettings({ provider: id, baseUrl: p.baseUrl || settings.baseUrl, model: "" });
    setModels([]);
    setModelsMsg(null);
  };
  const loadModels = async () => {
    setModelsMsg("Loading…");
    try {
      const ids = await agentListModels(toProviderConfig(settings));
      setModels(ids);
      setModelsMsg(ids.length ? `${ids.length} models` : "The provider listed no models.");
    } catch (e) {
      setModelsMsg(String(e));
    }
  };
  return (
    <div className="p-2 space-y-2 border-b border-fahh-surface text-xs" data-testid="agent-settings">
      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-fahh-muted">Provider</span>
        <select value={settings.provider} onChange={(e) => pick(e.target.value)} className={field}>
          {PROVIDER_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-fahh-muted">Base URL</span>
        <input value={settings.baseUrl} onChange={(e) => updateSettings({ baseUrl: e.target.value })} spellCheck={false} className={field} />
      </label>
      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-fahh-muted">Model</span>
        <div className="flex gap-1">
          <input list="agent-models" value={settings.model} onChange={(e) => updateSettings({ model: e.target.value })} placeholder="pick one, or type a name" spellCheck={false} className={field} />
          <button type="button" onClick={() => void loadModels()} className="mt-0.5 px-2 rounded bg-fahh-surface text-fahh-text hover:bg-fahh-accent/30 shrink-0">Load</button>
        </div>
        <datalist id="agent-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        {modelsMsg && <span className="block mt-0.5 text-[10px] text-fahh-muted break-words" data-testid="models-msg">{modelsMsg}</span>}
      </label>
      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-fahh-muted">API key</span>
        <input type="password" value={settings.apiKey} onChange={(e) => updateSettings({ apiKey: e.target.value })} placeholder="not needed for local Ollama" spellCheck={false} className={field} />
      </label>
      <p className="text-[10px] text-fahh-muted opacity-70 leading-relaxed">
        The key stays in this machine&apos;s localStorage and is sent only to the provider above. It is never written into your project.
      </p>
      <button onClick={onDone} className="w-full py-1 rounded text-xs bg-fahh-accent/90 text-white hover:bg-fahh-accent">Done</button>
    </div>
  );
}

export function AgentPanel() {
  const store = useAgentStore();
  const { settings, items, status, turns } = store;
  const root = useFileStore((s) => s.root);
  const { openFileInEditor } = useWorkspace();
  const problem = settingsProblem(settings);
  const [showSettings, setShowSettings] = useState(!!problem);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const busy = status === "running" || status === "needs_input";

  const activeTab = useEditorStore((s) => s.activeTab);
  const activeContent = useEditorStore((s) => (s.activeTab ? s.fileContents[s.activeTab] : null));

  const tokenBreakdown = useMemo(() => {
    return calculateContextTokens({
      prompt: input,
      activeFileContent: activeContent,
    });
  }, [input, activeContent]);

  const showSlashMenu = input.startsWith("/") && !input.includes(" ");
  const matchingSlashCommands = useMemo(() => {
    if (!showSlashMenu) return [];
    const q = input.toLowerCase();
    return SLASH_SUGGESTIONS.filter((s) => s.cmd.startsWith(q));
  }, [showSlashMenu, input]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, status]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && busy) {
        e.preventDefault();
        void store.stop();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, store]);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    const cmd = parseSlashCommand(text);
    if (cmd && (cmd.type === "clear" || cmd.type === "undo")) {
      setInput("");
      void store.send(text);
      return;
    }
    if (busy) return;
    setInput("");
    void store.send(text);
  };

  const implement = (id: string, path: string) => {
    store.dispatch({ type: "plan_implementing", id });
    void store.send(`Implement the approved plan in ${path}, step by step.`, "ask");
  };

  const review = pendingReview(store);

  return (
    <div className="flex flex-col h-full bg-fahh-sidebar overflow-hidden" data-testid="agent-panel">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-fahh-surface shrink-0">
        <Bot size={13} className="text-fahh-accent" />
        <span className="fahh-label text-[10px] uppercase tracking-widest text-fahh-muted font-semibold">Fahh Local</span>
        <span className="text-[10px] text-fahh-muted" data-testid="agent-status">
          {status === "running" ? "working…" : status === "needs_input" ? "needs your OK" : status === "done" ? "done" : status === "error" ? "error" : ""}
        </span>
        <div className="flex-1" />
        <button onClick={store.newChat} title="New chat" className="text-fahh-muted hover:text-fahh-text"><Plus size={14} /></button>
        <button onClick={() => setShowSettings((s) => !s)} title="Provider and model" className={showSettings ? "text-fahh-accent" : "text-fahh-muted hover:text-fahh-text"}>
          <Settings2 size={13} />
        </button>
      </div>

      <div className="flex gap-1 px-2 py-1.5 border-b border-fahh-surface shrink-0" role="radiogroup" aria-label="Agent mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="radio"
            aria-checked={settings.mode === m.id}
            title={m.hint}
            onClick={() => store.setMode(m.id)}
            className={`flex-1 py-0.5 rounded text-[11px] transition-colors ${settings.mode === m.id ? "bg-fahh-accent/90 text-white" : "bg-fahh-surface text-fahh-muted hover:text-fahh-text"}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {showSettings && <Settings onDone={() => setShowSettings(false)} />}

      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        {items.length === 0 && (
          <div className="px-3 py-3 text-xs text-fahh-muted space-y-1.5">
            {problem ? (
              <p>{problem}</p>
            ) : (
              <p>
                <span className="text-fahh-text">{settings.model}</span> is ready.{" "}
                {root ? "Ask it to read, change or run something in this workspace." : "Open a folder first."}
              </p>
            )}
            <p className="opacity-70">
              {settings.mode === "ask" && "Ask mode: you approve every edit and command."}
              {settings.mode === "auto-edit" && "Auto-edit: edits apply right away (review them after); commands still ask."}
              {settings.mode === "plan" && "Plan mode: read-only. It writes a plan you approve before anything changes."}
            </p>
          </div>
        )}

        {items.map((item, i) => {
          switch (item.kind) {
            case "user":
              return (
                <div key={i} className="px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-fahh-muted mb-0.5">You</div>
                  <div className="text-xs text-fahh-text whitespace-pre-wrap break-words">{item.text}</div>
                </div>
              );
            case "assistant":
              return (
                <div key={i} className="px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-fahh-accent mb-0.5">Fahh Local</div>
                  <div className="text-xs text-fahh-text whitespace-pre-wrap break-words leading-relaxed">{item.text}</div>
                </div>
              );
            case "tool":
              return <ToolCard key={i} item={item} />;
            case "approval":
              return <ApprovalCard key={item.id} item={item} />;
            case "plan":
              return <PlanCard key={i} item={item} onImplement={() => implement(item.id, item.path)} />;
            case "notice":
              return (
                <div key={i} className="px-3 py-1 text-[11px] text-fahh-error break-words" role="alert">{item.text}</div>
              );
          }
        })}

        {status === "running" && <p className="px-3 py-1.5 text-[11px] text-fahh-muted animate-pulse">Working…</p>}

        {review.map((t) => (
          <ReviewCard key={t.turn} turn={t} onOpen={(rel) => root && void openFileInEditor(`${root.replace(/[\\/]+$/, "")}/${rel}`)} />
        ))}
      </div>

      <div className="p-2 border-t border-fahh-surface shrink-0 space-y-1.5">
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5" role="group" aria-label="Quick actions">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={busy}
              onClick={() => {
                if (busy) return;
                void store.send(action.prompt);
              }}
              title={action.prompt}
              className="px-2 py-0.5 rounded-full text-[10px] bg-fahh-surface/80 hover:bg-fahh-accent/20 hover:text-fahh-text text-fahh-muted border border-fahh-surface transition-colors shrink-0 whitespace-nowrap disabled:opacity-40"
              data-testid={`quick-action-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {action.label}
            </button>
          ))}
        </div>
        {showSlashMenu && matchingSlashCommands.length > 0 && (
          <div
            className="rounded border border-fahh-surface bg-[#111318] p-1 shadow-lg space-y-0.5 text-xs animate-in fade-in duration-150"
            data-testid="slash-suggestions"
          >
            <div className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-fahh-muted font-semibold">
              Commands
            </div>
            {matchingSlashCommands.map((s) => (
              <button
                key={s.cmd}
                type="button"
                onClick={() => {
                  if (s.cmd === "/undo" || s.cmd === "/clear") {
                    setInput("");
                    void store.send(s.cmd);
                  } else {
                    setInput(`${s.cmd} `);
                    inputRef.current?.focus();
                  }
                }}
                className="w-full flex items-center justify-between px-2 py-1 rounded text-left hover:bg-fahh-surface/80 text-fahh-text transition-colors group"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-fahh-accent font-semibold">{s.cmd}</span>
                  <span className="text-[11px] text-fahh-text">{s.label}</span>
                </div>
                <span className="text-[10px] text-fahh-muted group-hover:text-fahh-text truncate max-w-[140px]">
                  {s.desc}
                </span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && busy) {
              e.preventDefault();
              void store.stop();
              return;
            }
            if ((e.key === "Enter" && (e.ctrlKey || e.metaKey)) || (e.key === "Enter" && !e.shiftKey)) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask Fahh Local or /plan, /auto, /ask, /undo, /clear… (Ctrl+Enter to send)"
          rows={3}
          disabled={busy}
          className="w-full resize-none bg-fahh-bg border border-fahh-surface rounded px-2 py-1 text-xs text-fahh-text placeholder:text-fahh-muted focus:outline-none focus:border-fahh-accent disabled:opacity-60"
        />
        <div className="flex gap-2">
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="flex-1 flex items-center justify-center gap-1.5 py-1 rounded text-xs font-medium bg-fahh-accent/90 text-white hover:bg-fahh-accent disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send size={12} /> Send
          </button>
          {busy && (
            <button onClick={() => void store.stop()} title="Stop (Escape)" className="px-2 py-1 rounded text-xs text-fahh-muted hover:text-fahh-error">
              <Square size={12} />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between text-[10px] text-fahh-muted">
          <span className="truncate">{settings.model || "no model"} · {turnsLabel(Object.keys(turns).length)}</span>
          <span
            className="shrink-0 px-1.5 py-0.5 rounded bg-fahh-surface/60 font-mono text-[9px] text-fahh-muted hover:text-fahh-text transition-colors cursor-help"
            title={`Context Telemetry:\n• Prompt: ~${tokenBreakdown.promptTokens} tok\n• Active File: ~${tokenBreakdown.activeFileTokens} tok\n• Selection: ~${tokenBreakdown.selectionTokens} tok\nTotal estimated context: ~${tokenBreakdown.totalTokens} tokens`}
            data-testid="context-tokens-badge"
          >
            ~{tokenBreakdown.formatted} tok
          </span>
        </div>
      </div>
    </div>
  );
}

function turnsLabel(n: number): string {
  return n === 0 ? "no turns yet" : `${n} turn${n > 1 ? "s" : ""}`;
}
