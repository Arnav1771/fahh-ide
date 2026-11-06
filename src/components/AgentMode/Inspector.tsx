/**
 * Agent mode's right column: what this session changed (review, checkpoints), its plan, and
 * what the model sees (files in context, context window, usage). Every number comes from
 * the backend; nothing is estimated here.
 */
import { useEffect, useState } from "react";
import { CheckSquare, History, ListChecks, Square, X } from "lucide-react";

import { agentContext, agentSteps, agentUsage } from "../../lib/agent";
import { planChecklist } from "../../lib/agentStarters";
import { ago } from "../../lib/agentSessionsList";
import { pendingFiles, pendingReview, type Item } from "../../lib/agentState";
import type { AgentContextInfo, AgentTurnRec, AgentUsage } from "../../lib/types";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useAgentStore } from "../../store/agentStore";
import { confirmDialog } from "../../store/dialogStore";
import { useEditorStore } from "../../store/editorStore";
import { useFileStore } from "../../store/fileStore";
import { ensureEditorMode } from "../../store/layoutModeStore";
import { ReviewCard } from "../AgentPanel/cards";
import { ChatMessageContent } from "../AgentPanel/ChatMessageContent";
import { implementPlan } from "../AgentPanel/Transcript";

export type InspectorTab = "changes" | "plan" | "context";

const fmt = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString());
const rel = (root: string | null, p: string) => (root && p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]+/, "") : p);
const heading = "text-[12px] font-medium text-fahh-text";
const empty = "text-[12px] leading-5 text-fahh-muted";

/** The session's checkpoints (one per step), refreshed whenever a turn ends. */
function useSessionData() {
  const session = useAgentStore((s) => s.session);
  const status = useAgentStore((s) => s.status);
  const model = useAgentStore((s) => s.settings.model);
  const [steps, setSteps] = useState<AgentTurnRec[]>([]);
  const [ctx, setCtx] = useState<AgentContextInfo | null>(null);
  const [usage, setUsage] = useState<AgentUsage | null>(null);
  useEffect(() => {
    if (!session) return void (setSteps([]), setCtx(null), setUsage(null));
    let live = true;
    void agentSteps(session).then((s) => live && setSteps(s), () => {});
    void agentContext(session, model).then((c) => live && setCtx(c), () => {});
    void agentUsage(session).then((u) => live && setUsage(u), () => {});
    return () => {
      live = false;
    };
  }, [session, status, model]);
  return { steps, ctx, usage };
}

function Changes({ steps }: { steps: AgentTurnRec[] }) {
  const store = useAgentStore();
  const root = useFileStore((s) => s.root);
  const { openFileInEditor } = useWorkspace();
  const review = pendingReview(store);
  const busy = store.status === "running" || store.status === "needs_input";

  const rewind = async (step: AgentTurnRec) => {
    const ok = await confirmDialog({
      title: `Rewind to before step ${step.id}?`,
      message: "Files changed in this step and every later one are restored, and the conversation goes back to before it.",
      ok: "Rewind",
      danger: true,
    });
    if (ok) await store.handleInput(`/revert ${step.id}`);
  };

  return (
    <div className="space-y-5">
      <section aria-label="Changes to review">
        {review.length === 0 ? (
          <p className={empty}>No changes waiting. Files Fahh Local edits in this session show up here with a diff, to keep or reject.</p>
        ) : (
          <div className="-mx-2">
            {review.map((t) => (
              <ReviewCard key={t.turn} turn={t} onOpen={(f) => root && (ensureEditorMode(), void openFileInEditor(`${root.replace(/[\\/]+$/, "")}/${f}`))} />
            ))}
          </div>
        )}
      </section>
      <section aria-labelledby="checkpoints-h">
        <h3 id="checkpoints-h" className={`${heading} mb-1.5 flex items-center gap-1.5`}>
          <History size={13} className="text-fahh-muted" aria-hidden="true" /> Checkpoints
        </h3>
        {steps.length === 0 ? (
          <p className={empty}>Each step you send saves a checkpoint you can rewind to.</p>
        ) : (
          <ol className="space-y-0.5">
            {steps
              .slice()
              .reverse()
              .map((s) => (
                <li key={s.id} className="group flex items-start gap-2 px-2 py-1.5 -mx-2 rounded hover:bg-fahh-surface/50">
                  <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-[11px] text-fahh-muted">{s.id}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-[12px] text-fahh-text" title={s.prompt}>{s.prompt}</span>
                    <span className="block text-[11px] text-fahh-muted">{ago(s.at)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void rewind(s)}
                    disabled={busy}
                    title={busy ? "Wait for the turn to finish" : `Rewind to before step ${s.id}`}
                    className="shrink-0 px-1.5 py-0.5 rounded text-[11px] text-fahh-muted hover:text-fahh-error hover:bg-fahh-error/10 disabled:opacity-40 opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    Rewind
                  </button>
                </li>
              ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Plan() {
  const items = useAgentStore((s) => s.items);
  const setMode = useAgentStore((s) => s.setMode);
  const mode = useAgentStore((s) => s.settings.mode);
  const plan = [...items].reverse().find((i): i is Extract<Item, { kind: "plan" }> => i.kind === "plan");
  if (!plan) {
    return (
      <div className="space-y-3">
        <p className={empty}>No plan yet. In Plan mode Fahh Local only reads, then writes a plan to .fahh/plans for you to approve before any code changes.</p>
        {mode !== "plan" && (
          <button type="button" onClick={() => setMode("plan")} className="px-2.5 py-1 rounded-md border border-fahh-surface text-[12px] text-fahh-text hover:bg-fahh-surface/60">
            Switch to Plan mode
          </button>
        )}
      </div>
    );
  }
  const list = planChecklist(plan.markdown);
  const title = plan.markdown.match(/^#\s+(.+)$/m)?.[1];
  const done = list?.filter((x) => x.done).length ?? 0;
  return (
    <div className="space-y-3" data-testid="inspector-plan">
      <div>
        <h3 className={heading}>{title ?? "Plan"}</h3>
        <p className="font-mono text-[11px] text-fahh-muted truncate" title={plan.path}>{plan.path}</p>
      </div>
      {list ? (
        <>
          <div className="flex items-center gap-2 text-[11px] text-fahh-muted">
            <div className="flex-1 h-1 rounded-full bg-fahh-surface overflow-hidden" aria-hidden="true">
              <div className="h-full bg-fahh-success" style={{ width: `${(done / list.length) * 100}%` }} />
            </div>
            {done} of {list.length} done
          </div>
          <ul className="space-y-1">
            {list.map((x, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] leading-5">
                {x.done ? <CheckSquare size={14} className="mt-0.5 shrink-0 text-fahh-success" aria-label="Done" /> : <Square size={14} className="mt-0.5 shrink-0 text-fahh-muted" aria-label="To do" />}
                <span className={x.done ? "text-fahh-muted line-through decoration-fahh-muted/50" : "text-fahh-text"}>{x.text}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ChatMessageContent text={plan.markdown} />
      )}
      <button
        type="button"
        onClick={() => implementPlan(plan.id, plan.path)}
        disabled={plan.state === "implementing"}
        className="w-full py-1.5 rounded-md bg-fahh-accent text-fahh-bg text-[12px] font-medium hover:opacity-90 disabled:opacity-50 fahh-primary"
      >
        {plan.state === "implementing" ? "Implementing…" : "Implement this plan"}
      </button>
    </div>
  );
}

function Context({ ctx, usage }: { ctx: AgentContextInfo | null; usage: AgentUsage | null }) {
  const root = useFileStore((s) => s.root);
  const activeTab = useEditorStore((s) => s.activeTab);
  const openTabs = useEditorStore((s) => s.openTabs);
  const extraDirs = useAgentStore((s) => s.settings.extraDirs);
  const others = openTabs.filter((t) => t.path !== activeTab);
  const pct = ctx ? Math.min(100, ctx.percent) : 0;
  return (
    <div className="space-y-5">
      <section aria-labelledby="ctx-window-h">
        <h3 id="ctx-window-h" className={`${heading} mb-1.5`}>Context window</h3>
        {ctx ? (
          <>
            <div className="h-1.5 rounded-full bg-fahh-surface overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Context window used">
              <div className={`h-full ${pct > 80 ? "bg-fahh-error" : pct > 60 ? "bg-fahh-warn" : "bg-fahh-accent"}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-fahh-muted">
              {fmt(ctx.used)} of {fmt(ctx.window)} tokens ({ctx.percent}%), {ctx.messages} messages. /compact folds older turns.
            </p>
          </>
        ) : (
          <p className={empty}>Starts filling with the session&apos;s first prompt.</p>
        )}
      </section>
      {usage && (
        <section aria-labelledby="ctx-usage-h">
          <h3 id="ctx-usage-h" className={`${heading} mb-1.5`}>This session</h3>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-[12px]">
            <dt className="text-fahh-muted">Tokens sent</dt>
            <dd className="text-fahh-text font-mono text-right">{fmt(usage.tokens_in)}</dd>
            <dt className="text-fahh-muted">Tokens received</dt>
            <dd className="text-fahh-text font-mono text-right">{fmt(usage.tokens_out)}</dd>
            <dt className="text-fahh-muted">Model calls</dt>
            <dd className="text-fahh-text font-mono text-right">{usage.model_calls}</dd>
            <dt className="text-fahh-muted">Tool calls</dt>
            <dd className="text-fahh-text font-mono text-right">{usage.tool_calls}</dd>
          </dl>
        </section>
      )}
      <section aria-labelledby="ctx-files-h">
        <h3 id="ctx-files-h" className={`${heading} mb-1.5`}>Sent with each prompt</h3>
        {!activeTab && others.length === 0 && extraDirs.length === 0 ? (
          <p className={empty}>No files open. Type @ in the prompt to add one, or open a file in the editor.</p>
        ) : (
          <ul className="space-y-1 text-[12px]">
            {activeTab && (
              <li className="flex items-center gap-2 min-w-0">
                <span className="font-mono truncate text-fahh-text" title={activeTab}>{rel(root, activeTab)}</span>
                <span className="shrink-0 text-[11px] text-fahh-accent">active, with selection</span>
              </li>
            )}
            {others.map((t) => (
              <li key={t.path} className="flex items-center gap-2 min-w-0">
                <span className="font-mono truncate text-fahh-muted" title={t.path}>{rel(root, t.path)}</span>
                <span className="shrink-0 text-[11px] text-fahh-muted">{t.dirty ? "open, unsaved" : "open"}</span>
              </li>
            ))}
            {extraDirs.map((d) => (
              <li key={d} className="flex items-center gap-2 min-w-0">
                <span className="font-mono truncate text-fahh-muted" title={d}>{d}</span>
                <span className="shrink-0 text-[11px] text-fahh-muted">added folder</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function Inspector({ tab, onTab, onClose }: { tab: InspectorTab; onTab: (t: InspectorTab) => void; onClose: () => void }) {
  const store = useAgentStore();
  const { steps, ctx, usage } = useSessionData();
  const waiting = pendingReview(store).reduce((n, t) => n + pendingFiles(t).length, 0);
  const hasPlan = store.items.some((i) => i.kind === "plan");
  const tabs: { id: InspectorTab; label: string; badge?: number | boolean }[] = [
    { id: "changes", label: "Changes", badge: waiting || undefined },
    { id: "plan", label: "Plan", badge: hasPlan },
    { id: "context", label: "Context" },
  ];
  return (
    <aside
      className="w-[340px] shrink-0 flex flex-col min-h-0 bg-fahh-sidebar border-l border-fahh-surface max-[1199px]:absolute max-[1199px]:right-0 max-[1199px]:inset-y-0 max-[1199px]:z-20 max-[1199px]:shadow-2xl"
      aria-label="Session inspector"
      data-testid="agent-inspector"
    >
      <div className="h-11 shrink-0 flex items-center gap-0.5 px-2 border-b border-fahh-surface" role="tablist" aria-label="Inspector">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => onTab(t.id)}
            className={`relative h-11 px-2.5 flex items-center gap-1.5 text-[12px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-fahh-accent ${
              tab === t.id ? "text-fahh-text font-medium" : "text-fahh-muted hover:text-fahh-text"
            }`}
          >
            {t.id === "plan" && <ListChecks size={13} aria-hidden="true" />}
            {t.label}
            {typeof t.badge === "number" && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-fahh-accent text-fahh-bg text-[10px] font-semibold flex items-center justify-center">{t.badge}</span>}
            {t.badge === true && <span className="w-1.5 h-1.5 rounded-full bg-fahh-accent" aria-label="has a plan" />}
            {tab === t.id && <span className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-fahh-accent" aria-hidden="true" />}
          </button>
        ))}
        <div className="flex-1" />
        <button type="button" onClick={onClose} aria-label="Close the inspector" title="Close the inspector" className="p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface/60">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 p-4" role="tabpanel">
        {tab === "changes" ? <Changes steps={steps} /> : tab === "plan" ? <Plan /> : <Context ctx={ctx} usage={usage} />}
      </div>
    </aside>
  );
}
