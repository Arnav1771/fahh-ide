import { useEffect, useRef, useState } from "react";
import { ChevronDown, Columns2, Eraser, Maximize2, Plus, Rows2, Terminal as TerminalIcon, Trash2, X } from "lucide-react";
import { useTerminalStore } from "../../store/terminalStore";
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
  const { sessions, activeSessionId, splitSessionIds, isSplitView, splitLayout, createSession, closeSession, setActiveSession, splitTerminal, setSplitLayout } =
    useTerminalStore();
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
  const visible = isSplitView ? sessions.filter((s) => splitSessionIds.includes(s.id)) : [active];
  const iconBtn = "p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface transition-colors";

  return (
    <div className="flex flex-col h-full bg-fahh-bg font-mono text-sm overflow-hidden" data-testid="terminal-panel">
      <div className="flex items-center gap-1 px-2 bg-fahh-sidebar border-b border-fahh-surface shrink-0 h-8 select-none">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 h-full" role="tablist" aria-label="Terminals">
          {sessions.map((s) => {
            const on = s.id === activeSessionId;
            return (
              <div
                key={s.id}
                role="tab"
                aria-selected={on}
                onClick={() => setActiveSession(s.id)}
                className={`group flex items-center gap-1.5 px-2.5 h-full text-[11px] cursor-pointer border-t-2 ${
                  on ? "bg-fahh-bg text-fahh-text border-fahh-accent" : "text-fahh-muted hover:text-fahh-text border-transparent"
                }`}
                title={s.title}
              >
                <TerminalIcon size={12} className={on ? "text-fahh-accent" : ""} />
                <span className="truncate max-w-[140px]">{s.title}</span>
                <button
                  type="button"
                  aria-label={`Kill terminal ${s.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeSession(s.id);
                  }}
                  className="opacity-0 group-hover:opacity-70 hover:!opacity-100 hover:text-fahh-error"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>

        <button type="button" onClick={() => newTerminal()} title="New Terminal (Ctrl+Shift+`)" aria-label="New Terminal" className={iconBtn}>
          <Plus size={14} />
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
        <button type="button" onClick={() => clearTerminal(active.id)} title="Clear Terminal" aria-label="Clear Terminal" className={iconBtn}>
          <Eraser size={14} />
        </button>
        <button type="button" onClick={() => closeSession(active.id)} title="Kill Terminal" aria-label="Kill Terminal" className={`${iconBtn} hover:!text-fahh-error`}>
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
            ? { gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }
            : { gridTemplateRows: `repeat(${visible.length}, minmax(0, 1fr))` }
        }
      >
        {visible.map((s) => (
          <div
            key={s.id}
            className={`flex flex-col min-h-0 min-w-0 ${visible.length > 1 && s.id === activeSessionId ? "ring-1 ring-inset ring-fahh-accent/40" : ""} ${
              visible.length > 1 ? (splitLayout === "horizontal" ? "border-l first:border-l-0" : "border-t first:border-t-0") : ""
            } border-fahh-surface`}
          >
            <XtermPane session={s} active={s.id === activeSessionId} onFocus={() => setActiveSession(s.id)} />
          </div>
        ))}
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
