/**
 * The conversation, shared by the docked panel and Agent mode. The dock shows one card per
 * tool call; Agent mode (`workspace`) reads like a task log: each prompt opens a turn, runs of
 * tool calls fold into one step timeline, and changes go to the inspector for review.
 */
import { useEffect, useRef, useState } from "react";
import { Bot, ChevronRight, FileDiff, FileEdit, FileSearch, ListChecks, Loader2, Terminal } from "lucide-react";

import { groupSteps, pendingReview, stepsSummary, type Item, type Stat } from "../../lib/agentState";
import type { AgentUsage } from "../../lib/types";
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

/** Short numbers for the cards: 2.84M, 13.7K, 980. */
function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

/** /usage: the session total as a headline, an in/out split bar, and the two call counts. */
function UsageCard({ u, workspace }: { u: AgentUsage; workspace: boolean }) {
  const turns = useAgentStore((s) => Object.keys(s.turns).length);
  const total = u.tokens_in + u.tokens_out;
  const share = (n: number) => (total ? Math.max((n / total) * 100, 1) : 50);
  return (
    <section className={`${workspace ? "my-3 text-[13px]" : "mx-2 my-1.5 text-[12px]"} fahh-pop rounded-lg border border-fahh-surface bg-fahh-surface/40 p-2.5`} aria-label="Session usage" data-testid="agent-usage-card">
      <div className="mb-1.5 flex items-baseline justify-between">
        <h3 className="font-semibold text-fahh-text">Session usage</h3>
        <span className="text-[0.85em] text-fahh-muted">{turns} turn{turns === 1 ? "" : "s"}</span>
      </div>
      <p className="text-[2em] font-bold leading-none tabular-nums text-fahh-text" title={`${total.toLocaleString()} tokens`}>
        {compact(total)}
        <span className="ml-1 text-[0.42em] font-medium text-fahh-muted">tokens</span>
      </p>
      <div className="my-2 flex h-[0.55em] gap-0.5 overflow-hidden rounded-full bg-fahh-bg" aria-hidden="true">
        <i className="block min-w-1 rounded-full bg-fahh-accent" style={{ flex: share(u.tokens_in) }} />
        <i className="block min-w-1 rounded-full bg-fahh-info" style={{ flex: share(u.tokens_out) }} />
      </div>
      <div className="flex justify-between text-[0.88em] tabular-nums text-fahh-muted">
        <span title={u.tokens_in.toLocaleString()}>
          <i className="mr-1 inline-block h-[0.6em] w-[0.6em] rounded-sm bg-fahh-accent align-middle" aria-hidden="true" />
          in <b className="font-semibold text-fahh-text">{compact(u.tokens_in)}</b>
        </span>
        <span title={u.tokens_out.toLocaleString()}>
          <i className="mr-1 inline-block h-[0.6em] w-[0.6em] rounded-sm bg-fahh-info align-middle" aria-hidden="true" />
          out <b className="font-semibold text-fahh-text">{compact(u.tokens_out)}</b>
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-1.5 tabular-nums">
        {([["Model calls", u.model_calls], ["Tool calls", u.tool_calls]] as const).map(([l, v]) => (
          <div key={l} className="rounded-md border border-fahh-surface bg-fahh-bg px-2 py-1.5">
            <dt className="text-[0.82em] text-fahh-muted">{l}</dt>
            <dd className="text-[1.25em] font-semibold text-fahh-text">{v.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1.5 text-[0.8em] text-fahh-muted">Token counts are estimated.</p>
    </section>
  );
}

/** /context, /model: the same look as the usage card's tiles. */
function StatCard({ title, stats, workspace }: { title?: string; stats: Stat[]; workspace: boolean }) {
  return (
    <section className={`${workspace ? "my-3 text-[13px]" : "mx-2 my-1.5 text-[12px]"} fahh-pop rounded-lg border border-fahh-surface bg-fahh-surface/40 p-2.5`} aria-label={title} data-testid="agent-stat-card">
      {title && <h3 className="mb-1.5 font-semibold text-fahh-text">{title}</h3>}
      <dl className={`grid gap-1.5 ${stats.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {stats.map((x) => (
          <div key={x.label} className="min-w-0 rounded-md border border-fahh-surface bg-fahh-bg px-2 py-1.5">
            <dt className="text-[0.82em] text-fahh-muted">{x.label}</dt>
            <dd className="truncate text-[1.2em] font-semibold tabular-nums text-fahh-text" title={x.value}>{x.value}</dd>
            {x.hint && <dd className="truncate text-[0.8em] text-fahh-muted" title={x.hint}>{x.hint}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The run hit its step limit: say so plainly and offer the next move instead of a dead end. */
function ResumeCard({ text, workspace }: { text: string; workspace: boolean }) {
  const store = useAgentStore.getState();
  const steps = /(\d+) steps/.exec(text)?.[1];
  const btn = "rounded-md px-2.5 py-1 text-[0.92em] font-medium";
  return (
    <section className={`${workspace ? "my-3 text-[13px]" : "mx-2 my-1.5 text-[12px]"} rounded-lg border border-fahh-warn/40 bg-fahh-warn/5 p-2.5`} role="status" data-testid="agent-resume-card">
      <p className="text-fahh-text">Paused after {steps ?? "the maximum"} steps before finishing.</p>
      <p className="mt-0.5 text-[0.88em] text-fahh-muted">Its work so far is kept. Continue to let it carry on, or ask for a summary of what it did.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => void store.send("Continue where you stopped and finish the task.")} className={`${btn} fahh-primary bg-fahh-accent text-fahh-bg hover:opacity-90`}>
          Continue
        </button>
        <button type="button" onClick={() => void store.send("Stop working on the task. Summarise what you did so far, what is left, and any files you changed.")} className={`${btn} border border-fahh-surface text-fahh-text hover:bg-fahh-surface`}>
          Summarise so far
        </button>
        <button type="button" onClick={() => void store.handleInput("/usage")} className={`${btn} text-fahh-muted hover:text-fahh-text`}>
          Usage
        </button>
      </div>
    </section>
  );
}

const STEP_LABEL: Record<AgentToolKind, string> = { read: "Read", edit: "Edit", run: "Run", plan: "Plan", agent: "Agent" };

/** One step's short label: the tool kind and its main argument (a path, a pattern or a command). */
function stepLabel(t: ToolItem): string {
  const a = t.args as Record<string, unknown>;
  const target = [a.path, a.file, a.pattern, a.query, a.command, a.name].find((v) => typeof v === "string" && v) as string | undefined;
  const short = target ? (target.length > 42 ? `…${target.slice(-40)}` : target) : t.name;
  return `${STEP_LABEL[t.toolKind] ?? t.name} ${short}`;
}

/** While a turn runs: its steps as they happen, then live elapsed time and step count, so it never looks frozen. */
function RunningCard({ items, workspace }: { items: Item[]; workspace: boolean }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  // The steps of this turn: tool calls after the last user message.
  let from = 0;
  items.forEach((it, i) => { if (it.kind === "user") from = i + 1; });
  const tools = items.slice(from).filter((i): i is ToolItem => i.kind === "tool");
  const shown = tools.slice(-4);
  const busyTool = tools.some((t) => t.status === "running");
  const elapsed = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <section className={`${workspace ? "my-3 text-[13px]" : "mx-2 my-1.5 text-[12px]"} rounded-lg border border-fahh-surface bg-fahh-surface/40 p-2.5`} data-testid="agent-run-status" aria-live="polite" aria-label="Fahh Local is working">
      <ul className="space-y-1">
        {tools.length > shown.length && <li className="pl-6 text-[0.85em] text-fahh-muted">{tools.length - shown.length} earlier step{tools.length - shown.length > 1 ? "s" : ""}</li>}
        {shown.map((t) => (
          <li key={t.id} className="flex items-center gap-2 min-w-0">
            <StepIcon state={t.status} />
            <span className={`truncate ${t.status === "running" ? "font-semibold text-fahh-text" : "text-fahh-text/90"}`} title={stepLabel(t)}>{stepLabel(t)}</span>
            <span className="ml-auto shrink-0 text-[0.85em] tabular-nums text-fahh-muted">
              {t.status === "running" ? "running" : t.status === "error" ? "failed" : t.elapsedMs != null ? `${(t.elapsedMs / 1000).toFixed(1)}s` : ""}
            </span>
          </li>
        ))}
        {!busyTool && (
          <li className="flex items-center gap-2">
            <StepIcon state="running" />
            <span className="truncate text-fahh-muted">{runStatus(items)}</span>
          </li>
        )}
      </ul>
      <div className="mt-2 grid grid-cols-2 gap-1.5 tabular-nums">
        <div className="rounded-md bg-fahh-bg px-2 py-1"><span className="block text-[0.8em] text-fahh-muted">Elapsed</span><b className="font-semibold text-fahh-text">{elapsed}</b></div>
        <div className="rounded-md bg-fahh-bg px-2 py-1"><span className="block text-[0.8em] text-fahh-muted">Steps</span><b className="font-semibold text-fahh-text">{tools.length}</b></div>
      </div>
    </section>
  );
}

function StepIcon({ state }: { state: "running" | "ok" | "error" }) {
  if (state === "running") return <Loader2 size={13} className="shrink-0 animate-spin text-fahh-accent motion-reduce:animate-none" aria-hidden="true" />;
  if (state === "error") return <span className="grid h-[13px] w-[13px] shrink-0 place-items-center rounded-full bg-fahh-error/20 text-[9px] text-fahh-error" aria-hidden="true">!</span>;
  return <span className="grid h-[13px] w-[13px] shrink-0 place-items-center rounded-full bg-fahh-accent/20 text-[9px] text-fahh-accent" aria-hidden="true">✓</span>;
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
      if (item.usage) return <UsageCard u={item.usage} workspace={workspace} />;
      if (item.stats?.length) return <StatCard title={item.title} stats={item.stats} workspace={workspace} />;
      if (item.resume) return <ResumeCard text={item.text} workspace={workspace} />;
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

  const running = status === "running" && <RunningCard items={items} workspace={workspace} />;

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
