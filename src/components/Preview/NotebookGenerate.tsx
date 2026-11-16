/**
 * Generate code in a notebook preview: describe a cell, Fahh Local writes it from the
 * cells above and the live kernel's variables, typed into a new cell below. Nothing runs
 * on its own. Also the in-place editor for code cells (the rest of the preview is read-only).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, Play, RotateCw, Settings2, Sparkles, Square, Trash2, X } from "lucide-react";
import { agentGenerate, agentGenerateStop, listenGenerate, settingsProblem, toProviderConfig } from "../../lib/agent";
import type { NotebookCell } from "../../lib/notebook";
import { buildGeneratePrompt, GENERATE_SYSTEM, insertCodeCell, removeCell, setCellSource, stripFences } from "../../lib/notebookGen";
import { revealView } from "../../lib/workbench";
import { useAgentStore } from "../../store/agentStore";
import type { NotebookKernel } from "./NotebookKernel";

type Gen =
  | { phase: "idle" }
  | { phase: "prompt"; at: number; request: string }
  | { phase: "setup"; at: number; problem: string }
  | { phase: "reading"; at: number; request: string }
  | { phase: "writing"; at: number; request: string; code: string }
  | { phase: "error"; at: number; request: string; message: string }
  | { phase: "empty"; at: number; request: string }
  /** The new cell is in the file at `at`; `len` is the cell count once the preview has it. */
  | { phase: "done"; at: number; request: string; len: number };

/** The open settings event AgentPanel listens for. */
export const OPEN_AGENT_SETTINGS = "fahh:agent-settings";

const BUSY = "Wait for the running cells to finish.";

export function useNotebookGenerate(cells: NotebookCell[], k: NotebookKernel) {
  const [gen, setGen] = useState<Gen>({ phase: "idle" });
  const token = useRef(0); // bumped on every start / stop / cancel: stale awaits drop their result
  const genId = useRef<string | null>(null);
  const code = useRef("");
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const busyRef = useRef(k.busy || k.restarting);
  busyRef.current = k.busy || k.restarting;

  const stopStream = () => {
    if (genId.current) void agentGenerateStop(genId.current).catch(() => {});
    genId.current = null;
  };
  useEffect(() => () => stopStream(), []); // closing the notebook ends a generation

  const open = (at: number) => {
    token.current++;
    stopStream();
    const problem = settingsProblem(useAgentStore.getState().settings);
    setGen(problem ? { phase: "setup", at, problem } : { phase: "prompt", at, request: "" });
  };

  const cancel = () => {
    token.current++;
    stopStream();
    setGen({ phase: "idle" });
  };

  const insert = async (t: number, at: number, request: string, text: string) => {
    if (!text.trim()) return setGen({ phase: "empty", at, request });
    try {
      await k.editNotebook((json) => insertCodeCell(json, at, text));
      if (t === token.current) setGen({ phase: "done", at, request, len: cellsRef.current.length + 1 });
    } catch (e) {
      if (t === token.current) setGen({ phase: "error", at, request, message: `Could not save the notebook: ${String(e)}` });
    }
  };

  const submit = async (at: number, request: string) => {
    if (!request.trim()) return;
    const settings = useAgentStore.getState().settings;
    const problem = settingsProblem(settings);
    if (problem) return setGen({ phase: "setup", at, problem });
    if (busyRef.current) return setGen({ phase: "error", at, request, message: BUSY });
    const t = ++token.current;
    setGen({ phase: "reading", at, request });
    const kernel = await k.inspect();
    if (t !== token.current) return;
    const prompt = buildGeneratePrompt({ cells: cellsRef.current, at, request, kernel });
    const id = `nb-${Date.now().toString(36)}-${t}`;
    genId.current = id;
    code.current = "";
    let raw = "";
    setGen({ phase: "writing", at, request, code: "" });
    const off = await listenGenerate((e) => {
      if (e.id !== id || t !== token.current) return;
      raw += e.text;
      code.current = stripFences(raw);
      setGen((g) => (g.phase === "writing" ? { ...g, code: code.current } : g));
    }).catch(() => () => {});
    try {
      raw = await agentGenerate(id, toProviderConfig(settings), GENERATE_SYSTEM, prompt);
    } catch (e) {
      if (t === token.current) setGen({ phase: "error", at, request, message: String(e).replace(/^Error:\s*/, "").slice(0, 400) });
      return;
    } finally {
      off();
      if (genId.current === id) genId.current = null;
    }
    if (t === token.current) await insert(t, at, request, stripFences(raw));
  };

  /** Stop: what was typed so far becomes the cell. */
  const stop = () => {
    if (gen.phase !== "writing") return cancel();
    const t = ++token.current;
    stopStream();
    void insert(t, gen.at, gen.request, code.current);
  };

  const discard = async () => {
    if (gen.phase !== "done") return;
    const t = ++token.current;
    try {
      await k.editNotebook((json) => removeCell(json, gen.at));
      if (t === token.current) setGen({ phase: "idle" });
    } catch (e) {
      if (t === token.current) setGen({ phase: "error", at: gen.at, request: gen.request, message: `Could not remove the cell: ${String(e)}` });
    }
  };

  const regenerate = async () => {
    if (gen.phase !== "done") return;
    if (busyRef.current) return setGen({ phase: "error", at: gen.at, request: gen.request, message: BUSY });
    const { at, request } = gen;
    try {
      await k.editNotebook((json) => removeCell(json, at));
    } catch (e) {
      return setGen({ phase: "error", at, request, message: `Could not replace the cell: ${String(e)}` });
    }
    await submit(at, request);
  };

  const run = () => {
    if (gen.phase !== "done") return;
    const c = cellsRef.current[gen.at];
    if (c) void k.runCells([{ index: gen.at, code: c.source }]);
    setGen({ phase: "idle" });
  };

  /** Save an edited code cell (and run it with Ctrl/Shift+Enter). */
  const saveCell = async (index: number, source: string, andRun: boolean) => {
    if (busyRef.current) throw new Error(BUSY);
    if (source !== cellsRef.current[index]?.source) await k.editNotebook((json) => setCellSource(json, index, source));
    if (andRun) void k.runCells([{ index, code: source }]);
  };

  return { gen, setGen, open, cancel, submit, stop, discard, regenerate, run, saveCell, locked: k.busy || k.restarting };
}

export type NotebookGen = ReturnType<typeof useNotebookGenerate>;

const btn =
  "flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-1 focus-visible:outline-fahh-accent";
const gutter = "w-16 shrink-0 select-none pt-2 text-right font-mono text-[11px]";

/** The toolbar's ✨ Generate: a new cell at the end. */
export function GenerateButton({ g, at }: { g: NotebookGen; at: number }) {
  return (
    <button
      type="button"
      onClick={() => g.open(at)}
      disabled={g.locked}
      title={g.locked ? BUSY : "Generate a new code cell at the end with Fahh Local"}
      className={`${btn} text-fahh-accent hover:bg-fahh-surface`}
    >
      <Sparkles size={12} aria-hidden="true" /> Generate
    </button>
  );
}

/**
 * The gap before cell `at` (or after the last one): a hover menu to generate there, the prompt
 * box, the streaming cell, or the actions for the cell just generated above it.
 */
export function GenerateSlot({ g, at, cellCount }: { g: NotebookGen; at: number; cellCount: number }) {
  const { gen } = g;
  if (gen.phase === "done" && gen.at + 1 === at && cellCount >= gen.len) return <DoneBar g={g} />;
  if (gen.phase !== "idle" && gen.at === at && !(gen.phase === "done" && cellCount >= gen.len)) return <Active g={g} />;
  if (at === 0) return null;
  return (
    <div className="group/slot relative -my-4 flex h-4 items-center justify-center">
      <button
        type="button"
        onClick={() => g.open(at)}
        disabled={g.locked}
        title={g.locked ? BUSY : undefined}
        className={`${btn} z-10 border border-fahh-surface bg-fahh-sidebar text-[11px] text-fahh-accent opacity-0 shadow-sm hover:bg-fahh-surface focus-visible:opacity-100 group-hover/slot:opacity-100 disabled:opacity-0`}
      >
        <Sparkles size={11} aria-hidden="true" /> Generate code below
      </button>
    </div>
  );
}

function Panel({ children, tone = "normal" }: { children: ReactNode; tone?: "normal" | "error" }) {
  return (
    <div className="fahh-nb-generate flex gap-3">
      <div className={`${gutter} text-fahh-accent`}>
        <Sparkles size={12} className="ml-auto mt-0.5" aria-hidden="true" />
      </div>
      <div
        className={`min-w-0 flex-1 rounded border px-3 py-2 text-xs ${tone === "error" ? "border-fahh-error/40 bg-fahh-error/10" : "border-fahh-accent/40 bg-fahh-sidebar"}`}
      >
        {children}
      </div>
    </div>
  );
}

function Active({ g }: { g: NotebookGen }) {
  const { gen } = g;
  switch (gen.phase) {
    case "prompt":
      return <PromptBox g={g} at={gen.at} initial={gen.request} />;
    case "setup":
      return (
        <Panel>
          <p className="font-semibold text-fahh-text">Set up Fahh Local first</p>
          <p className="mt-0.5 text-fahh-muted">Generate code uses the provider and model you pick for Fahh Local. {gen.problem}</p>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              autoFocus
              className={`${btn} bg-fahh-accent font-semibold text-fahh-bg hover:opacity-85`}
              onClick={() => {
                revealView("agent");
                window.dispatchEvent(new Event(OPEN_AGENT_SETTINGS));
              }}
            >
              <Settings2 size={12} aria-hidden="true" /> Open Fahh Local settings
            </button>
            <button type="button" className={`${btn} text-fahh-muted hover:text-fahh-text`} onClick={g.cancel}>
              Cancel
            </button>
          </div>
        </Panel>
      );
    case "reading":
      return <DraftCell status="Reading your notebook…" onStop={g.cancel} stopLabel="Cancel" />;
    case "writing":
      return <DraftCell status="Writing code…" code={gen.code} onStop={g.stop} stopLabel="Stop" />;
    case "done": // saved, waiting for the preview to show the new cell
      return <DraftCell status="Saving…" />;
    case "error":
    case "empty":
      return (
        <Panel tone={gen.phase === "error" ? "error" : "normal"}>
          <div role="alert">
            <p className={`font-semibold ${gen.phase === "error" ? "text-fahh-error" : "text-fahh-text"}`}>
              {gen.phase === "error" ? "Could not generate code" : "The model returned no code"}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-fahh-muted">
              {gen.phase === "error" ? gen.message : "Try describing the cell differently, or pick another model in Fahh Local."}
            </p>
          </div>
          <div className="mt-2 flex gap-1.5">
            <button type="button" autoFocus className={`${btn} bg-fahh-surface text-fahh-text hover:bg-fahh-surface/70`} onClick={() => void g.submit(gen.at, gen.request)}>
              <RotateCw size={12} aria-hidden="true" /> Try again
            </button>
            <button type="button" className={`${btn} text-fahh-text hover:bg-fahh-surface`} onClick={() => g.setGen({ phase: "prompt", at: gen.at, request: gen.request })}>
              Edit request
            </button>
            <button type="button" className={`${btn} text-fahh-muted hover:text-fahh-text`} onClick={g.cancel}>
              Dismiss
            </button>
          </div>
        </Panel>
      );
    default:
      return null;
  }
}

function PromptBox({ g, at, initial }: { g: NotebookGen; at: number; initial: string }) {
  const [text, setText] = useState(initial);
  const model = useAgentStore((s) => s.settings.model);
  return (
    <Panel>
      <label className="sr-only" htmlFor={`nb-gen-${at}`}>
        Describe what this cell should do
      </label>
      <textarea
        id={`nb-gen-${at}`}
        autoFocus
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            g.cancel();
          } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void g.submit(at, text);
          }
        }}
        placeholder="Describe what this cell should do"
        className="w-full resize-y rounded border border-fahh-surface bg-fahh-bg px-2 py-1.5 text-[13px] text-fahh-text placeholder:text-fahh-muted focus:border-fahh-accent focus:outline-none"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button type="button" disabled={!text.trim()} className={`${btn} bg-fahh-accent font-semibold text-fahh-bg hover:opacity-85`} onClick={() => void g.submit(at, text)}>
          <Sparkles size={12} aria-hidden="true" /> Generate
        </button>
        <button type="button" className={`${btn} text-fahh-muted hover:text-fahh-text`} onClick={g.cancel}>
          Cancel
        </button>
        <span className="ml-1 text-[11px] text-fahh-muted">
          Enter to generate · Esc to cancel · {model} sees the cells above and the kernel's variables
        </span>
      </div>
    </Panel>
  );
}

/** The cell being typed: a skeleton while the notebook is read, then the code as it streams. */
function DraftCell({ status, code, onStop, stopLabel }: { status: string; code?: string; onStop?: () => void; stopLabel?: string }) {
  return (
    <div className="fahh-nb-cell fahh-nb-draft flex flex-col gap-1" data-cell="code" aria-busy="true">
      <div className="flex gap-3">
        <div className={`${gutter} text-fahh-accent`}>
          <span className="animate-pulse">In [✨]:</span>
        </div>
        <div className="min-w-0 flex-1 rounded border border-fahh-accent/60 bg-fahh-sidebar">
          {code ? (
            <pre className="overflow-x-auto px-3 py-2 font-mono text-[12.5px] leading-snug text-fahh-text">
              {code}
              <span className="ml-px inline-block h-[1.1em] w-[7px] translate-y-[2px] animate-pulse bg-fahh-accent" aria-hidden="true" />
            </pre>
          ) : (
            <div className="flex flex-col gap-1.5 px-3 py-2.5" aria-hidden="true">
              <div className="h-2.5 w-1/3 animate-pulse rounded bg-fahh-surface" />
              <div className="h-2.5 w-2/3 animate-pulse rounded bg-fahh-surface" />
              <div className="h-2.5 w-1/2 animate-pulse rounded bg-fahh-surface" />
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 pl-[76px] text-[11px] text-fahh-muted" aria-live="polite">
        <Loader2 size={12} className="animate-spin text-fahh-accent" aria-hidden="true" />
        {status}
        {onStop && (
          <button type="button" onClick={onStop} className={`${btn} text-fahh-text hover:bg-fahh-surface`}>
            <Square size={10} fill="currentColor" aria-hidden="true" /> {stopLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/** Under the generated cell: nothing runs until you say so. */
function DoneBar({ g }: { g: NotebookGen }) {
  return (
    <div className="-mt-2 flex flex-wrap items-center gap-1.5 pl-[76px]" role="group" aria-label="Generated cell">
      <span className="mr-1 text-[11px] text-fahh-muted" aria-live="polite">
        Generated and saved. Review it, then:
      </span>
      <button type="button" autoFocus disabled={g.locked} onClick={g.run} className={`${btn} bg-fahh-accent font-semibold text-fahh-bg hover:opacity-85`}>
        <Play size={11} fill="currentColor" aria-hidden="true" /> Run
      </button>
      <button type="button" disabled={g.locked} onClick={() => void g.regenerate()} className={`${btn} text-fahh-text hover:bg-fahh-surface`}>
        <RotateCw size={12} aria-hidden="true" /> Regenerate
      </button>
      <button type="button" disabled={g.locked} onClick={() => void g.discard()} className={`${btn} text-fahh-text hover:bg-fahh-error/15 hover:text-fahh-error`}>
        <Trash2 size={12} aria-hidden="true" /> Discard
      </button>
      <button type="button" onClick={() => g.setGen({ phase: "idle" })} aria-label="Keep the cell and close" className="ml-1 text-fahh-muted hover:text-fahh-text">
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * A code cell you can edit in place: click to edit, saved to the .ipynb when it loses focus,
 * Ctrl/Shift+Enter saves and runs, Esc throws the edit away.
 */
export function EditableCode({ source, onSave, children }: { source: string; onSave: (src: string, run: boolean) => Promise<void>; children: ReactNode }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const save = async (run: boolean) => {
    if (draft === null || saving) return;
    setSaving(true);
    try {
      await onSave(draft, run);
      setDraft(null);
      setError(null);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setSaving(false);
    }
  };

  if (draft === null) {
    return (
      <div
        role="button"
        tabIndex={0}
        title="Click to edit"
        onClick={() => window.getSelection()?.isCollapsed !== false && setDraft(source)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target === e.currentTarget) {
            e.preventDefault();
            setDraft(source);
          }
        }}
        className="flex min-w-0 flex-1 cursor-text rounded focus-visible:outline focus-visible:outline-1 focus-visible:outline-fahh-accent [&>pre]:hover:border-fahh-muted/50"
      >
        {children}
      </div>
    );
  }
  return (
    <div className="min-w-0 flex-1">
      <textarea
        ref={ref}
        autoFocus
        aria-label="Cell source"
        spellCheck={false}
        value={draft}
        rows={Math.max(2, draft.split("\n").length)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setDraft(null);
            setError(null);
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey || e.shiftKey)) {
            e.preventDefault();
            void save(true);
          } else if (e.key === "Tab" && !e.shiftKey) {
            e.preventDefault();
            const t = e.currentTarget;
            const { selectionStart: a, selectionEnd: b } = t;
            setDraft(draft.slice(0, a) + "    " + draft.slice(b));
            requestAnimationFrame(() => t.setSelectionRange(a + 4, a + 4));
          }
        }}
        className="block w-full resize-none overflow-x-auto whitespace-pre rounded border border-fahh-accent bg-fahh-bg px-3 py-2 font-mono text-[12.5px] leading-snug text-fahh-text focus:outline-none"
      />
      <p className="mt-0.5 text-[11px] text-fahh-muted" aria-live="polite">
        {saving ? "Saving…" : error ? <span className="text-fahh-error">{error}</span> : "Saved when you click away · Ctrl+Enter save and run · Esc cancel"}
      </p>
    </div>
  );
}
