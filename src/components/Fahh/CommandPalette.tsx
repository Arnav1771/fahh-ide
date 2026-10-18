import { useEffect, useMemo, useRef, useState } from "react";
import { Command, X } from "lucide-react";
import { rankCommands, highlightMatch, type PaletteCommand } from "../../lib/palette";

const RECENT_KEY = "fahh-palette-recent";

function readRecent(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function Keycaps({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k) => (
        <kbd key={k} className="fahh-kbd">
          {k}
        </kbd>
      ))}
    </span>
  );
}

/**
 * Ctrl+Shift+P / F1. Every panel, theme and fahh setting in one searchable
 * list, with the shortcut on each row. Recently used commands come first.
 */
export function CommandPalette({
  open,
  onClose,
  commands,
  placeholder = "Type a command: theme, panel, bell, problem…",
  label = "Command palette",
  recentKey = RECENT_KEY,
  emptyText,
  variant = "command",
}: {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
  placeholder?: string;
  label?: string;
  recentKey?: string;
  /** Shown when there is nothing to list at all (e.g. no folder open). */
  emptyText?: string;
  /** "file": name first, then its folder (Quick Open). */
  variant?: "command" | "file";
}) {
  // A fresh body every time it opens: no query left over from last time,
  // and nothing resets it after the user has started typing.
  return open ? (
    <PaletteBody onClose={onClose} commands={commands} placeholder={placeholder} label={label} recentKey={recentKey} emptyText={emptyText} variant={variant} />
  ) : null;
}

function PaletteBody({
  onClose,
  commands,
  placeholder,
  label,
  recentKey,
  emptyText,
  variant,
}: {
  onClose: () => void;
  commands: PaletteCommand[];
  placeholder: string;
  label: string;
  recentKey: string;
  emptyText?: string;
  variant: "command" | "file";
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [recent] = useState<string[]>(() => readRecent(recentKey));
  const listRef = useRef<HTMLUListElement>(null);

  const ordered = useMemo(() => {
    if (query.trim()) return rankCommands(query, commands);
    const firsts = recent.map((id) => commands.find((c) => c.id === id)).filter(Boolean) as PaletteCommand[];
    return [...firsts, ...commands.filter((c) => !recent.includes(c.id))];
  }, [query, commands, recent]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const run = (cmd: PaletteCommand | undefined) => {
    if (!cmd) return;
    const next = [cmd.id, ...recent.filter((id) => id !== cmd.id)].slice(0, 5);
    try {
      localStorage.setItem(recentKey, JSON.stringify(next));
    } catch {
      // ignore
    }
    onClose();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => (ordered.length ? (i + 1) % ordered.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => (ordered.length ? (i - 1 + ordered.length) % ordered.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(ordered[selected]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="fahh-palette-backdrop fixed inset-0 z-50 flex justify-center pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="fahh-palette w-[580px] max-w-[92vw] h-fit rounded-lg border border-fahh-surface bg-fahh-sidebar shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 border-b border-fahh-surface">
          <Command size={14} className="text-fahh-accent shrink-0" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="fahh-palette-list"
            aria-activedescendant={ordered[selected] ? `fahh-cmd-${ordered[selected].id}` : undefined}
            // Focus on mount: keys typed straight after Ctrl+Shift+P must land here,
            // not on whatever had focus before.
            autoFocus
            className="flex-1 bg-transparent py-3 text-sm text-fahh-text placeholder:text-fahh-muted outline-none focus-visible:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSelected(0);
              }}
              className="p-1 rounded text-fahh-muted hover:text-fahh-text transition-colors"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <ul id="fahh-palette-list" ref={listRef} role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
          {ordered.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-fahh-muted">
              {commands.length === 0 && emptyText ? emptyText : `Nothing matches “${query}”.`}
            </li>
          )}
          {ordered.map((cmd, i) => (
            <li
              key={cmd.id}
              id={`fahh-cmd-${cmd.id}`}
              data-index={i}
              role="option"
              aria-selected={i === selected}
              onMouseMove={() => setSelected(i)}
              onClick={() => run(cmd)}
              className={`fahh-palette-row mx-1 flex cursor-pointer items-center gap-3 rounded px-3 py-1.5 text-sm ${
                i === selected ? "is-selected bg-fahh-surface text-fahh-text" : "text-fahh-text"
              }`}
            >
              {variant === "file" ? (
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="truncate">
                    {highlightMatch(cmd.label, query).map((part, pIdx) => (
                      <span
                        key={pIdx}
                        className={part.match ? "text-[#4a9eff] font-bold underline underline-offset-2" : ""}
                      >
                        {part.text}
                      </span>
                    ))}
                  </span>
                  <span className="truncate font-mono text-[11px] text-fahh-muted">{cmd.group}</span>
                </span>
              ) : (
                <>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono border shrink-0 ${
                    cmd.group.toLowerCase().includes("ai") || cmd.group.toLowerCase().includes("composer")
                      ? "bg-[#4a9eff]/15 text-[#4a9eff] border-[#4a9eff]/30"
                      : cmd.group.toLowerCase().includes("file")
                      ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                      : cmd.group.toLowerCase().includes("view") || cmd.group.toLowerCase().includes("theme")
                      ? "bg-purple-500/15 text-purple-400 border-purple-500/30"
                      : cmd.group.toLowerCase().includes("edit")
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                      : cmd.group.toLowerCase().includes("run")
                      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                      : "bg-white/5 text-fahh-muted border-white/10"
                  }`}>
                    {cmd.group}
                  </span>
                  <span className="flex-1 truncate">
                    {highlightMatch(cmd.label, query).map((part, pIdx) => (
                      <span
                        key={pIdx}
                        className={part.match ? "text-[#4a9eff] font-bold underline underline-offset-2" : ""}
                      >
                        {part.text}
                      </span>
                    ))}
                  </span>
                </>
              )}
              {!query.trim() && i < recent.length && recent.includes(cmd.id) && (
                <span className="text-[10px] uppercase tracking-wider text-fahh-muted">recent</span>
              )}
              {cmd.keys && <Keycaps keys={cmd.keys} />}
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-4 border-t border-fahh-surface px-3 py-1.5 text-[11px] text-fahh-muted">
          <span className="flex items-center gap-1"><Keycaps keys={["↑", "↓"]} /> move</span>
          <span className="flex items-center gap-1"><Keycaps keys={["↵"]} /> run</span>
          <span className="flex items-center gap-1"><Keycaps keys={["Esc"]} /> close</span>
        </div>
      </div>
    </div>
  );
}
