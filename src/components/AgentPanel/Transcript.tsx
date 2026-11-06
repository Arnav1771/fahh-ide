/**
 * The conversation, shared by the docked panel and Agent mode. The dock shows one card per
 * tool call; Agent mode (`workspace`) reads like a task log: each prompt opens a turn, runs of
 * tool calls fold into one step timeline, and changes go to the inspector for review.
 */
import { useEffect, useRef, useState } from "react";
import { Bot, ChevronRight, FileDiff, FileEdit, FileSearch, ListChecks, Loader2, Terminal } from "lucide-react";

import { groupSteps, pendingReview, stepsSummary, type Item } from "../../lib/agentState";
import { MODE_LABEL } from "../../lib/slash";
import { settingsProblem } from "../../lib/agent";
import type { AgentToolKind } from "../../lib/types";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useAgentStore } from "../../store/agentStore";
import { useFileStore } from "../../store/fileStore";
import { ensureEditorMode } from "../../store/layoutModeStore";
import { ApprovalCard, brief, PlanCard, ReviewCard, SessionsCard, SubCard, ToolCard } from "./cards";
import { ChatMessageContent } from "./ChatMessageContent";

type ToolItem = Extract<Item, { kind: "tool" }>;

/** Start the approved plan in Ask mode. */
export function implementPlan(id: string, path: string): void {
  const store = useAgentStore.getState();
  store.dispatch({ type: "plan_implementing", id });
  void store.send(`Implement the approved plan in ${path}, step by step.`, { mode: "ask" });
}

/** What the running turn is doing right now, from its own events: tools and subagents still running. */
export function runStatus(items: Item[]): string {
  const tools = items.filter((i) => i.kind === "tool" && i.status === "running").map((i) => (i.kind === "tool" ? i.name : ""));
  const subs = items.filter((i) => i.kind === "sub" && i.status === "running").map((i) => (i.kind === "sub" ? i.name : ""));
  if (subs.length) return `Subagent${subs.length > 1 ? "s" : ""} running: ${subs.join(", ")}`;
  if (tools.length) return `Running ${tools.join(", ")}…`;
  return "Waiting for the model…";
}

const KIND_ICON: Record<AgentToolKind, typeof Terminal> = { read: FileSearch, edit: FileEdit, run: Terminal, plan: ListChecks, agent: Bot };

/** A run of tool calls as one line of step markers; open it for each call's card. */
function StepGroup({ tools }: { tools: ToolItem[] }) {
  const [open, setOpen] = useState(false);
  const running = tools.find((t) => t.status === "running");
  const failed = tools.filter((t) => t.status === "error").length;
  const last = running ?? tools[tools.length - 1];
  return (
    <div className="my-3" data-testid="step-group">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group w-full flex items-center gap-2 min-w-0 py-1 text-left text-[12px] text-fahh-muted hover:text-fahh-text rounded focus-visible:outline focus-visible:outline-1 focus-visible:outline-fahh-accent"
      >
        <ChevronRight size={13} className={`shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} aria-hidden="true" />
        <span className="flex items-center shrink-0" aria-hidden="true">
          {tools.map((t) => {
            const Icon = KIND_ICON[t.toolKind];
            const tone = t.status === "running" ? "text-fahh-accent" : t.status === "error" ? "text-fahh-error" : "text-fahh-muted";
            return (
              <span key={t.id} className={`w-5 h-5 -ml-0.5 first:ml-0 flex items-center justify-center rounded-full border border-fahh-surface bg-fahh-sidebar ${tone}`}>
                {t.status === "running" ? <Loader2 size={10} className="animate-spin motion-reduce:animate-none" /> : <Icon size={10} />}
              </span>
            );
          })}
        </span>
        <span className="shrink-0 text-fahh-text">
          {tools.length} step{tools.length > 1 ? "s" : ""}
        </span>
        <span className="shrink-0">{stepsSummary(tools)}</span>
        {failed > 0 && <span className="shrink-0 text-fahh-error">{failed} failed</span>}
        <span className="truncate min-w-0 font-mono text-[11px] opacity-80">
          {running ? "now: " : "last: "}
          {last.name} {brief(last.args)}
        </span>
      </button>
      {open && (
        <div className="mt-1 ml-[6px] pl-3 border-l border-fahh-surface">
          {tools.map((t) => (
            <ToolCard key={t.id} item={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function ItemView({ item, workspace }: { item: Item; workspace: boolean }) {
  switch (item.kind) {
    case "user":
      return workspace ? (
        <div className="mt-6 first:mt-0 mb-3 select-text" data-testid="turn-prompt">
          <div className="px-3.5 py-2.5 rounded-lg bg-fahh-surface/60 text-sm leading-6 text-fahh-text whitespace-pre-wrap break-words cursor-text selection:bg-fahh-accent/30">{item.text}</div>
        </div>
      ) : (
        <div className="px-2 py-1.5 select-text">
          <div className="text-[10px] uppercase tracking-wider text-fahh-muted mb-0.5 select-none">You</div>
          <div className="text-xs text-fahh-text whitespace-pre-wrap break-words select-text cursor-text selection:bg-fahh-accent/30">{item.text}</div>
        </div>
      );
    case "assistant":
      return workspace ? (
        <div className="my-2 select-text">
          <ChatMessageContent text={item.text.trim()} large />
        </div>
      ) : (
        <div className="px-2 py-1.5 select-text">
          <div className="text-[10px] uppercase tracking-wider text-fahh-accent mb-0.5 select-none">Fahh Local</div>
          <ChatMessageContent text={item.text} />
        </div>
      );
    case "tool":
      return <ToolCard item={item} />;
    case "approval":
      return <ApprovalCard item={item} />;
    case "sub":
      return <SubCard item={item} />;
    case "plan":
      return <PlanCard item={item} onImplement={() => implementPlan(item.id, item.path)} />;
    case "sessions":
      return <SessionsCard item={item} />;
    case "notice":
      return (
        <div className={`${workspace ? "my-1.5 text-[12px]" : "px-3 py-1 text-[11px]"} break-words whitespace-pre-wrap ${item.level === "error" ? "text-fahh-error" : "text-fahh-muted"}`} role={item.level === "error" ? "alert" : undefined}>
          {item.text}
        </div>
      );
  }
}

export function Transcript({ workspace = false, onReview }: { workspace?: boolean; onReview?: () => void }) {
  const store = useAgentStore();
  const { settings, items, status } = store;
  const root = useFileStore((s) => s.root);
  const { openFileInEditor } = useWorkspace();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const problem = settingsProblem(settings);
  const review = pendingReview(store);
  const waiting = review.reduce((n, t) => n + t.files.filter((f) => !t.accepted.includes(f)).length, 0);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, status]);

  const running = status === "running" && (
    <div className={`${workspace ? "my-3 text-[12px]" : "mx-2 my-1.5 text-[11px]"} flex items-center gap-1.5 text-fahh-muted`} data-testid="agent-run-status" aria-live="polite">
      <span className="w-1.5 h-1.5 rounded-full bg-fahh-accent animate-pulse motion-reduce:animate-none shrink-0" />
      <span className="truncate">{runStatus(items)}</span>
    </div>
  );

  if (workspace) {
    return (
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0" data-testid="agent-transcript">
        <div className="max-w-[760px] mx-auto px-6 py-6">
          {groupSteps(items).map((b) => (b.kind === "steps" ? <StepGroup key={b.index} tools={b.items} /> : <ItemView key={b.index} item={b.item} workspace />))}
          {running}
          {waiting > 0 && onReview && (
            <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-lg border border-fahh-accent/40 bg-fahh-accent/5 text-[13px]" data-testid="review-note">
              <FileDiff size={15} className="text-fahh-accent shrink-0" aria-hidden="true" />
              <span className="text-fahh-text flex-1 min-w-0">
                {waiting} file{waiting > 1 ? "s" : ""} changed and waiting for your review
              </span>
              <button type="button" onClick={onReview} className="shrink-0 px-2.5 py-1 rounded-md bg-fahh-accent text-fahh-bg text-[12px] font-medium hover:opacity-90 fahh-primary">
                Review changes
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
      {items.length === 0 && (
        <div className="px-3 py-3 text-xs text-fahh-muted space-y-1.5">
          {problem ? (
            <p>{problem}</p>
          ) : (
            <p>
              <span className="text-fahh-text">{settings.model}</span> is ready. {root ? "Ask it to read, change or run something in this workspace." : "Open a folder first."}
            </p>
          )}
          <p className="opacity-70">
            Mode: {MODE_LABEL[settings.mode]}. Type <span className="font-mono">/</span> for commands: modes, sessions, /loop, subagents.
          </p>
        </div>
      )}
      {items.map((item, i) => (
        <ItemView key={item.kind === "approval" ? item.id : item.kind === "sub" ? item.child : i} item={item} workspace={false} />
      ))}
      {running}
      {review.map((t) => (
        <ReviewCard key={t.turn} turn={t} onOpen={(rel) => root && (ensureEditorMode(), void openFileInEditor(`${root.replace(/[\\/]+$/, "")}/${rel}`))} />
      ))}
    </div>
  );
}
