/**
 * The prompt box's logic and the small pieces both hosts share: the docked Fahh Local panel
 * and Agent mode. `useComposer` owns the input, the "/" and "@" menus, prompt history, queue
 * and steer; each host lays the box out its own way.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ListPlus, ShieldAlert, Trash2, X } from "lucide-react";

import { calculateContextTokens } from "../../lib/tokenEstimator";
import { filterSlash, groupSlash, insertion, menuQuery, type SlashDef } from "../../lib/slash";
import type { AgentMode } from "../../lib/types";
import { useAgentStore } from "../../store/agentStore";
import { useEditorStore } from "../../store/editorStore";
import { MentionMenu } from "../MentionMenu";
import { SlashMenu } from "./SlashMenu";

export const MODES: { id: AgentMode; label: string; hint: string }[] = [
  { id: "ask", label: "Ask", hint: "Normal: asks before every edit and command" },
  { id: "auto-edit", label: "Edits", hint: "Accept edits: files change right away; commands still ask" },
  { id: "smart", label: "Smart", hint: "Edits auto-approved; a judge model screens each command, unsafe ones ask" },
  { id: "plan", label: "Plan", hint: "Read-only: researches and writes a plan first" },
  { id: "bypass", label: "Bypass", hint: "Auto-approves every prompt. Deny rules still apply" },
];

/** The permission modes as one segmented control. `fill` stretches it to its container (the dock). */
export function ModeSwitch({ fill }: { fill?: boolean }) {
  const mode = useAgentStore((s) => s.settings.mode);
  const setMode = useAgentStore((s) => s.setMode);
  return (
    <div role="radiogroup" aria-label="Agent mode" className={`flex p-0.5 gap-0.5 rounded-md bg-fahh-surface/70 ${fill ? "w-full" : "shrink-0"}`}>
      {MODES.map((m) => {
        const on = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={on}
            title={m.hint}
            onClick={() => setMode(m.id)}
            className={`${fill ? "flex-1" : "px-2.5"} py-0.5 rounded text-[11px] transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-fahh-accent ${
              on ? (m.id === "bypass" ? "bg-fahh-error text-fahh-bg font-medium" : "bg-fahh-bg text-fahh-text font-medium shadow-sm") : "text-fahh-muted hover:text-fahh-text"
            }`}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

/** Bypass mode, said once and compactly: a pill with a one-click way back to Ask. */
export function BypassPill() {
  const mode = useAgentStore((s) => s.settings.mode);
  const setMode = useAgentStore((s) => s.setMode);
  if (mode !== "bypass") return null;
  return (
    <span
      role="status"
      data-testid="bypass-badge"
      title="Bypass: every prompt is auto-approved. Deny rules still block what they name."
      className="inline-flex items-center gap-1 shrink-0 pl-1.5 pr-0.5 py-px rounded-full border border-fahh-error/50 bg-fahh-error/10 text-[11px] text-fahh-error"
    >
      <ShieldAlert size={12} aria-hidden="true" />
      Bypass on
      <button
        type="button"
        onClick={() => setMode("ask")}
        className="ml-0.5 px-1.5 rounded-full hover:bg-fahh-error/15 focus-visible:outline focus-visible:outline-1 focus-visible:outline-fahh-error"
        title="Switch back to Ask: approve each edit and command"
      >
        Turn off
      </button>
    </span>
  );
}

export function useComposer(onClose?: () => void) {
  const store = useAgentStore();
  const { items, status, queue, enqueue, steer } = store;
  const [input, setInput] = useState("");
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuClosed, setMenuClosed] = useState(false);
  const [showMention, setShowMention] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
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

  const placeholder =
    status === "running"
      ? "Running… Enter queues the next prompt, Ctrl+Enter steers this one, / runs a command"
      : "Ask Fahh Local, @ for files and problems, / for commands (Enter to send)";

  return {
    store, input, setText, inputRef, busy, status, queue, tokenBreakdown, placeholder,
    menuOpen, menuItems, menuIndex, setMenuIndex, pick,
    showMention, mentionQuery, setShowMention, handleInputChange, handleSelectMention,
    onKeyDown, submit, handleSteer,
  };
}

export type Composer = ReturnType<typeof useComposer>;

/** What sits above the text box in both hosts: the "/" menu and the prompt queue. */
export function ComposerExtras({ c }: { c: Composer }) {
  const { queue, removeQueueItem, clearQueue } = c.store;
  return (
    <>
      {c.menuOpen && (
        <div data-testid="slash-suggestions">
          <SlashMenu items={c.menuItems} index={c.menuIndex} onPick={c.pick} onHover={c.setMenuIndex} />
        </div>
      )}
      {queue.length > 0 && (
        <div className="mb-1.5 p-2 rounded-lg bg-fahh-surface/80 border border-fahh-surface space-y-1.5" data-testid="prompt-queue">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium text-fahh-accent flex items-center gap-1">
              <ListPlus size={12} aria-hidden="true" />
              Queued next ({queue.length})
            </span>
            <button type="button" onClick={clearQueue} className="text-fahh-muted hover:text-fahh-error text-[10px] flex items-center gap-0.5 transition-colors">
              <Trash2 size={10} aria-hidden="true" /> Clear
            </button>
          </div>
          <div className="space-y-1 max-h-24 overflow-y-auto no-scrollbar">
            {queue.map((q, idx) => (
              <div key={idx} className="flex items-center justify-between gap-1.5 px-2 py-1 rounded bg-fahh-bg text-[11px] text-fahh-text/90 border border-fahh-surface/60">
                <span className="text-[10px] text-fahh-accent font-mono shrink-0 font-semibold">#{idx + 1}</span>
                <span className="truncate flex-1 select-text cursor-text">{q}</span>
                <button type="button" onClick={() => removeQueueItem(idx)} title="Remove prompt from queue" aria-label="Remove prompt from queue" className="text-fahh-muted hover:text-fahh-error shrink-0 p-0.5">
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** The text box with its @ menu. */
export function ComposerInput({ c, className, rows = 3 }: { c: Composer; className: string; rows?: number }) {
  return (
    <div className="relative">
      {c.showMention && <MentionMenu query={c.mentionQuery} onSelect={c.handleSelectMention} onClose={() => c.setShowMention(false)} />}
      <textarea
        ref={c.inputRef}
        value={c.input}
        onChange={c.handleInputChange}
        onKeyDown={c.onKeyDown}
        placeholder={c.placeholder}
        rows={rows}
        disabled={c.status === "needs_input"}
        aria-label="Message or slash command"
        aria-expanded={c.menuOpen}
        className={className}
      />
    </div>
  );
}
