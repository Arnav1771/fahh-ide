import { useEffect, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, ChevronDown, ChevronRight, Pause, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import { useDebugStore } from "../../store/debugStore";
import { useEditorStore } from "../../store/editorStore";
import { useFileStore } from "../../store/fileStore";
import {
  availableConfigurations,
  continueRun,
  createLaunchJson,
  loadVariables,
  pauseRun,
  restartDebugging,
  selectFrame,
  startDebugging,
  stepInto,
  stepOut,
  stepOver,
  stopDebugging,
} from "../../lib/debugSession";
import type { LaunchConfig } from "../../lib/launchConfig";
import { basenameOf } from "../../lib/launchConfig";
import { openAt } from "../../lib/navigation";
import type { Variable } from "../../lib/types";

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-fahh-surface">
      <div className="flex items-center group">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex-1 flex items-center gap-1 px-2 py-1 text-[11px] uppercase tracking-wide font-semibold text-fahh-muted hover:text-fahh-text"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {title}
        </button>
        <div className="pr-2 opacity-0 group-hover:opacity-100">{actions}</div>
      </div>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

function ToolButton({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="p-1 rounded hover:bg-fahh-surface disabled:opacity-35 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

/** One variable; expandable when the adapter says it has children. */
function VariableRow({ v, depth }: { v: Variable; depth: number }) {
  const [children, setChildren] = useState<Variable[] | null>(null);
  const expandable = v.variablesReference > 0;
  const toggle = async () => {
    if (!expandable) return;
    setChildren(children ? null : await loadVariables(v.variablesReference).catch(() => []));
  };
  return (
    <>
      <div
        onClick={() => void toggle()}
        className={`flex items-center gap-1 pr-2 py-0.5 font-mono text-xs hover:bg-fahh-surface/50 ${expandable ? "cursor-pointer" : ""}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        title={v.type ? `${v.name}: ${v.type}` : v.name}
      >
        <span className="w-3 shrink-0 text-fahh-muted">{expandable ? (children ? "▾" : "▸") : ""}</span>
        <span className="text-fahh-info shrink-0 max-w-[45%] truncate">{v.name}</span>
        <span className="text-fahh-muted">:</span>
        <span className="flex-1 truncate text-fahh-success">{v.value}</span>
      </div>
      {children?.map((c) => <VariableRow key={c.name} v={c} depth={depth + 1} />)}
    </>
  );
}

export function RunDebugView() {
  const st = useDebugStore();
  const activeTab = useEditorStore((s) => s.activeTab);
  const root = useFileStore((s) => s.root);
  const [configs, setConfigs] = useState<LaunchConfig[]>([]);
  const [chosen, setChosen] = useState(0);

  // launch.json can change at any time; re-read it when the view or the active file changes.
  useEffect(() => {
    let live = true;
    void availableConfigurations().then((c) => {
      if (!live) return;
      setConfigs(c);
      setChosen((i) => (i < c.length ? i : 0));
    });
    return () => {
      live = false;
    };
  }, [activeTab, root, st.isDebugging]);

  const breakpoints = Object.entries(st.breakpoints).flatMap(([file, lines]) => lines.map((line) => ({ file, line })));

  return (
    <div className="flex flex-col h-full overflow-y-auto text-sm text-fahh-text">
      {!st.isDebugging ? (
        <div className="px-3 py-3 flex flex-col gap-2 border-b border-fahh-surface">
          {configs.length > 0 && (
            <select
              aria-label="Debug configuration"
              value={chosen}
              onChange={(e) => setChosen(Number(e.target.value))}
              className="w-full bg-fahh-surface rounded px-2 py-1 text-xs outline-none"
            >
              {configs.map((c, i) => (
                <option key={`${c.name}-${i}`} value={i}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => void startDebugging(configs[chosen])}
            disabled={st.starting}
            className="fahh-run-debug w-full flex items-center justify-center gap-2 rounded bg-fahh-accent text-white py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            <Play size={14} />
            {st.starting ? "Starting…" : "Run and Debug"}
          </button>
          {!activeTab && configs.length === 0 && <p className="text-xs text-fahh-muted">Open a file which can be debugged or run.</p>}
          <p className="text-xs text-fahh-muted">
            To customize Run and Debug{" "}
            <button onClick={() => void createLaunchJson()} className="text-fahh-accent hover:underline">
              create a launch.json file
            </button>
            .
          </p>
          {st.error && (
            <div role="alert" className="fahh-debug-error text-xs text-fahh-error whitespace-pre-wrap">
              {st.error}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-fahh-surface">
          {st.isPaused ? (
            <ToolButton title="Continue (F5)" onClick={continueRun}>
              <Play size={15} className="text-fahh-success" />
            </ToolButton>
          ) : (
            <ToolButton title="Pause (F6)" onClick={pauseRun}>
              <Pause size={15} />
            </ToolButton>
          )}
          <ToolButton title="Step Over (F10)" onClick={stepOver} disabled={!st.isPaused}>
            <ArrowRight size={15} />
          </ToolButton>
          <ToolButton title="Step Into (F11)" onClick={stepInto} disabled={!st.isPaused}>
            <ArrowDown size={15} />
          </ToolButton>
          <ToolButton title="Step Out (Shift+F11)" onClick={stepOut} disabled={!st.isPaused}>
            <ArrowUp size={15} />
          </ToolButton>
          <ToolButton title="Restart (Ctrl+Shift+F5)" onClick={() => void restartDebugging()}>
            <RotateCcw size={15} className="text-fahh-success" />
          </ToolButton>
          <ToolButton title="Stop (Shift+F5)" onClick={() => void stopDebugging()}>
            <Square size={15} className="text-fahh-error" />
          </ToolButton>
          <span className="ml-auto text-[11px] text-fahh-muted truncate" title={st.configName ?? ""}>
            {st.isPaused ? "Paused" : "Running"} · {st.configName}
          </span>
        </div>
      )}

      {st.isDebugging && (
        <>
          <Section title="Variables">
            {st.variables.length === 0 ? (
              <div className="px-3 py-1 text-xs text-fahh-muted">{st.isPaused ? "No variables in this scope." : "Pause to see variables."}</div>
            ) : (
              st.variables.map((v) => <VariableRow key={v.name} v={v} depth={0} />)
            )}
          </Section>
          <Section title="Call Stack">
            {st.stackFrames.length === 0 ? (
              <div className="px-3 py-1 text-xs text-fahh-muted">{st.isPaused ? "No frames." : "Running."}</div>
            ) : (
              st.stackFrames.map((f) => (
                <button
                  key={f.id}
                  onClick={() => void selectFrame(f)}
                  className={`w-full flex items-center gap-2 px-3 py-0.5 text-left text-xs hover:bg-fahh-surface/50 ${
                    f.id === st.selectedFrameId ? "bg-fahh-accent/15" : ""
                  }`}
                >
                  <span className="truncate flex-1">{f.name}</span>
                  {f.file && (
                    <span className="text-fahh-muted shrink-0">
                      {basenameOf(f.file)}:{f.line}
                    </span>
                  )}
                </button>
              ))
            )}
          </Section>
        </>
      )}

      <Section
        title={`Breakpoints (${breakpoints.length})`}
        actions={
          breakpoints.length > 0 && (
            <button title="Remove All Breakpoints" aria-label="Remove All Breakpoints" onClick={() => st.clearBreakpoints()} className="text-fahh-muted hover:text-fahh-text">
              <Trash2 size={12} />
            </button>
          )
        }
      >
        {breakpoints.length === 0 ? (
          <div className="px-3 py-1 text-xs text-fahh-muted">Click left of a line number (or press F9) to add one.</div>
        ) : (
          breakpoints.map(({ file, line }) => (
            <div key={`${file}:${line}`} className="group flex items-center gap-2 px-3 py-0.5 text-xs hover:bg-fahh-surface/50">
              <span className="text-fahh-error">●</span>
              <button onClick={() => void openAt(file, line)} className="flex-1 text-left truncate" title={file}>
                {basenameOf(file)}
                <span className="text-fahh-muted"> :{line}</span>
              </button>
              <button
                aria-label={`Remove breakpoint ${basenameOf(file)}:${line}`}
                onClick={() => st.removeBreakpoint(file, line)}
                className="opacity-0 group-hover:opacity-100 text-fahh-muted hover:text-fahh-error"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </Section>
    </div>
  );
}
