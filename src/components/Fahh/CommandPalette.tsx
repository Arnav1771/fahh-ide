import { useEffect, useMemo, useRef, useState } from "react";
import { Command } from "lucide-react";
import { rankCommands, type PaletteCommand } from "../../lib/palette";

const RECENT_KEY = "fahh-palette-recent";

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
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
}: {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
}) {
  // A fresh body every time it opens: no query left over from last time,
  // and nothing resets it after the user has started typing.
  return open ? <PaletteBody onClose={onClose} commands={commands} /> : null;
}

function PaletteBody({ onClose, commands }: { onClose: () => void; commands: PaletteCommand[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [recent] = useState<string[]>(readRecent);
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
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
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
        aria-label="Command palette"
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
            placeholder="Type a command: theme, panel, bell, problem…"
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
        </div>
        <ul id="fahh-palette-list" ref={listRef} role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
          {ordered.length === 0 && <li className="px-4 py-6 text-center text-xs text-fahh-muted">No command matches “{query}”.</li>}
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
              <span className="w-16 shrink-0 font-mono text-[11px] text-fahh-muted">{cmd.group}</span>
              <span className="flex-1 truncate">{cmd.label}</span>
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
