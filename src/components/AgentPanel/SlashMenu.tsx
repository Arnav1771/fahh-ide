import { useEffect, useRef } from "react";
import {
  BarChart3, Bot, CircleHelp, Code2, Copy, Cpu, Download, Eraser, FilePen, FolderMinus, FolderOpen, FolderPlus, GitFork, Gauge, History,
  Keyboard, List, ListChecks, ListOrdered, LogOut, MessageCircleQuestion, MessageSquarePlus, Play, Repeat, Settings, Shield, ShieldAlert,
  Shrink, SlidersHorizontal, Sparkles, Tag, Trash2, Undo2, Users, Zap, type LucideIcon,
} from "lucide-react";

import { groupSlash, type SlashDef } from "../../lib/slash";

const ICONS: Record<string, LucideIcon> = {
  BarChart3, Bot, CircleHelp, Code2, Copy, Cpu, Download, Eraser, FilePen, FolderMinus, FolderOpen, FolderPlus, GitFork, Gauge, History,
  Keyboard, List, ListChecks, ListOrdered, LogOut, MessageCircleQuestion, MessageSquarePlus, Play, Repeat, Settings, Shield, ShieldAlert,
  Shrink, SlidersHorizontal, Sparkles, Tag, Trash2, Undo2, Users, Zap,
};

/** The "/" menu above the input: grouped, one icon and one line per command. Keys are handled by the input. */
export function SlashMenu({ items, index, onPick, onHover }: { items: SlashDef[]; index: number; onPick: (d: SlashDef) => void; onHover: (i: number) => void }) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (items.length === 0) {
    return <div className="mb-1 px-2 py-1.5 text-[11px] text-fahh-muted rounded border border-fahh-surface bg-[#111318]">No command matches. Esc to close.</div>;
  }
  let n = -1;
  return (
    <div role="listbox" aria-label="Slash commands" data-testid="slash-menu" className="mb-1 max-h-56 overflow-y-auto rounded border border-fahh-surface bg-[#111318] text-[11px]">
      {groupSlash(items).map((g) => (
        <div key={g.group}>
          <div className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-fahh-muted sticky top-0 bg-[#111318]">{g.group}</div>
          {g.items.map((d) => {
            n += 1;
            const i = n;
            const Icon = ICONS[d.icon] ?? Bot;
            const active = i === index;
            return (
              <button
                key={d.name}
                ref={active ? activeRef : undefined}
                role="option"
                aria-selected={active}
                onMouseEnter={() => onHover(i)}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep the input focused
                  onPick(d);
                }}
                className={`w-full flex items-start gap-2 px-2 py-1 text-left ${active ? "bg-fahh-accent/20" : "hover:bg-fahh-surface"}`}
              >
                <Icon size={13} className="mt-[1px] shrink-0 text-fahh-accent" />
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-fahh-text">/{d.name}</span>
                  {d.args && <span className="ml-1 font-mono text-fahh-muted">{d.args}</span>}
                  <span className="block text-fahh-muted truncate">{d.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
