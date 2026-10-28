import { useEffect, useState } from "react";
import { MessageSquare, Plus, Search, Trash2 } from "lucide-react";
import { AgentPanel } from "../AgentPanel";
import { useAgentStore } from "../../store/agentStore";
import { useFileStore } from "../../store/fileStore";
import { ensureEditorMode } from "../../store/layoutModeStore";
import { agentSessionRemove } from "../../lib/agent";
import { ago, listSessions } from "../../lib/agentSessionsList";
import { confirmDialog } from "../../store/dialogStore";
import type { AgentSessionInfo } from "../../lib/types";

/** Ctrl+Shift+A opens the session search (App owns the palette). */
const SEARCH_EVENT = "fahh-search-sessions";
export const openSessionSearch = () => window.dispatchEvent(new Event(SEARCH_EVENT));
export const onSessionSearch = (fn: () => void) => {
  window.addEventListener(SEARCH_EVENT, fn);
  return () => window.removeEventListener(SEARCH_EVENT, fn);
};

/** Agent mode: sessions on the left, the conversation filling the window. */
export function AgentMode() {
  const root = useFileStore((s) => s.root);
  const session = useAgentStore((s) => s.session);
  const status = useAgentStore((s) => s.status);
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

  return (
    <div className="fahh-agent-mode flex flex-1 min-h-0 overflow-hidden" data-testid="agent-mode">
      <aside className="w-64 shrink-0 flex flex-col bg-fahh-sidebar border-r border-fahh-surface min-h-0">
        <div className="p-2 flex flex-col gap-1 border-b border-fahh-surface">
          <button
            onClick={() => newChat()}
            className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-fahh-text hover:bg-fahh-surface"
          >
            <Plus size={15} /> New session
          </button>
          <button
            onClick={openSessionSearch}
            className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface"
          >
            <Search size={14} /> Search sessions
            <span className="ml-auto text-[10px] font-mono opacity-70">Ctrl+Shift+A</span>
          </button>
        </div>
        <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wide text-fahh-muted font-semibold">Sessions</div>
        <div className="flex-1 overflow-y-auto pb-2" role="list" aria-label="Sessions">
          {!root && <p className="px-3 py-2 text-xs text-fahh-muted">Open a folder: sessions are saved per folder.</p>}
          {root && sessions.length === 0 && <p className="px-3 py-2 text-xs text-fahh-muted">No sessions yet. Ask Fahh Local something to start one.</p>}
          {sessions.map((s) => (
            <div
              key={s.id}
              role="listitem"
              className={`group mx-1 px-2 py-1.5 rounded cursor-pointer ${s.id === session ? "bg-fahh-surface text-fahh-text" : "text-fahh-muted hover:bg-fahh-surface/60 hover:text-fahh-text"}`}
              onClick={() => void loadSession(s.id)}
              title={s.title}
            >
              <div className="flex items-center gap-1.5">
                <MessageSquare size={12} className="shrink-0 opacity-70" />
                <span className="truncate text-[13px] flex-1">{s.title || "Untitled"}</span>
                <button
                  aria-label={`Delete session ${s.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(s);
                  }}
                  className="opacity-0 group-hover:opacity-70 hover:!opacity-100 hover:text-fahh-error"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="pl-[18px] text-[11px] opacity-70">
                {ago(s.updated)} · {s.steps} {s.steps === 1 ? "turn" : "turns"}
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={ensureEditorMode}
          className="m-2 px-2 py-1.5 rounded text-xs text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface text-left"
        >
          Back to the editor
        </button>
      </aside>
      <main className="flex-1 min-w-0 flex justify-center bg-fahh-bg">
        <div className="w-full max-w-4xl min-h-0 flex flex-col border-x border-fahh-surface">
          <AgentPanel onClose={ensureEditorMode} />
        </div>
      </main>
    </div>
  );
}
