/**
 * Live Python kernel for the notebook preview, as in VS Code: pick an environment, run a cell
 * or all of them, interrupt, restart. One fahh_kernel.py process per open notebook, started on
 * the first run and fed commands over stdin; outputs stream back and are saved into the .ipynb.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Copy, Loader2, Play, RotateCw, Square, SquareTerminal, X } from "lucide-react";
import { createRunRouter, type RunRouter } from "../../lib/runEvents";
import { pythonKernels, readFile, runFile, runStdin, stopRun, writeFile, type PythonEnv } from "../../lib/tauri";
import type { RunOutputEvent } from "../../lib/types";
import {
  applyKernelEvent,
  ipykernelInstallCommand,
  kernelBusy,
  kernelKey,
  lastLines,
  parseKernelLine,
  queueCells,
  settleRuns,
  workspacePython,
  type CellRuns,
  type KernelEvent,
} from "../../lib/python";
import { useEditorStore } from "../../store/editorStore";
import { useFileStore } from "../../store/fileStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useTerminalStore } from "../../store/terminalStore";
import { write } from "../../lib/ptySessions";
import { revealView } from "../../lib/workbench";

export interface KernelChoice {
  program: string;
  /** ".venv", "Python311", "base"… */
  name: string;
  version?: string;
  /** false when the picker's probe found no ipykernel. */
  ipykernel?: boolean;
}

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "ready" }
  | { kind: "missing" }
  | { kind: "stopped"; code: number | null; lines: string[] };

const readChoice = (path: string): KernelChoice | null => {
  try {
    const v = JSON.parse(localStorage.getItem(kernelKey(path)) ?? "null");
    return v && typeof v.program === "string" ? v : null;
  } catch {
    return null;
  }
};
const saveChoice = (path: string, c: KernelChoice) => {
  try {
    localStorage.setItem(kernelKey(path), JSON.stringify(c));
  } catch {
    // storage blocked: remembered for this session only
  }
};

/** Probing every interpreter takes a moment: once per folder, shared by all notebooks. */
const envCache = new Map<string, Promise<PythonEnv[]>>();
const loadEnvs = (root: string | null, fresh = false) => {
  const key = root ?? "";
  if (fresh || !envCache.has(key)) envCache.set(key, pythonKernels(root).catch(() => []));
  return envCache.get(key)!;
};

const envName = (e: PythonEnv) => e.label.replace(/^Python [\d.]+ · /, "").replace(/ \(\w+\)$/, "");

/** "Python 3.11 · .venv" */
export const kernelLabel = (k: KernelChoice | null) => (k ? `Python${k.version ? " " + k.version.split(".").slice(0, 2).join(".") : ""} · ${k.name}` : "Python");

export function useNotebookKernel(path: string) {
  const root = useFileStore((s) => s.root);
  const pythonPath = useSettingsStore((s) => s.pythonPath);
  const [kernel, setKernel] = useState<KernelChoice | null>(() => readChoice(path));
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [runs, setRuns] = useState<CellRuns>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [envs, setEnvs] = useState<PythonEnv[] | null>(null);

  const pidRef = useRef<number | null>(null);
  const pending = useRef<string[]>([]);
  const ready = useRef(false);
  const stderr = useRef<string[]>([]);
  const quitting = useRef(false);
  const starting = useRef(false);
  const kernelRef = useRef(kernel);
  kernelRef.current = kernel;

  // Default kernel: the workspace interpreter (Run's pick) unless this notebook remembers one.
  useEffect(() => {
    if (readChoice(path)) return;
    let live = true;
    void workspacePython().then((p) => live && setKernel({ program: p.program, name: p.label }));
    return () => {
      live = false;
    };
  }, [path, root, pythonPath]);

  useEffect(() => {
    let live = true;
    void loadEnvs(root).then((e) => live && setEnvs(e));
    return () => {
      live = false;
    };
  }, [root]);

  // Fill in version / ipykernel for the chosen kernel once the picker's probe knows them.
  useEffect(() => {
    const e = envs?.find((x) => x.program === kernel?.program);
    if (e && (kernel?.version !== e.version || kernel?.ipykernel !== e.ipykernel)) setKernel((k) => (k ? { ...k, version: e.version, ipykernel: e.ipykernel } : k));
  }, [envs, kernel]);

  const reloadFile = useCallback(async () => {
    try {
      useEditorStore.getState().setContent(path, await readFile(path));
    } catch {
      // the outputs still show from this session
    }
  }, [path]);

  const onEvent = useCallback(
    (ev: KernelEvent) => {
      switch (ev.type) {
        case "ready":
          ready.current = true;
          setPhase({ kind: "ready" });
          setKernel((k) => (k ? { ...k, version: ev.version, ipykernel: true } : k));
          for (const line of pending.current.splice(0)) void runStdin(pidRef.current!, line);
          return;
        case "missing":
          setPhase({ kind: "missing" });
          setKernel((k) => (k ? { ...k, ipykernel: false } : k));
          return;
        case "restarted":
          setRestarting(false);
          return;
        case "fatal":
          setNotice(ev.message);
          return;
        case "done":
          void reloadFile(); // the runner saved this cell into the file
          break;
      }
      setRuns((r) => applyKernelEvent(r, ev));
    },
    [reloadFile],
  );

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // One router for the hook's lifetime: events can arrive before run_file returns the pid.
  const router = useRef<RunRouter | null>(null);
  if (!router.current) {
    router.current = createRunRouter({
      onOutput: (line, stream) => {
        if (stream === "stdout") {
          const ev = parseKernelLine(line);
          if (ev) onEventRef.current(ev);
        } else if (stream === "stderr") {
          stderr.current = [...stderr.current.slice(-50), line];
        }
      },
      onExit: (code) => {
        pidRef.current = null;
        ready.current = false;
        pending.current = [];
        setRuns(settleRuns);
        setRestarting(false);
        setPhase((p) => (p.kind === "missing" ? p : quitting.current ? { kind: "idle" } : { kind: "stopped", code, lines: lastLines(stderr.current) }));
        quitting.current = false;
      },
    });
  }
  useEffect(() => {
    let live = true;
    const offs: Array<() => void> = [];
    void listen<RunOutputEvent>("runner://output", (e) => live && router.current!.output(e.payload)).then((f) => offs.push(f));
    void listen<{ pid: number; exit_code: number | null; duration_ms: number }>("runner://exit", (e) => live && router.current!.exit(e.payload)).then((f) => offs.push(f));
    return () => {
      live = false;
      offs.forEach((f) => f());
    };
  }, []);

  const shutdown = useCallback(() => {
    const pid = pidRef.current;
    if (pid === null) return;
    quitting.current = true;
    void runStdin(pid, JSON.stringify({ op: "shutdown" })).catch(() => {});
    // ponytail: fixed grace period; the runner normally exits well within it.
    window.setTimeout(() => {
      if (pidRef.current === pid) void stopRun(pid).catch(() => {});
    }, 3000);
  }, []);

  useEffect(() => shutdown, [shutdown]); // closing the notebook stops its kernel

  /** The runner saves outputs by cell index, so the file must match what is on screen. */
  const flush = async () => {
    const ed = useEditorStore.getState();
    const tab = ed.openTabs.find((t) => t.path === path);
    const text = ed.fileContents[path];
    if (tab?.dirty && text !== undefined) {
      await writeFile(path, text);
      ed.markDirty(path, false);
    }
  };

  const send = (cmd: object) => {
    const line = JSON.stringify(cmd);
    if (pidRef.current !== null && ready.current) void runStdin(pidRef.current, line).catch((e) => setNotice(String(e)));
    else pending.current.push(line);
  };

  const start = async () => {
    const k = kernelRef.current ?? { program: (await workspacePython()).program, name: "python" };
    stderr.current = [];
    starting.current = true;
    setPhase({ kind: "starting" });
    router.current!.begin();
    try {
      const r = await runFile({ path, language: "kernel", interpreter: k.program });
      pidRef.current = r.pid;
      starting.current = false;
      router.current!.attach(r.pid);
    } catch (e) {
      starting.current = false;
      router.current!.cancel();
      pending.current = [];
      setRuns(settleRuns);
      setPhase({ kind: "stopped", code: null, lines: [String(e)] });
    }
  };

  const runCells = async (cells: { index: number; code: string }[]) => {
    if (cells.length === 0) return;
    setNotice(null);
    try {
      await flush();
    } catch (e) {
      setNotice(`Could not save the notebook before running: ${String(e)}`);
      return;
    }
    setRuns((r) => queueCells(r, cells.map((c) => c.index)));
    for (const c of cells) send({ op: "run", cell: c.index, code: c.code });
    if (pidRef.current === null && !starting.current) await start();
  };

  const interrupt = () => {
    if (!ready.current) {
      pending.current = [];
      setRuns(settleRuns);
      return;
    }
    send({ op: "interrupt" });
  };

  const restart = () => {
    if (pidRef.current === null) return;
    setRestarting(true);
    setRuns(settleRuns);
    send({ op: "restart" });
  };

  const choose = (k: KernelChoice) => {
    saveChoice(path, k);
    shutdown();
    setKernel(k);
    setRuns(settleRuns);
    setPhase(k.ipykernel === false ? { kind: "missing" } : { kind: "idle" });
  };

  const refreshEnvs = () => {
    setEnvs(null);
    void loadEnvs(root, true).then(setEnvs);
  };

  return {
    kernel,
    phase,
    runs,
    busy: kernelBusy(runs),
    restarting,
    notice,
    envs,
    root,
    clearNotice: () => setNotice(null),
    runCells,
    interrupt,
    restart,
    choose,
    refreshEnvs,
    dismiss: () => setPhase({ kind: "idle" }),
  };
}

export type NotebookKernel = ReturnType<typeof useNotebookKernel>;

const btn = "flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-1 focus-visible:outline-fahh-accent";

/** Run all / Interrupt / Restart, the status, and the kernel picker. */
export function KernelToolbar({ k, cells }: { k: NotebookKernel; cells: { index: number; code: string }[] }) {
  const starting = k.phase.kind === "starting";
  const live = k.phase.kind === "ready" || starting;
  const status = k.restarting
    ? "Restarting kernel…"
    : starting
    ? "Starting kernel…"
    : k.busy
    ? "Running cells…"
    : k.phase.kind === "ready"
    ? "Idle"
    : "";
  return (
    <div className="fahh-nb-toolbar shrink-0 border-b border-fahh-surface bg-fahh-sidebar">
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5">
        <button
          type="button"
          onClick={() => void k.runCells(cells)}
          disabled={cells.length === 0 || k.busy || k.restarting}
          title="Run all cells"
          className={`${btn} fahh-primary bg-fahh-accent font-semibold text-fahh-bg hover:opacity-85`}
        >
          <Play size={12} fill="currentColor" aria-hidden="true" /> Run all
        </button>
        <button type="button" onClick={k.interrupt} disabled={!k.busy} title="Interrupt the running cell" className={`${btn} text-fahh-text hover:bg-fahh-surface`}>
          <Square size={11} fill="currentColor" aria-hidden="true" /> Interrupt
        </button>
        <button type="button" onClick={k.restart} disabled={!live || k.restarting} title="Restart the kernel (variables are cleared)" className={`${btn} text-fahh-text hover:bg-fahh-surface`}>
          <RotateCw size={12} className={k.restarting ? "animate-spin" : ""} aria-hidden="true" /> Restart
        </button>
        <span className="ml-1 flex items-center gap-1.5 text-[11px] text-fahh-muted" aria-live="polite">
          {(k.busy || starting || k.restarting) && <Loader2 size={12} className="animate-spin text-fahh-accent" aria-hidden="true" />}
          {status}
        </span>
        <div className="flex-1" />
        <KernelPicker k={k} />
      </div>
      <KernelBanner k={k} />
    </div>
  );
}

function KernelPicker({ k }: { k: NotebookKernel }) {
  const groups: Array<[PythonEnv["group"], string]> = [
    ["workspace", "Workspace"],
    ["conda", "Conda"],
    ["global", "Global"],
  ];
  const known = k.envs?.some((e) => e.program === k.kernel?.program);
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-fahh-muted">
      <span className="sr-only">Kernel</span>
      <select
        value={k.kernel?.program ?? ""}
        onChange={(e) => {
          if (e.target.value === "__refresh") return k.refreshEnvs();
          const env = k.envs?.find((x) => x.program === e.target.value);
          if (env) k.choose({ program: env.program, name: envName(env), version: env.version, ipykernel: env.ipykernel });
        }}
        title={k.kernel ? `${kernelLabel(k.kernel)}\n${k.kernel.program}` : "Select kernel"}
        className="max-w-64 cursor-pointer truncate rounded border border-fahh-surface bg-fahh-surface px-1.5 py-0.5 font-mono text-[11px] text-fahh-text focus:border-fahh-accent focus:outline-none"
      >
        {!known && <option value={k.kernel?.program ?? ""}>{kernelLabel(k.kernel)}</option>}
        {k.envs === null && <option disabled>Finding Python environments…</option>}
        {k.envs?.length === 0 && <option disabled>No Python found. Set one in Settings › Python.</option>}
        {groups.map(([g, name]) => {
          const list = k.envs?.filter((e) => e.group === g) ?? [];
          return list.length ? (
            <optgroup key={g} label={name}>
              {list.map((e) => (
                <option key={e.program} value={e.program}>
                  {e.label}
                  {e.ipykernel ? "" : " · needs ipykernel"}
                </option>
              ))}
            </optgroup>
          ) : null;
        })}
        {k.envs !== null && <option value="__refresh">Refresh list…</option>}
      </select>
    </label>
  );
}

function runInTerminal(command: string, cwd: string | null) {
  const id = useTerminalStore.getState().createSession("", "pip install ipykernel", cwd ?? undefined);
  revealView("terminal");
  void write(id, `${command}\r`);
}

/** Missing ipykernel, a kernel that stopped, or a warning from the runner. */
function KernelBanner({ k }: { k: NotebookKernel }) {
  const [copied, setCopied] = useState(false);
  if (k.phase.kind === "missing" && k.kernel) {
    const command = ipykernelInstallCommand(k.kernel.program, k.root);
    return (
      <div role="alert" className="fahh-nb-missing mx-3 mb-2 rounded border border-fahh-warn/40 bg-fahh-warn/10 px-3 py-2 text-xs text-fahh-text">
        <p>
          <span className="font-semibold text-fahh-warn">{kernelLabel(k.kernel)} needs ipykernel</span> to run cells. Install it in that environment:
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <code className="select-all rounded bg-fahh-bg px-2 py-1 font-mono text-[11.5px]">{command}</code>
          <button type="button" className={`${btn} bg-fahh-surface text-fahh-text hover:bg-fahh-surface/70`} onClick={() => runInTerminal(command, k.root)}>
            <SquareTerminal size={12} aria-hidden="true" /> Run in terminal
          </button>
          <button
            type="button"
            className={`${btn} text-fahh-muted hover:text-fahh-text`}
            onClick={() => void navigator.clipboard?.writeText(command).then(() => setCopied(true), () => {})}
          >
            <Copy size={12} aria-hidden="true" /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-fahh-muted">Then run a cell again. Fahh never installs packages on its own.</p>
      </div>
    );
  }
  if (k.phase.kind === "stopped") {
    return (
      <div role="alert" className="fahh-nb-stopped mx-3 mb-2 rounded border border-fahh-error/40 bg-fahh-error/10 px-3 py-2 text-xs">
        <div className="flex items-start gap-2">
          <p className="flex-1 text-fahh-error">
            The kernel stopped{k.phase.code !== null ? ` (exit ${k.phase.code})` : ""}. Run a cell to start it again.
          </p>
          <button type="button" onClick={k.dismiss} aria-label="Dismiss" className="text-fahh-muted hover:text-fahh-text">
            <X size={13} aria-hidden="true" />
          </button>
        </div>
        {k.phase.lines.length > 0 && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-fahh-error/90">{k.phase.lines.join("\n")}</pre>}
      </div>
    );
  }
  if (k.notice) {
    return (
      <div role="status" className="mx-3 mb-2 flex items-start gap-2 rounded border border-fahh-warn/40 bg-fahh-warn/10 px-3 py-1.5 text-xs text-fahh-warn">
        <p className="flex-1">{k.notice}</p>
        <button type="button" onClick={k.clearNotice} aria-label="Dismiss" className="text-fahh-muted hover:text-fahh-text">
          <X size={13} aria-hidden="true" />
        </button>
      </div>
    );
  }
  return null;
}
