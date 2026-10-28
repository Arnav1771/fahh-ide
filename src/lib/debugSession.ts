/**
 * One debug session at a time, driven over DAP: start the adapter, initialize, launch,
 * send breakpoints, then react to stopped / output / terminated. The Run and Debug view,
 * the Debug Console, the editor gutter and F5/F9/F10/F11 all go through here.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { debugRequest, debugStart, debugStop, readFile, writeFile } from "./tauri";
import { DapClient } from "./dap";
import {
  adapterFor,
  basenameOf,
  defaultConfigFor,
  dirnameOf,
  launchArguments,
  launchJsonTemplate,
  readConfigurations,
  substitute,
  type LaunchConfig,
} from "./launchConfig";
import { openAt } from "./navigation";
import { useDebugStore } from "../store/debugStore";
import { useEditorStore } from "../store/editorStore";
import { useFileStore } from "../store/fileStore";
import type { DapEventPayload, StackFrame, Variable } from "./types";

let client: DapClient | null = null;
let unlisten: UnlistenFn | null = null;
let lastConfig: LaunchConfig | null = null;
/** configurationDone was sent: breakpoint edits now go straight to the adapter. */
let configured = false;

/** Windows paths compare case-insensitively and with either slash; adapters report "c:\\x" for "C:\\x". */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const x = norm(a);
  const y = norm(b);
  return /^[a-z]:\//i.test(x) || /^\/\/wsl/i.test(x) ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/** The path as the editor knows it (an open tab's spelling), so a stop never opens a duplicate tab. */
function editorPath(p: string): string {
  if (!p) return p;
  const tab = useEditorStore.getState().openTabs.find((t) => samePath(t.path, p));
  if (tab) return tab.path;
  return /^[a-z]:[\\/]/.test(p) ? p[0].toUpperCase() + p.slice(1) : p;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const store = () => useDebugStore.getState();

function activeFile(): { path: string; language: string } {
  const { activeTab, openTabs } = useEditorStore.getState();
  const tab = openTabs.find((t) => t.path === activeTab);
  return { path: activeTab ?? "", language: tab?.language ?? "" };
}

function workspaceFolder(file: string): string {
  return useFileStore.getState().root ?? (file ? dirnameOf(file) : "");
}

/** `<root>/.vscode/launch.json`, in the root's own separator style. */
export function launchJsonPath(): string | null {
  const root = useFileStore.getState().root;
  if (!root) return null;
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]$/, "")}${sep}.vscode${sep}launch.json`;
}

/** The folder's launch.json configurations; [] when there is none. */
export async function loadConfigurations(): Promise<LaunchConfig[]> {
  const path = launchJsonPath();
  if (!path) return [];
  try {
    return readConfigurations(await readFile(path));
  } catch {
    return [];
  }
}

/** The configurations Run and Debug offers: launch.json's, or the active file's default. */
export async function availableConfigurations(): Promise<LaunchConfig[]> {
  const fromFile = await loadConfigurations();
  if (fromFile.length) return fromFile;
  const fallback = defaultConfigFor(activeFile().language);
  return fallback ? [fallback] : [];
}

/** Write a starter launch.json (if there is none) and open it. */
export async function createLaunchJson(): Promise<void> {
  const path = launchJsonPath();
  if (!path) {
    store().patch({ error: "Open a folder first: launch.json lives in its .vscode folder." });
    return;
  }
  try {
    await readFile(path);
  } catch {
    await writeFile(path, launchJsonTemplate(activeFile().language || "python"));
  }
  await openAt(path, 1);
}

export async function startDebugging(chosen?: LaunchConfig): Promise<void> {
  const st = store();
  if (st.isDebugging || st.starting) return;
  const { path: file, language } = activeFile();
  const cfg = chosen ?? (await loadConfigurations())[0] ?? defaultConfigFor(language);
  if (!cfg) {
    st.patch({
      error: file
        ? `Fahh cannot debug ${language || "this file"} without a launch.json. Create one below.`
        : "Open a file to debug, or create a launch.json.",
    });
    return;
  }
  const ctx = { file, workspaceFolder: workspaceFolder(file) };
  const resolved = substitute(cfg, ctx);
  const adapter = adapterFor(resolved.type);
  if (!adapter) {
    st.patch({ error: `Debug type "${resolved.type}" is not supported. Fahh can debug Python, Go, and C/C++/Rust (lldb-dap).` });
    return;
  }
  const args = launchArguments(resolved, ctx);
  lastConfig = cfg;
  st.patch({ starting: true, error: null, configName: cfg.name });
  st.clearConsole();

  let sid: number;
  try {
    sid = await debugStart({ adapter, program: String(args.program ?? file), cwd: String(args.cwd ?? "") });
  } catch (e) {
    store().patch({ starting: false, error: errorText(e) });
    return;
  }

  configured = false;
  const c = new DapClient((command, a) => debugRequest(sid, command, a), (event, body) => void onEvent(event, body));
  client = c;
  unlisten = await listen<DapEventPayload>("dap://event", (e) => {
    if (e.payload.session_id === sid) c.handle(e.payload.message);
  });
  store().start(sid);
  store().log("console", `Starting ${cfg.name}…`);

  try {
    await c.request("initialize", {
      clientID: "fahh-editor",
      clientName: "Fahh Editor",
      adapterID: adapter,
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: "path",
      supportsVariableType: true,
      supportsRunInTerminalRequest: false,
    });
    // debugpy answers launch only after configurationDone, which the `initialized` event sends.
    await c.request(resolved.request === "attach" ? "attach" : "launch", args);
  } catch (e) {
    if (client !== c) return; // stopped meanwhile
    const msg = errorText(e);
    store().log("stderr", msg);
    await stopDebugging();
    store().patch({ error: msg });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function onEvent(event: string, body: any): Promise<void> {
  const c = client;
  if (!c) return;
  switch (event) {
    case "initialized":
      await sendAllBreakpoints();
      await c.request("configurationDone").catch(() => {});
      configured = true;
      break;
    case "stopped":
      await refreshStack(typeof body.threadId === "number" ? body.threadId : null).catch((e) => store().log("stderr", errorText(e)));
      break;
    case "continued":
      store().resume();
      break;
    case "output":
      if (body.category !== "telemetry" && typeof body.output === "string") store().log(body.category ?? "console", body.output);
      break;
    case "exited":
      store().log("console", `Process exited with code ${body.exitCode ?? "?"}`);
      break;
    case "terminated":
      await stopDebugging();
      break;
  }
}

async function refreshStack(threadId: number | null): Promise<void> {
  const c = client;
  if (!c) return;
  const tid = threadId ?? store().threadId ?? (await c.request("threads")).threads?.[0]?.id ?? null;
  if (tid === null) return;
  const res = await c.request("stackTrace", { threadId: tid, startFrame: 0, levels: 50 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const frames: StackFrame[] = (res.stackFrames ?? []).map((f: any) => ({
    id: f.id,
    name: f.name,
    file: editorPath(f.source?.path ?? ""),
    line: f.line,
    column: f.column,
  }));
  store().patch({ threadId: tid, isPaused: true, stackFrames: frames });
  const top = frames.find((f) => f.file) ?? frames[0];
  if (top) await selectFrame(top);
}

/** Show a frame: its location in the editor and its local variables. */
export async function selectFrame(frame: StackFrame): Promise<void> {
  store().patch({ selectedFrameId: frame.id, currentFile: frame.file || null, currentLine: frame.line });
  if (frame.file) void openAt(frame.file, frame.line);
  const c = client;
  if (!c) return;
  try {
    const { scopes = [] } = await c.request("scopes", { frameId: frame.id });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scope = scopes.find((s: any) => !s.expensive) ?? scopes[0];
    store().setVariables(scope ? await loadVariables(scope.variablesReference) : []);
  } catch (e) {
    store().log("stderr", errorText(e));
  }
}

/** Children of a variable (or a scope). */
export async function loadVariables(variablesReference: number): Promise<Variable[]> {
  if (!client || !variablesReference) return [];
  const { variables = [] } = await client.request("variables", { variablesReference });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return variables.map((v: any) => ({
    name: String(v.name),
    value: String(v.value ?? ""),
    type: v.type ?? null,
    variablesReference: v.variablesReference ?? 0,
  }));
}

function threadRequest(command: string, resumes: boolean): void {
  const c = client;
  const { threadId } = store();
  if (!c || threadId === null) return;
  if (resumes) store().resume();
  c.request(command, { threadId }).catch((e) => store().log("stderr", errorText(e)));
}

export const continueRun = () => threadRequest("continue", true);
export const stepOver = () => threadRequest("next", true);
export const stepInto = () => threadRequest("stepIn", true);
export const stepOut = () => threadRequest("stepOut", true);
export function pauseRun(): void {
  const c = client;
  if (!c) return;
  // Before the first stop there is no thread yet: ask for one.
  void (async () => {
    const threadId = store().threadId ?? (await c.request("threads")).threads?.[0]?.id;
    if (threadId !== undefined) await c.request("pause", { threadId });
  })().catch((e) => store().log("stderr", errorText(e)));
}

export async function stopDebugging(): Promise<void> {
  const sid = store().sessionId;
  client?.close();
  client = null;
  configured = false;
  unlisten?.();
  unlisten = null;
  store().stop();
  if (sid !== null) await debugStop(sid).catch(() => {});
}

export async function restartDebugging(): Promise<void> {
  const cfg = lastConfig;
  await stopDebugging();
  await startDebugging(cfg ?? undefined);
}

/** F5: start, or continue when paused. */
export function startOrContinue(): void {
  const st = store();
  if (!st.isDebugging) void startDebugging();
  else if (st.isPaused) continueRun();
}

/** Evaluate in the Debug Console, in the selected frame when paused. */
export async function evaluate(expression: string): Promise<void> {
  const st = store();
  st.log("input", `> ${expression}`);
  if (!client) {
    st.log("stderr", "No debug session. Start one with F5.");
    return;
  }
  try {
    const res = await client.request("evaluate", {
      expression,
      frameId: st.selectedFrameId ?? undefined,
      context: "repl",
    });
    store().log("console", String(res.result ?? ""));
  } catch (e) {
    store().log("stderr", errorText(e));
  }
}

/** F9 in the editor: toggle a breakpoint on the cursor's line of the active file. */
export function toggleBreakpointAt(file: string | null, line: number | null): void {
  if (!file || !line) return;
  store().toggleBreakpoint(file, line);
}

async function sendBreakpoints(file: string, lines: number[]): Promise<void> {
  const c = client;
  if (!c) return;
  await c
    .request("setBreakpoints", {
      source: { path: file, name: basenameOf(file) },
      breakpoints: lines.map((line) => ({ line })),
      lines,
    })
    .catch((e) => store().log("stderr", `Breakpoints in ${basenameOf(file)}: ${errorText(e)}`));
}

async function sendAllBreakpoints(): Promise<void> {
  for (const [file, lines] of Object.entries(store().breakpoints)) await sendBreakpoints(file, lines);
}

// Breakpoints added or removed mid-session reach the adapter right away.
useDebugStore.subscribe((s, prev) => {
  if (!configured || s.breakpoints === prev.breakpoints) return;
  const files = new Set([...Object.keys(s.breakpoints), ...Object.keys(prev.breakpoints)]);
  for (const file of files) {
    if (s.breakpoints[file] !== prev.breakpoints[file]) void sendBreakpoints(file, s.breakpoints[file] ?? []);
  }
});
