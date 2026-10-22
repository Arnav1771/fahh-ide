/**
 * Fahh Local: the in-editor coding agent. One self-contained component: mount
 * `<AgentPanel onClose={...} />` wherever a dockable view goes; it owns its state
 * in `useAgentStore` and needs nothing from the host except an optional close handler
 * (what /exit does).
 *
 * Chat stream, a card per tool call and per subagent, approval prompts (commands
 * are editable before they run), per-file diff review with revert, permission
 * modes, a "/" command menu, saved sessions and a provider picker. The agent runs
 * in Rust (src-tauri/src/agent). Keys live in this machine's localStorage and go
 * to the backend only for the request; nothing is written into the project.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Plus, Send, Settings2, ShieldAlert, Square } from "lucide-react";

import { agentListModels, PROVIDER_PRESETS, settingsProblem, toProviderConfig } from "../../lib/agent";
import { pendingReview } from "../../lib/agentState";
import { calculateContextTokens } from "../../lib/tokenEstimator";
import { filterSlash, groupSlash, insertion, menuQuery, MODE_LABEL, type SlashDef } from "../../lib/slash";
import type { AgentMode } from "../../lib/types";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useAgentStore } from "../../store/agentStore";
import { useEditorStore } from "../../store/editorStore";
import { useFileStore } from "../../store/fileStore";
import { ApprovalCard, PlanCard, ReviewCard, SessionsCard, SubCard, ToolCard } from "./cards";
import { SlashMenu } from "./SlashMenu";

const MODES: { id: AgentMode; label: string; hint: string }[] = [
  { id: "ask", label: "Ask", hint: "Normal: asks before every edit and command" },
  { id: "auto-edit", label: "Edits", hint: "Accept edits: files change right away; commands still ask" },
  { id: "smart", label: "Smart", hint: "Edits auto-approved; a judge model screens each command, unsafe ones ask" },
  { id: "plan", label: "Plan", hint: "Read-only: researches and writes a plan first" },
  { id: "bypass", label: "Bypass", hint: "Auto-approves every prompt. Deny rules still apply" },
];

/** One-click prompts above the input. A prompt starting with "/" runs as that slash command. */
const QUICK_ACTIONS = [
  { label: "Find Bugs", prompt: "Analyze the open file and current diagnostics for any bugs, type errors, or syntax issues." },
  { label: "Generate Plan", prompt: "/plan Research the open file and write a step-by-step implementation plan." },
  { label: "Add Tests", prompt: "Write unit tests for the active file." },
  { label: "Explain Selection", prompt: "Explain the selected code and its purpose in the architecture." },
];

const field = "mt-0.5 w-full bg-fahh-bg border border-fahh-surface rounded px-2 py-1 text-xs text-fahh-text placeholder:text-fahh-muted focus:outline-none focus:border-fahh-accent";

function Settings({ onDone }: { onDone: () => void }) {
  const { settings, updateSettings } = useAgentStore();
  const [models, setModels] = useState<string[]>([]);
  const [modelsMsg, setModelsMsg] = useState<string | null>(null);
  const pick = (id: string) => {
    const p = PROVIDER_PRESETS.find((x) => x.id === id);
    // no default model: models come and go, so the picker asks the provider
    if (p) updateSettings({ provider: id, baseUrl: p.baseUrl || settings.baseUrl, model: "", fastModel: "" });
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
        <span className="text-[10px] uppercase tracking-wider text-fahh-muted">Fast model (optional)</span>
        <input list="agent-models" value={settings.fastModel} onChange={(e) => updateSettings({ fastModel: e.target.value })} placeholder="for /fast and Smart-mode judging" spellCheck={false} className={field} />
      </label>
      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-fahh-muted">API key</span>
        <input type="password" value={settings.apiKey} onChange={(e) => updateSettings({ apiKey: e.target.value })} placeholder="not needed for local Ollama" spellCheck={false} className={field} />
      </label>
      <p className="text-[10px] text-fahh-muted opacity-70 leading-relaxed">
        The key stays in this machine&apos;s localStorage (there is no OS keychain yet) and is sent only to the provider above. It is never written into your project.
      </p>
      <button onClick={onDone} className="w-full py-1 rounded text-xs bg-fahh-accent/90 text-white hover:bg-fahh-accent">Done</button>
    </div>
  );
}

export function AgentPanel({ onClose }: { onClose?: () => void }) {
  const store = useAgentStore();
  const { settings, items, status, turns } = store;
  const root = useFileStore((s) => s.root);
  const { openFileInEditor } = useWorkspace();
  const problem = settingsProblem(settings);
  const [showSettings, setShowSettings] = useState(!!problem);
  const [input, setInput] = useState("");
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuClosed, setMenuClosed] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const busy = status === "running" || status === "needs_input";

  // what the next prompt would carry, estimated (the same heuristic the backend uses)
  const activeContent = useEditorStore((s) => (s.activeTab ? s.fileContents[s.activeTab] : null));
  const tokenBreakdown = useMemo(() => calculateContextTokens({ prompt: input, activeFileContent: activeContent }), [input, activeContent]);

  // Escape stops a running turn (when it is not closing the "/" menu: that one stops propagation)
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && busy) {
        e.preventDefault();
        void store.stop();
      }
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [busy, store]);

  useEffect(() => {
    useAgentStore.setState({ onExit: onClose ?? null });
    return () => useAgentStore.setState({ onExit: null });
  }, [onClose]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, status]);

  // the "/" menu: open while the whole input is a single /word
  const query = menuQuery(input);
  const menuItems = useMemo(() => (query === null ? [] : groupSlash(filterSlash(query)).flatMap((g) => g.items)), [query]);
  const menuOpen = query !== null && !menuClosed;

  const setText = (v: string) => {
    setInput(v);
    setMenuIndex(0);
    setMenuClosed(false);
  };

  const submit = (text: string) => {
    const t = text.trim();
    if (!t) return;
    if (busy && !t.startsWith("/")) return; // prompts wait for the turn; commands may still run
    setText("");
    void store.handleInput(t);
  };

  const pick = (d: SlashDef) => {
    // "Enter runs": a command that needs no argument, or only an optional one, runs now;
    // one that needs an argument is filled in for the user to complete
    if (!d.args || d.args.startsWith("[")) submit(`/${d.name}`);
    else {
      setText(insertion(d));
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen && menuItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        return setMenuIndex((i) => (i + 1) % menuItems.length);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        return setMenuIndex((i) => (i - 1 + menuItems.length) % menuItems.length);
      }
      if (e.key === "Tab") {
        e.preventDefault();
        return setText(insertion(menuItems[menuIndex]));
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        return pick(menuItems[menuIndex]);
      }
    }
    if (e.key === "Escape" && menuOpen) {
      e.preventDefault();
      e.stopPropagation(); // closing the menu must not also stop the running turn
      return setMenuClosed(true);
    }
    if (e.key === "Enter" && (!e.shiftKey || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit(input);
    }
  };

  const implement = (id: string, path: string) => {
    store.dispatch({ type: "plan_implementing", id });
    void store.send(`Implement the approved plan in ${path}, step by step.`, { mode: "ask" });
  };

  const review = pendingReview(store);

  return (
    <div className="flex flex-col h-full bg-fahh-sidebar overflow-hidden" data-testid="agent-panel">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-fahh-surface shrink-0">
        <Bot size={13} className="text-fahh-accent" />
        <span className="fahh-label text-[10px] uppercase tracking-widest text-fahh-muted font-semibold">Fahh Local</span>
        <span className="text-[10px] text-fahh-muted truncate min-w-0" data-testid="agent-status" title={store.title}>
          {status === "running" ? "working…" : status === "needs_input" ? "needs your OK" : status === "done" ? "done" : status === "error" ? "error" : store.title}
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
            className={`flex-1 py-0.5 rounded text-[11px] transition-colors ${
              settings.mode === m.id ? (m.id === "bypass" ? "bg-red-600 text-white" : "bg-fahh-accent/90 text-white") : "bg-fahh-surface text-fahh-muted hover:text-fahh-text"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {settings.mode === "bypass" && (
        <div role="alert" data-testid="bypass-badge" className="flex items-start gap-1.5 px-2.5 py-1 bg-red-950/60 border-b border-red-500/40 text-[11px] text-red-200 shrink-0">
          <ShieldAlert size={13} className="mt-[1px] shrink-0 text-red-400" />
          <span>BYPASS: every prompt is auto-approved. Deny rules still block what they name.</span>
        </div>
      )}
      {store.usingFast && settings.fastModel && (
        <div className="px-2.5 py-0.5 border-b border-fahh-surface text-[10px] text-fahh-muted shrink-0">Fast model on: {settings.fastModel} (/fast to switch back)</div>
      )}

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
              Mode: {MODE_LABEL[settings.mode]}. Type <span className="font-mono">/</span> for commands: modes, sessions, /loop, subagents.
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
            case "sub":
              return <SubCard key={item.child} item={item} />;
            case "plan":
              return <PlanCard key={i} item={item} onImplement={() => implement(item.id, item.path)} />;
            case "sessions":
              return <SessionsCard key={i} item={item} />;
            case "notice":
              return (
                <div key={i} className={`px-3 py-1 text-[11px] break-words whitespace-pre-wrap ${item.level === "error" ? "text-fahh-error" : "text-fahh-muted"}`} role={item.level === "error" ? "alert" : undefined}>
                  {item.text}
                </div>
              );
          }
        })}

        {status === "running" && <p className="px-3 py-1.5 text-[11px] text-fahh-muted animate-pulse">Working…</p>}

        {review.map((t) => (
          <ReviewCard key={t.turn} turn={t} onOpen={(rel) => root && void openFileInEditor(`${root.replace(/[\\/]+$/, "")}/${rel}`)} />
        ))}
      </div>

      <div className="p-2 border-t border-fahh-surface shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto pb-1" role="group" aria-label="Quick actions">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.label}
              type="button"
              disabled={busy}
              onClick={() => void store.handleInput(a.prompt)}
              title={a.prompt}
              data-testid={`quick-action-${a.label.toLowerCase().replace(/\s+/g, "-")}`}
              className="px-2 py-0.5 rounded-full text-[10px] bg-fahh-surface/80 hover:bg-fahh-accent/20 hover:text-fahh-text text-fahh-muted border border-fahh-surface transition-colors shrink-0 whitespace-nowrap disabled:opacity-40"
            >
              {a.label}
            </button>
          ))}
        </div>
        {menuOpen && (
          <div data-testid="slash-suggestions">
            <SlashMenu items={menuItems} index={menuIndex} onPick={pick} onHover={setMenuIndex} />
          </div>
        )}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask Fahh Local, or type / for commands… (Enter or Ctrl+Enter to send)"
          rows={3}
          aria-label="Message or slash command"
          aria-expanded={menuOpen}
          className="w-full resize-none bg-fahh-bg border border-fahh-surface rounded px-2 py-1 text-xs text-fahh-text placeholder:text-fahh-muted focus:outline-none focus:border-fahh-accent disabled:opacity-60"
        />
        <div className="flex gap-2 mt-1.5">
          <button
            onClick={() => submit(input)}
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
        <div className="mt-1 flex items-center justify-between text-[10px] text-fahh-muted">
          <span className="truncate">{settings.model || "no model"} · {turnsLabel(Object.keys(turns).length)}</span>
          <span
            className="shrink-0 px-1.5 py-0.5 rounded bg-fahh-surface/60 font-mono text-[9px] text-fahh-muted hover:text-fahh-text transition-colors cursor-help"
            title={`Context estimate:\n- Prompt: ~${tokenBreakdown.promptTokens} tok\n- Active file: ~${tokenBreakdown.activeFileTokens} tok\n- Selection: ~${tokenBreakdown.selectionTokens} tok\nTotal: ~${tokenBreakdown.totalTokens} tokens (/context shows the whole session)`}
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
