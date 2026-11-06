import { useEffect, useMemo, useState } from "react";
import { Code2, Compass, CornerDownLeft, FileText, FolderOpen, ListPlus, PanelLeft, PanelRight, Plus, Search, Send, Settings2, Square, Trash2 } from "lucide-react";

import { Settings } from "../AgentPanel";
import { BypassPill, ComposerExtras, ComposerInput, ModeSwitch, useComposer, type Composer } from "../AgentPanel/composer";
import { Transcript } from "../AgentPanel/Transcript";
import { ModelPicker, useModelList } from "../ModelPicker";
import { Inspector, type InspectorTab } from "./Inspector";
import { useAgentStore } from "../../store/agentStore";
import { useEditorStore } from "../../store/editorStore";
import { useFileStore } from "../../store/fileStore";
import { ensureEditorMode } from "../../store/layoutModeStore";
import { confirmDialog } from "../../store/dialogStore";
import { agentSessionRemove, settingsProblem, type ModelList } from "../../lib/agent";
import { starterPrompts } from "../../lib/agentStarters";
import { pendingFiles, pendingReview, type AgentStatus } from "../../lib/agentState";
import { ago, listSessions } from "../../lib/agentSessionsList";
import { OPEN_FOLDER_EVENT } from "../../lib/commands";
import { revealView } from "../../lib/workbench";
import type { AgentMode as Mode, AgentSessionInfo } from "../../lib/types";

/** Ctrl+Shift+A opens the session search (App owns the palette). */
const SEARCH_EVENT = "fahh-search-sessions";
export const openSessionSearch = () => window.dispatchEvent(new Event(SEARCH_EVENT));
export const onSessionSearch = (fn: () => void) => {
  window.addEventListener(SEARCH_EVENT, fn);
  return () => window.removeEventListener(SEARCH_EVENT, fn);
};

const STATUS: Record<AgentStatus, { label: string; dot: string } | null> = {
  idle: null,
  running: { label: "Working", dot: "bg-fahh-accent animate-pulse motion-reduce:animate-none" },
  needs_input: { label: "Needs your OK", dot: "bg-fahh-warn" },
  done: { label: "Done", dot: "bg-fahh-success" },
  error: { label: "Stopped", dot: "bg-fahh-error" },
};

const MODE_SENTENCE: Record<Mode, string> = {
  ask: "In Ask mode it asks before every edit and command.",
  "auto-edit": "In Edits mode files change right away; commands still ask first.",
  smart: "In Smart mode edits apply right away and a judge model screens each command.",
  plan: "In Plan mode it only reads, then writes a plan for you to approve.",
  bypass: "Bypass is on: edits and commands run without asking.",
  qa: "It answers without changing anything.",
};

const folderName = (root: string) => root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || root;
const focusRing = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-fahh-accent";

function SessionsSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const root = useFileStore((s) => s.root);
  const session = useAgentStore((s) => s.session);
  const status = useAgentStore((s) => s.status);
  const title = useAgentStore((s) => s.title);
  const firstPrompt = useAgentStore((s) => s.items.find((i) => i.kind === "user"));
  const loadSession = useAgentStore((s) => s.loadSession);
  const newChat = useAgentStore((s) => s.newChat);
  const [sessions, setSessions] = useState<AgentSessionInfo[]>([]);

  // A turn that finished (or a new session) changes titles and order.
  useEffect(() => {
    if (status === "running") return;
    let live = true;
    void listSessions().then((s) => live && setSessions(s));
    return () => {
      live = false;
    };
  }, [root, session, status]);

  const remove = async (s: AgentSessionInfo) => {
    if (!root || !(await confirmDialog({ title: `Delete "${s.title || "Untitled"}"?`, message: "The session and its history are removed. This cannot be undone.", ok: "Delete", danger: true }))) return;
    await agentSessionRemove(root, s.id).catch(() => {});
    if (s.id === session) newChat();
    setSessions(await listSessions());
  };

  // The live session is listed before the backend has saved it.
  const current =
    firstPrompt?.kind === "user" && !sessions.some((s) => s.id === session)
      ? { id: session ?? "new", title: title || firstPrompt.text, updated: Date.now(), steps: 0 }
      : null;
  const rows = current ? [current, ...sessions] : sessions;

  return (
    <aside
      className={`w-[248px] shrink-0 flex flex-col bg-fahh-sidebar border-r border-fahh-surface min-h-0 max-[899px]:absolute max-[899px]:inset-y-0 max-[899px]:left-0 max-[899px]:z-30 max-[899px]:shadow-2xl ${open ? "" : "max-[899px]:hidden"}`}
      aria-label="Sessions"
    >
      <div className="p-2 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => {
            newChat();
            onClose();
          }}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-fahh-surface text-[13px] text-fahh-text hover:bg-fahh-surface/60 ${focusRing}`}
        >
          <Plus size={15} aria-hidden="true" /> New session
        </button>
        <button type="button" onClick={openSessionSearch} title="Search sessions (Ctrl+Shift+A)" className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface/60 ${focusRing}`}>
          <Search size={14} className="shrink-0" aria-hidden="true" /> Search
          <span className="ml-auto shrink-0 fahh-kbd">Ctrl+Shift+A</span>
        </button>
      </div>
      <h2 className="px-3.5 pt-3 pb-1 text-[11px] font-medium text-fahh-muted truncate">{root ? `Sessions in ${folderName(root)}` : "Sessions"}</h2>
      <div className="flex-1 overflow-y-auto px-1.5 pb-2" role="list" aria-label="Sessions">
        {!root && <p className="px-2 py-2 text-[12px] leading-5 text-fahh-muted">Open a folder: sessions are saved per folder.</p>}
        {root && rows.length === 0 && <p className="px-2 py-2 text-[12px] leading-5 text-fahh-muted">No sessions yet. Your first prompt starts one.</p>}
        {rows.map((s) => {
          const isCurrent = s === current || (!!session && s.id === session);
          const st = isCurrent ? STATUS[status] : null;
          return (
            <div key={s.id} role="listitem" className={`group relative rounded-md ${isCurrent ? "bg-fahh-surface" : "hover:bg-fahh-surface/50"}`}>
              <button
                type="button"
                onClick={() => {
                  if (s !== current) void loadSession(s.id);
                  onClose();
                }}
                aria-current={isCurrent ? "true" : undefined}
                title={s.title}
                className={`w-full text-left pl-2.5 pr-7 py-2 rounded-md ${focusRing}`}
              >
                <span className={`block text-[13px] leading-5 line-clamp-2 ${isCurrent ? "text-fahh-text" : "text-fahh-text/85"}`}>{s.title || "Untitled"}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fahh-muted">
                  {st && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${st.dot}`} aria-hidden="true" />}
                  {st ? <span className="text-fahh-text/80">{st.label}</span> : <span>{ago(s.updated)}</span>}
                  {s.steps > 0 && <span className="ml-auto">{s.steps} {s.steps === 1 ? "step" : "steps"}</span>}
                </span>
              </button>
              {s !== current && (
                <button
                  type="button"
                  aria-label={`Delete session ${s.title}`}
                  title="Delete session"
                  onClick={() => void remove(s)}
                  className="absolute right-1.5 top-2 p-0.5 rounded text-fahh-muted opacity-0 group-hover:opacity-80 focus-visible:opacity-100 hover:!opacity-100 hover:text-fahh-error"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" onClick={ensureEditorMode} className={`m-2 flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface/60 text-left ${focusRing}`}>
        <Code2 size={14} aria-hidden="true" /> Back to the editor
      </button>
    </aside>
  );
}

/** The start screen: what the agent can do here, and first prompts that fit this folder. */
function EmptyStart({ onPick, onSettings }: { onPick: (prompt: string) => void; onSettings: () => void }) {
  const root = useFileStore((s) => s.root);
  const tree = useFileStore((s) => s.tree);
  const settings = useAgentStore((s) => s.settings);
  const problem = settingsProblem(settings);
  const { stack, prompts } = useMemo(() => starterPrompts((tree?.children ?? []).map((c) => c.name)), [tree]);

  const openFolder = () => {
    ensureEditorMode();
    revealView("explorer");
    window.setTimeout(() => window.dispatchEvent(new Event(OPEN_FOLDER_EVENT)), 0);
  };
  const primary = "inline-flex items-center gap-2 rounded-md bg-fahh-accent text-fahh-bg font-medium hover:opacity-90 fahh-primary";

  return (
    <div className="flex-1 overflow-y-auto min-h-0" data-testid="agent-empty">
      <div className="max-w-[760px] mx-auto px-6 pt-[10vh] pb-8">
        {!root ? (
          <>
            <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-fahh-text">Open a folder to start</h1>
            <p className="mt-3 text-sm leading-6 text-fahh-muted max-w-[60ch]">Fahh Local works inside a folder: it reads, edits and runs things there, and saves its sessions with the folder.</p>
            <button type="button" onClick={openFolder} className={`mt-6 px-3.5 py-2 text-[13px] ${primary}`}>
              <FolderOpen size={15} aria-hidden="true" /> Open folder
            </button>
          </>
        ) : (
          <>
            <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-fahh-text">What should Fahh Local do in {folderName(root)}?</h1>
            <p className="mt-3 text-sm leading-6 text-fahh-muted max-w-[62ch]">
              {stack && `This looks like a ${stack} project. `}It reads and searches the code, edits files and runs commands, and you review every change before you keep it. {MODE_SENTENCE[settings.mode]}
            </p>
            {problem ? (
              <div className="mt-8 flex items-center gap-3 px-4 py-3 rounded-lg border border-fahh-warn/50 bg-fahh-warn/5 text-[13px]" role="alert">
                <span className="flex-1 text-fahh-text">{problem}</span>
                <button type="button" onClick={onSettings} className={`shrink-0 px-3 py-1.5 text-[12px] ${primary}`}>
                  Set up a model
                </button>
              </div>
            ) : (
              <ul className="mt-8 rounded-lg border border-fahh-surface divide-y divide-fahh-surface overflow-hidden" aria-label="Starter prompts">
                {prompts.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      onClick={() => onPick(p)}
                      className="group w-full flex items-center gap-3 px-4 py-3 text-left text-[14px] text-fahh-text hover:bg-fahh-surface/50 focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-fahh-accent"
                      data-testid="starter-prompt"
                    >
                      <span className="flex-1">{p}</span>
                      <CornerDownLeft size={14} className="shrink-0 text-fahh-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-5 text-[12px] leading-5 text-fahh-muted">
              Type <kbd className="fahh-kbd">/</kbd> for commands such as /plan, /loop and /agent, or <kbd className="fahh-kbd">@</kbd> to add a file or the current problems.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** The sticky prompt box: context chips, the text, then mode, model and the send controls in one row. */
function WorkspaceComposer({ c, models }: { c: Composer; models: ModelList }) {
  const { store, status, busy, queue, input, submit, handleSteer, tokenBreakdown } = c;
  const activeTab = useEditorStore((s) => s.activeTab);
  const mentions = useMemo(() => [...new Set([...input.matchAll(/@([\w./\\-]+)/g)].map((m) => m[1]))], [input]);
  const chips = [
    ...(activeTab ? [{ label: activeTab.split(/[\\/]/).pop() ?? activeTab, title: `${activeTab}: the active file and its selection go with every prompt` }] : []),
    ...mentions.map((m) => ({ label: m, title: `@${m}` })),
  ];
  const ghost = "flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] border";

  return (
    <div className="shrink-0 px-6 pb-4 pt-2">
      <div className="max-w-[712px] mx-auto">
        <ComposerExtras c={c} />
        <div className="rounded-xl border border-fahh-surface bg-fahh-sidebar focus-within:border-fahh-accent/70 transition-colors" data-testid="agent-composer">
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1 px-3 pt-2.5" aria-label="Context">
              {chips.map((ch) => (
                <span key={ch.label} title={ch.title} className="inline-flex items-center gap-1 max-w-[220px] px-1.5 py-0.5 rounded bg-fahh-surface/70 text-[11px] text-fahh-muted">
                  <FileText size={11} className="shrink-0" aria-hidden="true" />
                  <span className="truncate font-mono">{ch.label}</span>
                </span>
              ))}
            </div>
          )}
          <ComposerInput
            c={c}
            rows={2}
            className="w-full resize-none bg-transparent px-3.5 pt-2.5 pb-1 text-sm leading-6 text-fahh-text placeholder:text-fahh-muted focus:outline-none focus-visible:outline-none disabled:opacity-60"
          />
          <div className="flex items-center gap-2 px-2.5 pb-2.5 flex-wrap">
            <ModeSwitch />
            <span className="[&_select]:!w-[168px] [&_select]:!text-[11px] [&_input]:!w-[168px] [&_input]:!text-[11px]">
              <ModelPicker id="agent-mode-model" value={store.settings.model} onChange={(model) => store.updateSettings({ model })} list={models} compact />
            </span>
            <span
              className="text-[11px] text-fahh-muted font-mono cursor-help max-[1023px]:hidden"
              title={`Context estimate for this prompt:\n- Prompt: ~${tokenBreakdown.promptTokens} tok\n- Active file: ~${tokenBreakdown.activeFileTokens} tok\n- Selection: ~${tokenBreakdown.selectionTokens} tok\n/context shows the whole session`}
              data-testid="context-tokens-badge"
            >
              ~{tokenBreakdown.formatted} tok
            </span>
            <div className="flex-1" />
            {status === "running" ? (
              <>
                {input.trim() && (
                  <>
                    <button type="button" onClick={() => submit(input)} title="Queue this prompt: it runs when the current turn finishes" className={`${ghost} text-fahh-text border-fahh-surface hover:bg-fahh-surface/60`}>
                      <ListPlus size={13} aria-hidden="true" /> Queue
                    </button>
                    <button type="button" onClick={handleSteer} title="Stop this turn and send this guidance instead (Ctrl+Enter)" className={`${ghost} text-fahh-warn border-fahh-warn/50 hover:bg-fahh-warn/10`}>
                      <Compass size={13} aria-hidden="true" /> Steer
                    </button>
                  </>
                )}
                <button type="button" onClick={() => void store.stop()} title="Stop (Escape)" className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] font-medium text-fahh-text bg-fahh-surface hover:text-fahh-error">
                  <Square size={10} className="fill-current" aria-hidden="true" /> Stop
                </button>
              </>
            ) : (
              <>
                {queue.length > 0 && !busy && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = store.dequeue();
                      if (next) void store.send(next);
                    }}
                    className={`${ghost} text-fahh-accent border-fahh-surface hover:bg-fahh-surface/60`}
                  >
                    Run next ({queue.length})
                  </button>
                )}
                {busy && (
                  <button type="button" onClick={() => void store.stop()} title="Stop (Escape)" aria-label="Stop" className="p-1.5 rounded-md text-fahh-muted hover:text-fahh-error">
                    <Square size={12} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => submit(input)}
                  disabled={busy || !input.trim()}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] font-medium bg-fahh-accent text-fahh-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed fahh-primary"
                >
                  <Send size={12} aria-hidden="true" /> Send
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Agent mode: sessions on the left, the task in the middle, its changes, plan and context on the right. */
export function AgentMode() {
  const c = useComposer(ensureEditorMode);
  const store = c.store;
  const { items, status, settings } = store;
  const wide = () => typeof window !== "undefined" && window.innerWidth >= 1200;
  // Open beside a session on a wide window; an empty session gets the whole width.
  const [inspector, setInspector] = useState<InspectorTab | null>(() => (wide() && items.length > 0 ? "changes" : null));
  const [lastTab, setLastTab] = useState<InspectorTab>("changes");
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [models, reloadModels] = useModelList();
  const waiting = pendingReview(store).reduce((n, t) => n + pendingFiles(t).length, 0);

  const openTab = (t: InspectorTab) => {
    setInspector(t);
    setLastTab(t);
  };
  useEffect(() => {
    if (items.length > 0 && wide()) setInspector((t) => t ?? lastTab);
  }, [items.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  // New changes to review bring the Changes tab forward on a wide window.
  useEffect(() => {
    if (waiting > 0 && wide()) openTab("changes");
  }, [waiting > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // A notebook's Generate code asks for the model settings when none is set up.
  useEffect(() => {
    const show = () => setShowSettings(true);
    window.addEventListener("fahh:agent-settings", show);
    return () => window.removeEventListener("fahh:agent-settings", show);
  }, []);

  const st = STATUS[status];
  const pick = (p: string) => {
    c.setText(p);
    c.inputRef.current?.focus();
  };
  const iconBtn = (on: boolean) => `relative p-1.5 rounded ${focusRing} ${on ? "text-fahh-text bg-fahh-surface/60" : "text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface/60"}`;

  return (
    <div className="fahh-agent-mode relative flex flex-1 min-h-0 overflow-hidden bg-fahh-bg" data-testid="agent-mode">
      <SessionsSidebar open={sessionsOpen} onClose={() => setSessionsOpen(false)} />
      {sessionsOpen && <div className="min-[900px]:hidden absolute inset-0 z-20 bg-fahh-bg/60" onClick={() => setSessionsOpen(false)} aria-hidden="true" />}

      <main className="flex-1 min-w-0 flex flex-col" data-testid="agent-panel">
        <header className="h-11 shrink-0 flex items-center gap-2.5 px-4 border-b border-fahh-surface min-w-0">
          <button type="button" onClick={() => setSessionsOpen(true)} aria-label="Show sessions" title="Sessions" className={`min-[900px]:hidden -ml-1 ${iconBtn(false)}`}>
            <PanelLeft size={16} />
          </button>
          <h2 className="text-[13px] font-medium text-fahh-text truncate min-w-0" title={store.title}>
            {store.title || "New session"}
          </h2>
          {st && (
            <span className="shrink-0 inline-flex items-center gap-1.5 text-[12px] text-fahh-muted" data-testid="agent-status" aria-live="polite">
              <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} aria-hidden="true" />
              {st.label}
            </span>
          )}
          <BypassPill />
          {store.usingFast && settings.fastModel && <span className="shrink-0 text-[11px] text-fahh-muted truncate">Fast model: {settings.fastModel}</span>}
          <div className="flex-1" />
          <button type="button" onClick={() => setShowSettings((s) => !s)} aria-label="Provider and model" aria-pressed={showSettings} title="Provider and model" className={iconBtn(showSettings)}>
            <Settings2 size={15} />
          </button>
          <button
            type="button"
            onClick={() => (inspector ? setInspector(null) : openTab(lastTab))}
            aria-label={inspector ? "Hide changes, plan and context" : "Show changes, plan and context"}
            aria-pressed={!!inspector}
            title="Changes, plan and context"
            className={iconBtn(!!inspector)}
          >
            <PanelRight size={15} />
            {!inspector && waiting > 0 && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-fahh-accent" aria-hidden="true" />}
          </button>
        </header>

        {showSettings && (
          <div className="shrink-0 border-b border-fahh-surface bg-fahh-sidebar max-h-[55vh] overflow-y-auto">
            <div className="max-w-[560px] mx-auto">
              <Settings models={models} reload={reloadModels} onDone={() => setShowSettings(false)} />
            </div>
          </div>
        )}

        {items.length === 0 ? <EmptyStart onPick={pick} onSettings={() => setShowSettings(true)} /> : <Transcript workspace onReview={() => openTab("changes")} />}
        <WorkspaceComposer c={c} models={models} />
      </main>

      {inspector && <Inspector tab={inspector} onTab={openTab} onClose={() => setInspector(null)} />}
    </div>
  );
}
