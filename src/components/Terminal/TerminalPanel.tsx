import { useEffect, useRef, useState } from "react";
import { ChevronDown, Columns2, Eraser, Maximize2, Plus, Rows2, Terminal as TerminalIcon, Trash2, X } from "lucide-react";
import { useTerminalStore, type TerminalSession } from "../../store/terminalStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useFileStore } from "../../store/fileStore";
import { ContextMenu, type MenuEntry } from "../ContextMenu";
import { XtermPane, clearTerminal } from "./XtermPane";
import { getProfiles, write } from "../../lib/ptySessions";
import { readTasks, TASKS_TEMPLATE } from "../../lib/tasks";
import { readFile, writeFile, type TerminalProfile } from "../../lib/tauri";
import { openAt } from "../../lib/navigation";
import { revealView, toggleMaximizePanel, toggleZone } from "../../lib/workbench";

function tasksJsonPath(): string | null {
  const root = useFileStore.getState().root;
  if (!root) return null;
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]$/, "")}${sep}.vscode${sep}tasks.json`;
}

/** The profile "+" starts: the one picked in Select Default Profile, or the first found. */
export function defaultProfile(profiles: TerminalProfile[]): TerminalProfile | undefined {
  const id = useSettingsStore.getState().terminalDefaultProfile;
  return profiles.find((p) => p.id === id) ?? profiles[0];
}

type MenuKind = "main" | "default" | "tasks";

export function TerminalPanel() {
  const { sessions, activeSessionId, splitSessionIds, isSplitView, splitLayout, createSession, closeSession, setActiveSession, splitTerminal, setSplitLayout, renameSession } =
    useTerminalStore();
  const workspaceCwd = useTerminalStore((s) => s.cwd);
  const [renaming, setRenaming] = useState<string | null>(null);
  const defaultId = useSettingsStore((s) => s.terminalDefaultProfile);
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
  const [menu, setMenu] = useState<{ kind: MenuKind; x: number; y: number; items?: MenuEntry[] } | null>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void getProfiles().then(setProfiles);
  }, []);

  const newTerminal = (p?: TerminalProfile) => {
    const prof = p ?? defaultProfile(profiles);
    return createSession(prof?.id ?? "", prof?.name);
  };
  const split = (p?: TerminalProfile) => {
    const prof = p ?? defaultProfile(profiles);
    const id = splitTerminal(prof?.id ?? "");
    if (prof) useTerminalStore.getState().renameSession(id, prof.name);
  };

  // Ctrl+Shift+` new terminal, Ctrl+Shift+5 split (VS Code).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      if (e.key === "`" || e.key === "~") {
        e.preventDefault();
        newTerminal();
      } else if (e.key === "5" || e.key === "%") {
        e.preventDefault();
        split();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const at = () => {
    const r = chevronRef.current?.getBoundingClientRect();
    return { x: r ? r.left : 100, y: r ? r.bottom + 2 : 100 };
  };

  const runTask = async () => {
    const path = tasksJsonPath();
    const tasks = path ? readTasks(await readFile(path).catch(() => "")) : [];
    const items: MenuEntry[] = tasks.length
      ? tasks.map((t) => ({
          label: t.label,
          action: () => {
            const prof = defaultProfile(profiles);
            const id = createSession(prof?.id ?? "", `Task - ${t.label}`);
            void write(id, `${t.commandLine}\r`);
          },
        }))
      : [{ label: path ? "No tasks in .vscode/tasks.json" : "Open a folder to use tasks", disabled: true, action: () => {} }];
    setMenu({ kind: "tasks", ...at(), items: [...items, "separator", { label: "Configure Tasks…", action: () => void configureTasks() }] });
  };

  const configureTasks = async () => {
    const path = tasksJsonPath();
    if (!path) return;
    try {
      await readFile(path);
    } catch {
      await writeFile(path, TASKS_TEMPLATE);
    }
    await openAt(path, 1);
  };

  const mainItems = (): MenuEntry[] => [
    { label: "New Terminal", keys: "Ctrl+Shift+`", action: () => newTerminal() },
    { label: "Split Terminal", keys: "Ctrl+Shift+5", action: () => split() },
    "separator",
    ...profiles.map((p): MenuEntry => ({ label: p.name, action: () => newTerminal(p) })),
    "separator",
    ...profiles.map((p): MenuEntry => ({ label: `Split Terminal with ${p.name}`, action: () => split(p) })),
    "separator",
    { label: "Configure Terminal Settings", action: () => revealView("settings") },
    {
      label: "Select Default Profile",
      action: () =>
        setMenu({
          kind: "default",
          ...at(),
          items: profiles.map((p) => ({
            label: `${(defaultProfile(profiles)?.id ?? "") === p.id ? "✓ " : "   "}${p.name}`,
            action: () => useSettingsStore.getState().set("terminalDefaultProfile", p.id),
          })),
        }),
    },
    "separator",
    { label: "Run Task…", action: () => void runTask() },
    { label: "Configure Tasks…", action: () => void configureTasks() },
  ];

  const active = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
  // The split shows while one of its panes is the active terminal; another tab shows alone.
  const inSplit = isSplitView && !!active && splitSessionIds.includes(active.id);
  const visible = inSplit ? sessions.filter((s) => splitSessionIds.includes(s.id)) : active ? [active] : [];
  const iconBtn = "p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface transition-colors";
  /** "PowerShell — agent-proj": the shell and the folder it started in. */
  const paneLabel = (s: TerminalSession) => {
    const dir = (s.cwd || workspaceCwd).replace(/[\\/]+$/, "").split(/[\\/]/).pop();
    return dir ? `${s.title} — ${dir}` : s.title;
  };
  // One tab for the whole split ("PowerShell, PowerShell"), at its first pane's place.
  const tabs: TerminalSession[][] = [];
  for (const s of sessions) {
    if (isSplitView && splitSessionIds.includes(s.id)) {
      if (s.id === splitSessionIds.find((id) => sessions.some((x) => x.id === id))) tabs.push(sessions.filter((x) => splitSessionIds.includes(x.id)));
    } else tabs.push([s]);
  }
  const sessionMenu = (s: TerminalSession, x: number, y: number) =>
    setMenu({
      kind: "main",
      x,
      y,
      items: [
        { label: "Rename…", action: () => setRenaming(s.id) },
        { label: "Split Terminal", keys: "Ctrl+Shift+5", action: () => (setActiveSession(s.id), split()) },
        { label: "Clear", action: () => clearTerminal(s.id) },
        "separator",
        { label: "Kill Terminal", action: () => closeSession(s.id) },
      ],
    });

  return (
    <div className="flex flex-col h-full bg-fahh-bg font-mono text-sm overflow-hidden" data-testid="terminal-panel">
      <div className="flex items-center gap-1 px-2 bg-fahh-sidebar border-b border-fahh-surface shrink-0 h-8 select-none">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 h-full" role="tablist" aria-label="Terminals">
          {tabs.map((group) => {
            const s = group.find((x) => x.id === activeSessionId) ?? group[0];
            const on = group.some((x) => x.id === activeSessionId);
            const title = group.map((x) => x.title).join(", ");
            return (
              <div
                key={group[0].id}
                role="tab"
                aria-selected={on}
                data-testid="terminal-tab"
                onClick={() => setActiveSession(s.id)}
                onDoubleClick={() => group.length === 1 && setRenaming(s.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  sessionMenu(s, e.clientX, e.clientY);
                }}
                className={`group flex items-center gap-1.5 px-2.5 h-full text-[11px] cursor-pointer border-t-2 ${
                  on ? "bg-fahh-bg text-fahh-text border-fahh-accent" : "text-fahh-muted hover:text-fahh-text border-transparent"
                }`}
                title={title}
              >
                {group.length > 1 ? <Columns2 size={12} className={on ? "text-fahh-accent" : ""} /> : <TerminalIcon size={12} className={on ? "text-fahh-accent" : ""} />}
                {renaming === s.id ? (
                  <input
                    autoFocus
                    aria-label="Terminal name"
                    defaultValue={s.title}
                    className="w-28 bg-fahh-surface px-1 text-[11px] outline-none"
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      if (e.target.value.trim()) renameSession(s.id, e.target.value.trim());
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="truncate max-w-[200px]">{title}</span>
                )}
                <button
                  type="button"
                  aria-label={`Kill terminal ${title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    for (const x of group) closeSession(x.id);
                  }}
                  className="opacity-0 group-hover:opacity-70 hover:!opacity-100 hover:text-fahh-error"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => newTerminal()}
          title={`New Terminal: ${defaultProfile(profiles)?.name ?? "default shell"} (Ctrl+Shift+\`)`}
          aria-label="New Terminal"
          className={`${iconBtn} flex items-center gap-1`}
        >
          <Plus size={14} />
          <span className="text-[10px] max-[700px]:hidden" data-testid="terminal-profile-label">{defaultProfile(profiles)?.name}</span>
        </button>
        <button
          ref={chevronRef}
          type="button"
          onClick={() => setMenu({ kind: "main", ...at() })}
          title="Launch Profile…"
          aria-label="Launch Profile"
          className={iconBtn}
        >
          <ChevronDown size={14} />
        </button>
        <button type="button" onClick={() => split()} title="Split Terminal (Ctrl+Shift+5)" aria-label="Split Terminal" className={iconBtn}>
          <Columns2 size={14} />
        </button>
        {isSplitView && (
          <button
            type="button"
            onClick={() => setSplitLayout(splitLayout === "horizontal" ? "vertical" : "horizontal")}
            title="Switch split direction"
            aria-label="Switch split direction"
            className={iconBtn}
          >
            {splitLayout === "horizontal" ? <Rows2 size={14} /> : <Columns2 size={14} />}
          </button>
        )}
        <button type="button" disabled={!active} onClick={() => active && clearTerminal(active.id)} title="Clear Terminal" aria-label="Clear Terminal" className={iconBtn}>
          <Eraser size={14} />
        </button>
        <button type="button" disabled={!active} onClick={() => active && closeSession(active.id)} title="Kill Terminal" aria-label="Kill Terminal" className={`${iconBtn} hover:!text-fahh-error`}>
          <Trash2 size={14} />
        </button>
        <span className="w-px h-4 bg-fahh-surface mx-1" />
        <button type="button" onClick={() => toggleMaximizePanel()} title="Maximize Panel Size" aria-label="Maximize Panel Size" className={iconBtn}>
          <Maximize2 size={13} />
        </button>
        <button type="button" onClick={() => toggleZone("panel")} title="Hide Panel (Ctrl+`)" aria-label="Hide Panel" className={iconBtn}>
          <X size={14} />
        </button>
      </div>

      <div
        className="flex-1 min-h-0 w-full overflow-hidden grid divide-fahh-surface"
        style={
          splitLayout === "horizontal"
            ? { gridTemplateColumns: `repeat(${Math.max(visible.length, 1)}, minmax(0, 1fr))` }
            : { gridTemplateRows: `repeat(${Math.max(visible.length, 1)}, minmax(0, 1fr))` }
        }
      >
        {visible.map((s) => (
          <div
            key={s.id}
            data-testid="terminal-pane"
            data-focused={visible.length > 1 && s.id === activeSessionId ? "true" : undefined}
            className={`relative flex flex-col min-h-0 min-w-0 ${
              visible.length > 1 ? (splitLayout === "horizontal" ? "border-l first:border-l-0" : "border-t first:border-t-0") : ""
            } border-fahh-surface`}
          >
            {visible.length > 1 && (
              <div
                className={`flex items-center gap-1.5 h-6 shrink-0 px-2 text-[11px] select-none border-b border-fahh-surface ${
                  s.id === activeSessionId ? "bg-fahh-surface/60 text-fahh-text" : "text-fahh-muted"
                }`}
                onMouseDown={() => setActiveSession(s.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  sessionMenu(s, e.clientX, e.clientY);
                }}
              >
                <TerminalIcon size={11} className={s.id === activeSessionId ? "text-fahh-accent" : ""} />
                <span className="truncate flex-1" data-testid="terminal-pane-label">{paneLabel(s)}</span>
                <button type="button" aria-label={`Kill terminal ${s.title}`} title="Kill Terminal" onClick={() => closeSession(s.id)} className="opacity-70 hover:opacity-100 hover:text-fahh-error">
                  <X size={11} />
                </button>
              </div>
            )}
            <XtermPane session={s} active={s.id === activeSessionId} onFocus={() => setActiveSession(s.id)} />
            {/* above the canvas, so it shows over the terminal */}
            {visible.length > 1 && s.id === activeSessionId && <div className="pointer-events-none absolute inset-0 z-10 ring-2 ring-inset ring-fahh-accent/70" />}
          </div>
        ))}
        {!active && (
          <div className="flex flex-col items-center justify-center gap-2 text-fahh-muted text-xs" data-testid="terminal-empty">
            <span>No terminals are open.</span>
            <button type="button" onClick={() => newTerminal()} className="flex items-center gap-1 rounded border border-fahh-surface px-3 py-1 text-fahh-text hover:bg-fahh-surface">
              <Plus size={12} /> New Terminal
            </button>
          </div>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items ?? mainItems()}
          onClose={() => setMenu((m) => (m === menu ? null : m))}
        />
      )}
      {/* The default profile's name, for the tests and the status of "+" */}
      <span hidden data-default-profile={defaultId} />
    </div>
  );
}
