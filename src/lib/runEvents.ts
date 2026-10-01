/**
 * Routes `runner://output` / `runner://exit` events to the run the Run panel
 * started.
 *
 * The backend starts emitting the moment the process prints, but `run_file`
 * only resolves with the pid afterwards. A quick script (`print("hi")`) can
 * print *and exit* before the panel knows its pid; the panel used to drop
 * those events, or apply the exit before `startRun`, and then sat on
 * "● Running" forever with no output. So while a run is starting, events for
 * unknown pids are buffered and replayed once the pid is known.
 *
 * No Tauri or React imports, so it is unit-tested in plain Node.
 */

export type RunStream = "stdout" | "stderr" | "info";

export interface RunRouterSinks {
  onOutput: (line: string, stream: RunStream) => void;
  onExit: (exitCode: number | null, durationMs: number) => void;
}

type Buffered =
  | { kind: "out"; line: string; stream: RunStream }
  | { kind: "exit"; exitCode: number | null; durationMs: number };

export interface RunRouter {
  /** A run is being started: hold events until its pid is known. */
  begin(): void;
  /** `run_file` resolved: replay what this pid already sent, then go live. */
  attach(pid: number): void;
  /** Starting failed: forget anything buffered. */
  cancel(): void;
  output(e: { pid: number; line: string; stream: RunStream }): void;
  exit(e: { pid: number; exit_code: number | null; duration_ms: number }): void;
  /** The pid events are currently routed for (null when idle). */
  current(): number | null;
}

export function createRunRouter(sinks: RunRouterSinks): RunRouter {
  let current: number | null = null;
  let starting = false;
  const buffered = new Map<number, Buffered[]>();

  const hold = (pid: number, ev: Buffered) => {
    const list = buffered.get(pid) ?? [];
    list.push(ev);
    buffered.set(pid, list);
  };

  const deliver = (ev: Buffered) => {
    if (ev.kind === "out") sinks.onOutput(ev.line, ev.stream);
    else {
      current = null;
      sinks.onExit(ev.exitCode, ev.durationMs);
    }
  };

  return {
    begin() {
      starting = true;
      current = null;
      buffered.clear();
    },
    attach(pid) {
      starting = false;
      current = pid;
      const early = buffered.get(pid) ?? [];
      buffered.clear();
      for (const ev of early) {
        deliver(ev);
        if (ev.kind === "exit") break;
      }
    },
    cancel() {
      starting = false;
      buffered.clear();
    },
    output({ pid, line, stream }) {
      const ev: Buffered = { kind: "out", line, stream };
      if (current !== null && pid === current) deliver(ev);
      else if (starting) hold(pid, ev);
    },
    exit({ pid, exit_code, duration_ms }) {
      const ev: Buffered = { kind: "exit", exitCode: exit_code, durationMs: duration_ms };
      if (current !== null && pid === current) deliver(ev);
      else if (starting) hold(pid, ev);
    },
    current() {
      return current;
    },
  };
}
