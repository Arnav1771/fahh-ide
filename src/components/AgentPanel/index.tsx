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
import { ensureEditorMode } from "../../store/layoutModeStore";
import { Bot, Compass, History, ListPlus, Plus, Send, Settings2, ShieldAlert, Square, Trash2, X } from "lucide-react";

import {
  agentListModels,
  baseUrlProblem,
  chatModels,
  endpointOf,
  modelsError,
  presetOf,
  providerNameOf,
  PROVIDER_PRESETS,
  selectPreset,
  settingsProblem,
  showsBaseUrl,
  type CustomEndpoint,
  type ModelList,
} from "../../lib/agent";
import { modelField, ModelPicker, useModelList } from "../ModelPicker";
import { pendingReview } from "../../lib/agentState";
import { calculateContextTokens } from "../../lib/tokenEstimator";
import { filterSlash, groupSlash, insertion, menuQuery, MODE_LABEL, type SlashDef } from "../../lib/slash";
import type { AgentMode } from "../../lib/types";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useAgentStore } from "../../store/agentStore";
import { useEditorStore } from "../../store/editorStore";
import { useFileStore } from "../../store/fileStore";
import { MentionMenu } from "../MentionMenu";
import { ApprovalCard, PlanCard, ReviewCard, SessionsCard, SubCard, ToolCard } from "./cards";
import { ChatMessageContent } from "./ChatMessageContent";
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

const field = modelField;
const fieldBad = field.replace("border-fahh-surface", "border-fahh-error");
const label = "block text-[11px] text-fahh-muted";

function Settings({ models, reload, onDone }: { models: ModelList; reload: () => void; onDone: () => void }) {
  const { settings, updateSettings } = useAgentStore();
  const [adding, setAdding] = useState<Omit<CustomEndpoint, "id"> | null>(null);
  const [addMsg, setAddMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [urlTouched, setUrlTouched] = useState(false);
  const saved = endpointOf(settings);
  const preset = presetOf(settings.provider);
  const providerName = providerNameOf(settings);
  const urlError = baseUrlProblem(settings.baseUrl);

  /** Settings edits on a saved endpoint update the endpoint too. */
  const patch = (p: Partial<typeof settings>) => {
    if (saved && (p.baseUrl !== undefined || p.apiKey !== undefined)) {
      const endpoints = settings.endpoints.map((e) => (e.id === saved.id ? { ...e, baseUrl: p.baseUrl ?? e.baseUrl, apiKey: p.apiKey ?? e.apiKey } : e));
      updateSettings({ ...p, endpoints });
    } else updateSettings(p);
  };

  const saveEndpoint = async (force = false) => {
    if (!adding) return;
    const ep = { ...adding, name: adding.name.trim() || "My endpoint", baseUrl: adding.baseUrl.trim() };
    const bad = baseUrlProblem(ep.baseUrl);
    if (bad) return setAddMsg({ text: bad });
    let ids: string[] = [];
    if (!force) {
      setAddMsg({ text: "Checking the endpoint…" });
      try {
        ids = chatModels(await agentListModels({ kind: ep.kind, base_url: ep.baseUrl, model: "", api_key: ep.apiKey.trim() || null }));
      } catch (e) {
        return setAddMsg({ text: `Could not list models: ${modelsError(e)}` });
      }
    }
    const id = Date.now().toString(36);
    updateSettings({ endpoints: [...settings.endpoints, { id, ...ep }], provider: `ep:${id}`, baseUrl: ep.baseUrl, apiKey: ep.apiKey, model: ids[0] ?? "", fastModel: "" });
    setAdding(null);
    setAddMsg(null);
  };

  const removeEndpoint = () => {
    if (!saved) return;
    updateSettings({ endpoints: settings.endpoints.filter((e) => e.id !== saved.id), ...selectPreset(PROVIDER_PRESETS[0].id), apiKey: "" });
  };

  const pick = (id: string) => {
    setUrlTouched(false);
    if (id === "__add") {
      setAdding({ name: "", baseUrl: "", apiKey: "", kind: "openai" });
      setAddMsg(null);
      return;
    }
    const ep = settings.endpoints.find((e) => `ep:${e.id}` === id);
    if (ep) return updateSettings({ provider: id, baseUrl: ep.baseUrl, apiKey: ep.apiKey, model: "", fastModel: "" });
    const p = selectPreset(id);
    if (p) updateSettings(p);
  };

  return (
    <div className="p-2 space-y-2.5 border-b border-fahh-surface text-xs" data-testid="agent-settings">
      <label className={label}>
        Provider
        <select value={adding ? "__add" : settings.provider} onChange={(e) => pick(e.target.value)} className={field} data-testid="agent-provider">
          {PROVIDER_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
          {settings.endpoints.length > 0 && (
            <optgroup label="Your endpoints">
              {settings.endpoints.map((e) => (
                <option key={e.id} value={`ep:${e.id}`}>{e.name}</option>
              ))}
            </optgroup>
          )}
          <option value="__add">+ Save a named endpoint…</option>
        </select>
      </label>
      {adding && (
        <div className="space-y-1.5 rounded border border-fahh-accent/40 p-2" data-testid="add-endpoint">
          <span className="block text-[11px] font-medium text-fahh-text">New endpoint</span>
          <input value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder="Name, e.g. Work LLM" aria-label="Endpoint name" className={field} />
          <input type="url" value={adding.baseUrl} onChange={(e) => setAdding({ ...adding, baseUrl: e.target.value })} placeholder="Base URL, e.g. https://llm.example.com/v1" aria-label="Endpoint base URL" spellCheck={false} className={field} />
          <input type="password" autoComplete="off" value={adding.apiKey} onChange={(e) => setAdding({ ...adding, apiKey: e.target.value })} placeholder="API key (optional)" aria-label="Endpoint API key" spellCheck={false} className={field} />
          <select value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value as CustomEndpoint["kind"] })} aria-label="Endpoint type" className={field}>
            <option value="openai">OpenAI-compatible (/v1/chat/completions, /v1/models)</option>
            <option value="anthropic">Anthropic Messages API</option>
          </select>
          {addMsg && <span className="block text-[11px] text-fahh-muted break-words" role="status">{addMsg.text}</span>}
          <div className="flex gap-1">
            <button type="button" onClick={() => void saveEndpoint()} className="flex-1 py-1 rounded bg-fahh-accent/90 text-white hover:bg-fahh-accent">Save and load models</button>
            {addMsg?.text.startsWith("Could not") && (
              <button type="button" onClick={() => void saveEndpoint(true)} className="px-2 py-1 rounded bg-fahh-surface text-fahh-text">Save anyway</button>
            )}
            <button type="button" onClick={() => { setAdding(null); setAddMsg(null); }} className="px-2 py-1 rounded bg-fahh-surface text-fahh-text">Cancel</button>
          </div>
        </div>
      )}
      {showsBaseUrl(settings.provider) && (
        <div>
          <label className={label}>
            Base URL
            <input
              type="url"
              value={settings.baseUrl}
              onChange={(e) => patch({ baseUrl: e.target.value })}
              onBlur={() => setUrlTouched(true)}
              placeholder="https://llm.example.com/v1"
              aria-invalid={!!urlError && (urlTouched || !!settings.baseUrl)}
              aria-describedby="agent-url-msg"
              spellCheck={false}
              className={urlError && (urlTouched || settings.baseUrl) ? fieldBad : field}
              data-testid="agent-base-url"
            />
          </label>
          {urlError && (urlTouched || settings.baseUrl) && <span id="agent-url-msg" className="block mt-0.5 text-[11px] text-fahh-error">{urlError}</span>}
          {saved && (
            <button type="button" onClick={removeEndpoint} className="mt-1 text-[11px] text-fahh-muted hover:text-fahh-error underline">
              Remove “{saved.name}”
            </button>
          )}
        </div>
      )}
      <label className={label}>
        API key
        <input
          type="password"
          autoComplete="off"
          value={settings.apiKey}
          onChange={(e) => patch({ apiKey: e.target.value })}
          placeholder={saved ? "Optional" : preset?.keyHint ?? "Optional"}
          spellCheck={false}
          className={field}
          data-testid="agent-api-key"
        />
      </label>
      <div>
        <label htmlFor="agent-model" className={label}>Model</label>
        <ModelPicker id="agent-model" value={settings.model} onChange={(model) => updateSettings({ model })} list={models} status={{ providerName, reload }} />
      </div>
      <div>
        <label htmlFor="agent-fast-model" className={label}>
          Fast model <span className="opacity-70">· optional, for /fast and Smart-mode checks</span>
        </label>
        <ModelPicker id="agent-fast-model" value={settings.fastModel} onChange={(fastModel) => updateSettings({ fastModel })} list={models} optional />
      </div>
      {preset && !showsBaseUrl(settings.provider) && (
        <details className="text-[11px] text-fahh-muted" data-testid="edit-endpoint">
          <summary className="cursor-pointer select-none hover:text-fahh-text">
            Edit endpoint{settings.baseUrl.trim() !== preset.baseUrl && " (changed)"}
          </summary>
          <div className="mt-1 space-y-1">
            <input type="url" value={settings.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} aria-label={`${preset.label} base URL`} spellCheck={false} className={urlError ? fieldBad : field} />
            {urlError && <span className="block text-fahh-error">{urlError}</span>}
            <span className="block">For a proxy in front of {preset.label}.</span>
            {settings.baseUrl.trim() !== preset.baseUrl && (
              <button type="button" onClick={() => patch({ baseUrl: preset.baseUrl })} className="underline hover:text-fahh-text">Reset to {preset.baseUrl}</button>
            )}
          </div>
        </details>
      )}
      <p className="text-[11px] text-fahh-muted opacity-80">Your key stays in this machine&apos;s localStorage and goes only to {providerName}.</p>
      <button onClick={onDone} className="w-full py-1 rounded text-xs bg-fahh-accent/90 text-white hover:bg-fahh-accent font-medium focus-visible:outline focus-visible:outline-1 focus-visible:outline-fahh-text">Done</button>
    </div>
  );
}

export function AgentPanel({ onClose }: { onClose?: () => void }) {
  const store = useAgentStore();
  const { settings, items, status, turns, queue, enqueue, removeQueueItem, clearQueue, steer } = store;
  const root = useFileStore((s) => s.root);
  const { openFileInEditor } = useWorkspace();
  const problem = settingsProblem(settings);
  const [showSettings, setShowSettings] = useState(!!problem);
  // A notebook's Generate code sends people here when no model is set up.
  useEffect(() => {
    const show = () => setShowSettings(true);
    window.addEventListener("fahh:agent-settings", show);
    return () => window.removeEventListener("fahh:agent-settings", show);
  }, []);
  // a fresh provider (or a model the user cleared) takes the provider's preferred live model
  const [models, reloadModels] = useModelList();
  const [input, setInput] = useState("");
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
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

  const [showMention, setShowMention] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");

  // the "/" menu: open while the whole input is a single /word
  const query = menuQuery(input);
  const menuItems = useMemo(() => (query === null ? [] : groupSlash(filterSlash(query)).flatMap((g) => g.items)), [query]);
  const menuOpen = query !== null && !menuClosed;

  const setText = (v: string) => {
    setInput(v);
    setMenuIndex(0);
    setMenuClosed(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    const lastAt = val.lastIndexOf("@");
    if (lastAt !== -1 && lastAt >= val.length - 15) {
      const q = val.slice(lastAt + 1);
      if (!q.includes(" ")) {
        setShowMention(true);
        setMentionQuery(q);
        return;
      }
    }
    setShowMention(false);
  };

  const handleSelectMention = (label: string) => {
    setShowMention(false);
    const lastAt = input.lastIndexOf("@");
    const prefix = lastAt !== -1 ? input.slice(0, lastAt) : input;
    setInput(`${prefix}${label} `);
    inputRef.current?.focus();
  };

  const submit = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setText("");
    setShowMention(false);
    if (t.startsWith("/")) return void store.handleInput(t); // commands may run mid-turn
    if (status === "running") return enqueue(t); // runs when the current turn finishes
    if (busy) return setText(t); // waiting on an approval: keep what was typed
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

  const handleSteer = () => {
    const text = input.trim();
    if (!text) return;
    setText("");
    void steer(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Up/Down at the start/end of the box walks through this session's earlier prompts.
    if (!(menuOpen && menuItems.length > 0) && (e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey) {
      const ta = e.currentTarget;
      const past = items.filter((i): i is { kind: "user"; text: string } => i.kind === "user").map((i) => i.text);
      const atEdge = e.key === "ArrowUp" ? ta.selectionStart === 0 && ta.selectionEnd === 0 : ta.selectionStart === ta.value.length;
      if (past.length && atEdge && (e.key === "ArrowUp" || historyIdx !== null)) {
        e.preventDefault();
        const idx = e.key === "ArrowUp" ? Math.max(0, (historyIdx ?? past.length) - 1) : (historyIdx ?? past.length) + 1;
        if (idx >= past.length) {
          setHistoryIdx(null);
          setText("");
        } else {
          setHistoryIdx(idx);
          setText(past[idx]);
        }
        return;
      }
    }
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
    if (e.key === "Escape" && (menuOpen || showMention)) {
      e.preventDefault();
      e.stopPropagation(); // closing a menu must not also stop the running turn
      setShowMention(false);
      return setMenuClosed(true);
    }
    if (e.key === "Enter" && status === "running" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      return handleSteer();
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
      <div className="flex items-center gap-1 px-2 py-2 border-b border-fahh-surface shrink-0 min-w-0">
        <Bot size={13} className="text-fahh-accent shrink-0" />
        <span className="fahh-label text-[10px] uppercase tracking-widest text-fahh-muted font-semibold whitespace-nowrap truncate min-w-0" title="Fahh Local">Fahh Local</span>
        <span className="text-[10px] text-fahh-muted truncate min-w-0" data-testid="agent-status" title={store.title}>
          {status === "running" ? "working…" : status === "needs_input" ? "needs your OK" : status === "done" ? "done" : status === "error" ? "error" : store.title}
        </span>
        <div className="flex-1" />
        <ModelPicker id="agent-header-model" value={settings.model} onChange={(model) => store.updateSettings({ model })} list={models} compact />
        <button onClick={store.newChat} title="New session (/clear)" aria-label="New session" className="shrink-0 text-fahh-muted hover:text-fahh-text"><Plus size={14} /></button>
        <button onClick={() => void store.handleInput("/ls")} title="Saved sessions (/ls)" aria-label="Saved sessions" className="shrink-0 text-fahh-muted hover:text-fahh-text"><History size={13} /></button>
        <button onClick={() => setShowSettings((s) => !s)} title="Provider and model" aria-label="Provider and model" className={`shrink-0 ${showSettings ? "text-fahh-accent" : "text-fahh-muted hover:text-fahh-text"}`}>
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

      {showSettings && <Settings models={models} reload={reloadModels} onDone={() => setShowSettings(false)} />}

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
                <div key={i} className="px-2 py-1.5 select-text">
                  <div className="text-[10px] uppercase tracking-wider text-fahh-muted mb-0.5 select-none">You</div>
                  <div className="text-xs text-fahh-text whitespace-pre-wrap break-words select-text cursor-text selection:bg-fahh-accent/30">{item.text}</div>
                </div>
              );
            case "assistant":
              return (
                <div key={i} className="px-2 py-1.5 select-text">
                  <div className="text-[10px] uppercase tracking-wider text-fahh-accent mb-0.5 select-none">Fahh Local</div>
                  <ChatMessageContent text={item.text} />
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

        {status === "running" && (
          <div className="mx-2 my-1.5 flex items-center gap-1.5 text-[11px] text-fahh-muted" data-testid="agent-run-status" aria-live="polite">
            <span className="w-1.5 h-1.5 rounded-full bg-fahh-accent animate-pulse shrink-0" />
            <span className="truncate">{runStatus(items)}</span>
          </div>
        )}

        {review.map((t) => (
          <ReviewCard key={t.turn} turn={t} onOpen={(rel) => root && (ensureEditorMode(), void openFileInEditor(`${root.replace(/[\\/]+$/, "")}/${rel}`))} />
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
        {queue.length > 0 && (
          <div className="mb-1.5 p-2 rounded-lg bg-fahh-surface/80 border border-fahh-surface space-y-1.5" data-testid="prompt-queue">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-semibold text-fahh-accent uppercase tracking-wider flex items-center gap-1">
                <ListPlus size={11} />
                Prompt Queue ({queue.length})
              </span>
              <button type="button" onClick={clearQueue} className="text-fahh-muted hover:text-fahh-error text-[9.5px] flex items-center gap-0.5 transition-colors">
                <Trash2 size={10} /> Clear
              </button>
            </div>
            <div className="space-y-1 max-h-24 overflow-y-auto no-scrollbar">
              {queue.map((q, idx) => (
                <div key={idx} className="flex items-center justify-between gap-1.5 px-2 py-1 rounded bg-fahh-bg text-[11px] text-fahh-text/90 border border-fahh-surface/60">
                  <span className="text-[10px] text-fahh-accent font-mono shrink-0 font-semibold">#{idx + 1}</span>
                  <span className="truncate flex-1 select-text cursor-text">{q}</span>
                  <button type="button" onClick={() => removeQueueItem(idx)} title="Remove prompt from queue" className="text-fahh-muted hover:text-fahh-error shrink-0 p-0.5">
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="relative">
          {showMention && <MentionMenu query={mentionQuery} onSelect={handleSelectMention} onClose={() => setShowMention(false)} />}
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={onKeyDown}
            placeholder={
              status === "running"
                ? "Running… Enter queues the next prompt, Ctrl+Enter steers this one, / runs a command"
                : "Ask Fahh Local, @ for files and problems, / for commands (Enter to send)"
            }
            rows={3}
            disabled={status === "needs_input"}
            aria-label="Message or slash command"
            aria-expanded={menuOpen}
            className="w-full resize-none bg-fahh-bg border border-fahh-surface rounded px-2 py-1 text-xs text-fahh-text placeholder:text-fahh-muted focus:outline-none focus:border-fahh-accent disabled:opacity-60"
          />
        </div>
        <div className="flex gap-2">
          {status === "running" ? (
            <>
              <button
                onClick={() => submit(input)}
                disabled={!input.trim()}
                title="Queue this prompt: it runs when the current turn finishes"
                className="flex-1 flex items-center justify-center gap-1.5 py-1 rounded text-xs font-medium bg-fahh-surface text-fahh-accent hover:bg-fahh-accent/20 border border-fahh-accent/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ListPlus size={12} /> Queue
              </button>
              <button
                onClick={handleSteer}
                disabled={!input.trim()}
                title="Stop this turn and send this guidance instead (Ctrl+Enter)"
                className="flex-1 flex items-center justify-center gap-1.5 py-1 rounded text-xs font-medium bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Compass size={12} /> Steer
              </button>
              <button
                onClick={() => void store.stop()}
                title="Stop (Escape)"
                className="px-2.5 py-1 rounded text-xs text-fahh-muted hover:text-fahh-error bg-fahh-surface/60 hover:bg-fahh-surface border border-fahh-surface transition-colors"
              >
                <Square size={12} />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => submit(input)}
                disabled={busy || !input.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 py-1 rounded text-xs font-medium bg-fahh-accent/90 text-white hover:bg-fahh-accent disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send size={12} /> Send
              </button>
              {queue.length > 0 && !busy && (
                <button
                  type="button"
                  onClick={() => {
                    const next = store.dequeue();
                    if (next) void store.send(next);
                  }}
                  title="Run the next queued prompt now"
                  className="px-2.5 py-1 rounded text-xs bg-fahh-surface hover:bg-fahh-accent/20 text-fahh-accent font-medium border border-fahh-surface transition-colors"
                >
                  Run Next ({queue.length})
                </button>
              )}
              {busy && (
                <button onClick={() => void store.stop()} title="Stop (Escape)" className="px-2 py-1 rounded text-xs text-fahh-muted hover:text-fahh-error">
                  <Square size={12} />
                </button>
              )}
            </>
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

/** What the running turn is doing right now, from its own events: tools and subagents still running. */
function runStatus(items: ReturnType<typeof useAgentStore.getState>["items"]): string {
  const tools = items.filter((i) => i.kind === "tool" && i.status === "running").map((i) => (i.kind === "tool" ? i.name : ""));
  const subs = items.filter((i) => i.kind === "sub" && i.status === "running").map((i) => (i.kind === "sub" ? i.name : ""));
  if (subs.length) return `Subagent${subs.length > 1 ? "s" : ""} running: ${subs.join(", ")}`;
  if (tools.length) return `Running ${tools.join(", ")}…`;
  return "Waiting for the model…";
}
