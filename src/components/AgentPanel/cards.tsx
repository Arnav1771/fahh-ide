import { useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Bot, Check, CircleAlert, FileEdit, FileSearch, ListChecks, Loader2, ShieldQuestion, Square, Terminal, Undo2, X } from "lucide-react";

import { agentTurnDiff } from "../../lib/agent";
import type { Item, TurnInfo } from "../../lib/agentState";
import type { AgentFileDiff, AgentToolKind } from "../../lib/types";
import { useAgentStore } from "../../store/agentStore";

const LANGS: Record<string, string> = {
  rs: "rust", ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", py: "python",
  json: "json", toml: "toml", md: "markdown", html: "html", css: "css",
};
const langOf = (path: string) => LANGS[path.split(".").pop() ?? ""] ?? "plaintext";

/** Monaco's diff editor, inline, read-only. */
export function Diff({ path, before, after }: { path: string; before: string; after: string }) {
  const lines = Math.max(before.split("\n").length, after.split("\n").length);
  return (
    <div className="border border-fahh-surface rounded overflow-hidden" data-testid="diff">
      <DiffEditor
        original={before}
        modified={after}
        language={langOf(path)}
        keepCurrentOriginalModel
        keepCurrentModifiedModel
        theme="vs-dark"
        height={Math.min(220, 40 + lines * 19)}
        options={{
          readOnly: true,
          renderSideBySide: false,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          lineNumbers: "off",
          folding: false,
          fontSize: 11,
          scrollbar: { alwaysConsumeMouseWheel: false },
        }}
      />
    </div>
  );
}

const ICONS: Record<AgentToolKind, typeof Terminal> = { read: FileSearch, edit: FileEdit, run: Terminal, plan: ListChecks, agent: Bot };

function brief(args: Record<string, unknown>): string {
  const v = args.path ?? args.command ?? args.pattern ?? args.title ?? "";
  return typeof v === "string" ? v : JSON.stringify(v);
}

export function ToolCard({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[item.toolKind];
  return (
    <div className="mx-2 my-1 rounded border border-fahh-surface bg-[#111318] text-[11px]" data-testid="tool-card">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-1.5 px-2 py-1 text-left">
        <Icon size={12} className="shrink-0 text-fahh-muted" />
        <span className="font-mono text-fahh-text">{item.name}</span>
        <span className="truncate text-fahh-muted font-mono min-w-0 flex-1">{brief(item.args)}</span>
        {item.elapsedMs !== undefined && (
          <span
            className="text-[10px] text-fahh-muted font-mono px-1 py-0.5 rounded bg-fahh-surface/60 shrink-0"
            data-testid="tool-elapsed"
            title={`Execution time: ${item.elapsedMs}ms`}
          >
            {item.elapsedMs < 1000 ? `${item.elapsedMs}ms` : `${(item.elapsedMs / 1000).toFixed(1)}s`}
          </span>
        )}
        {item.status === "running" && <Loader2 size={12} className="animate-spin text-fahh-muted" />}
        {item.status === "ok" && <Check size={12} className="text-green-400" />}
        {item.status === "error" && <CircleAlert size={12} className="text-fahh-error" />}
      </button>
      {open && (
        <pre className="px-2 pb-2 text-[10px] whitespace-pre-wrap break-words text-neutral-400 max-h-40 overflow-auto">
          {item.output ?? "(running)"}
        </pre>
      )}
      {!open && item.status === "error" && item.output && (
        <div className="px-2 pb-1 text-[10px] text-fahh-error truncate">{item.output.split("\n")[0]}</div>
      )}
    </div>
  );
}

export function ApprovalCard({ item }: { item: Extract<Item, { kind: "approval" }> }) {
  const answer = useAgentStore((s) => s.answer);
  const [cmd, setCmd] = useState(item.command ?? "");
  const pending = item.state === "pending";
  return (
    <div className={`mx-2 my-1.5 rounded border text-[11px] ${pending ? "border-fahh-accent bg-fahh-accent/10" : "border-fahh-surface bg-[#111318] opacity-70"}`} data-testid="approval">
      <div className="flex items-center gap-1.5 px-2 py-1 font-medium text-fahh-text">
        <ShieldQuestion size={12} className="text-fahh-accent shrink-0" />
        <span className="min-w-0 break-words">{item.summary}</span>
      </div>
      <div className="px-2 pb-2 space-y-1.5">
        {item.command !== null && (
          <textarea
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            disabled={!pending}
            rows={2}
            spellCheck={false}
            aria-label="Command to run (editable)"
            className="w-full resize-none bg-fahh-bg border border-fahh-surface rounded px-1.5 py-1 font-mono text-[11px] text-fahh-text focus:outline-none focus:border-fahh-accent"
          />
        )}
        {item.path !== null && item.newText !== null && <Diff path={item.path} before={item.oldText ?? ""} after={item.newText} />}
        {pending ? (
          <div className="flex gap-1.5">
            <button
              onClick={() => void answer(item.id, { allow: true, command: item.command !== null ? cmd : null })}
              className="flex-1 py-1 rounded bg-fahh-accent/90 text-white hover:bg-fahh-accent"
            >
              {item.command !== null ? "Run" : "Apply"}
            </button>
            <button
              onClick={() => void answer(item.id, { allow: true, always: true, command: item.command !== null ? cmd : null })}
              title={item.command !== null ? "Always allow exactly this command in this project" : "Always allow edits to this file in this project"}
              className="px-2 py-1 rounded bg-fahh-surface text-fahh-text hover:bg-fahh-accent/30"
            >
              Always
            </button>
            <button onClick={() => void answer(item.id, { allow: false })} className="px-2 py-1 rounded text-fahh-muted hover:text-fahh-error">
              Deny
            </button>
          </div>
        ) : (
          <div className="text-[10px] text-fahh-muted">{item.state === "allowed" ? "Allowed" : "Denied"}</div>
        )}
      </div>
    </div>
  );
}

export function PlanCard({ item, onImplement }: { item: Extract<Item, { kind: "plan" }>; onImplement: () => void }) {
  return (
    <div className="mx-2 my-1.5 rounded border border-fahh-surface bg-[#111318] text-[11px]" data-testid="plan">
      <div className="flex items-center gap-1.5 px-2 py-1 text-fahh-text font-medium">
        <ListChecks size={12} className="text-fahh-accent" /> Plan <span className="font-mono text-fahh-muted truncate">{item.path}</span>
      </div>
      <pre className="px-2 pb-1 whitespace-pre-wrap break-words text-neutral-300 max-h-52 overflow-auto font-sans">{item.markdown}</pre>
      <div className="px-2 pb-2">
        <button
          onClick={onImplement}
          disabled={item.state === "implementing"}
          className="w-full py-1 rounded bg-fahh-accent/90 text-white hover:bg-fahh-accent disabled:opacity-50"
        >
          {item.state === "implementing" ? "Implementing…" : "Implement this plan"}
        </button>
      </div>
    </div>
  );
}

/** Per-file review of what a turn changed: diff, accept, reject; or revert the whole turn. */
export function ReviewCard({ turn, onOpen }: { turn: TurnInfo; onOpen: (rel: string) => void }) {
  const { session, dispatch, rejectFile, revertTurn } = useAgentStore();
  const [diffs, setDiffs] = useState<Record<string, AgentFileDiff>>({});
  const [shown, setShown] = useState<string | null>(null);
  const files = turn.files.filter((f) => !turn.accepted.includes(f));
  if (files.length === 0) return null;

  const toggle = async (path: string) => {
    if (shown === path) return setShown(null);
    if (session && !diffs[path]) {
      const all = await agentTurnDiff(session, turn.turn).catch(() => []);
      setDiffs(Object.fromEntries(all.map((d) => [d.path, d])));
    }
    setShown(path);
  };

  return (
    <div className="mx-2 my-1.5 rounded border border-fahh-surface bg-[#111318] text-[11px]" data-testid="review">
      <div className="flex items-center gap-1.5 px-2 py-1 text-fahh-text font-medium">
        Review: {files.length} file{files.length > 1 ? "s" : ""} changed
        {turn.errorsAdded > 0 && <span className="text-fahh-error">+{turn.errorsAdded} error{turn.errorsAdded > 1 ? "s" : ""}</span>}
        <div className="flex-1" />
        <button onClick={() => void revertTurn(turn.turn)} title="Undo everything this turn changed" className="flex items-center gap-1 text-fahh-muted hover:text-fahh-error">
          <Undo2 size={11} /> Revert turn
        </button>
      </div>
      {files.map((f) => (
        <div key={f} className="px-2 pb-1.5">
          <div className="flex items-center gap-1">
            <button onClick={() => onOpen(f)} className="font-mono truncate text-fahh-accent hover:underline min-w-0 flex-1 text-left" title="Open in the editor">
              {f}
            </button>
            <button onClick={() => void toggle(f)} className="px-1 text-fahh-muted hover:text-fahh-text">
              {shown === f ? "Hide diff" : "Diff"}
            </button>
            <button onClick={() => dispatch({ type: "file_accepted", turn: turn.turn, path: f })} title="Keep this change" className="text-green-400 hover:text-green-300">
              <Check size={13} />
            </button>
            <button onClick={() => void rejectFile(turn.turn, f)} title="Reject: restore the file" className="text-fahh-error hover:opacity-80">
              <X size={13} />
            </button>
          </div>
          {shown === f && diffs[f] && <div className="mt-1"><Diff path={f} before={diffs[f].before ?? ""} after={diffs[f].after ?? ""} /></div>}
        </div>
      ))}
    </div>
  );
}

type SubItem = Extract<Item, { kind: "sub" }>;
type SessionsItem = Extract<Item, { kind: "sessions" }>;

/** A subagent: status, model, mode, its tool lines and approvals, and its own Stop button. */
export function SubCard({ item }: { item: SubItem }) {
  const stopChild = useAgentStore((s) => s.stopChild);
  const tone = item.status === "running" ? "text-fahh-accent" : item.status === "done" ? "text-green-400" : "text-fahh-error";
  return (
    <div className="mx-2 my-1.5 rounded border border-fahh-surface bg-[#0d0f14] text-[11px]" data-testid="sub-card" data-status={item.status}>
      <div className="flex items-center gap-1.5 px-2 py-1">
        {item.status === "running" ? <Loader2 size={12} className="animate-spin text-fahh-accent shrink-0" /> : <Bot size={12} className={`${tone} shrink-0`} />}
        <span className="font-medium text-fahh-text">{item.name}</span>
        <span className="text-[10px] text-fahh-muted truncate min-w-0 flex-1">
          {item.model ?? "session model"} · {item.mode}
        </span>
        {item.status === "running" ? (
          <button onClick={() => void stopChild(item.child)} title="Stop this subagent only" className="flex items-center gap-1 text-fahh-muted hover:text-fahh-error">
            <Square size={10} /> Stop
          </button>
        ) : (
          <span className={`text-[10px] ${tone}`}>{item.status === "done" ? `done, ${item.steps} step${item.steps === 1 ? "" : "s"}` : "stopped or failed"}</span>
        )}
      </div>
      <div className="px-2 pb-1 text-fahh-muted break-words">{item.task}</div>
      {item.items.map((c, i) =>
        c.kind === "tool" ? <ToolCard key={i} item={c} /> : c.kind === "approval" ? <ApprovalCard key={c.id} item={c} /> : c.kind === "notice" ? <div key={i} className="px-2 pb-1 text-[10px] text-fahh-muted break-words">{c.text}</div> : null
      )}
      {item.status !== "running" && item.summary && <div className="px-2 pb-1.5 text-neutral-300 whitespace-pre-wrap break-words">{item.summary}</div>}
    </div>
  );
}

/** /ls and /resume: saved sessions of this workspace. */
export function SessionsCard({ item }: { item: SessionsItem }) {
  const loadSession = useAgentStore((s) => s.loadSession);
  const handleInput = useAgentStore((s) => s.handleInput);
  const [removed, setRemoved] = useState<string[]>([]);
  return (
    <div className="mx-2 my-1.5 rounded border border-fahh-surface bg-[#111318] text-[11px]" data-testid="sessions">
      <div className="px-2 py-1 text-fahh-text font-medium">Saved sessions</div>
      {item.sessions.filter((s) => !removed.includes(s.id)).map((s) => (
        <div key={s.id} className="flex items-center gap-1.5 px-2 pb-1">
          <span className="min-w-0 flex-1 truncate" title={s.id}>
            {s.title} <span className="text-fahh-muted">· {s.steps} step{s.steps === 1 ? "" : "s"} · {new Date(s.updated * 1000).toLocaleDateString()}</span>
          </span>
          {s.id === item.current ? (
            <span className="text-[10px] text-fahh-muted">current</span>
          ) : (
            <button onClick={() => void loadSession(s.id)} className="px-1.5 py-0.5 rounded bg-fahh-accent/20 text-fahh-accent hover:bg-fahh-accent hover:text-white">
              Resume
            </button>
          )}
          {s.id !== item.current && (
            <button
              onClick={() => {
                if (!window.confirm(`Delete the saved session "${s.title}"?`)) return;
                setRemoved((r) => [...r, s.id]);
                void handleInput(`/rm-session ${s.id}`);
              }}
              title="Delete this saved session"
              className="px-1.5 py-0.5 rounded text-fahh-muted hover:text-fahh-error"
            >
              Delete
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
