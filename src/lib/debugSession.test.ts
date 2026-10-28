import { describe, it, expect, vi, beforeEach } from "vitest";

// A scripted debug adapter behind the mocked Tauri transport.
type Handler = (e: { payload: { session_id: number; message: string } }) => void;
let handler: Handler | null = null;
const sent: Array<{ command: string; args: Record<string, unknown> }> = [];
let seq = 0;
const bodies: Record<string, unknown> = {
  initialize: { supportsConfigurationDoneRequest: true },
  stackTrace: {
    stackFrames: [
      { id: 11, name: "add", line: 3, column: 1, source: { path: "c:\\proj\\app.py" } },
      { id: 12, name: "<module>", line: 9, column: 1, source: { path: "c:\\proj\\app.py" } },
    ],
  },
  scopes: { scopes: [{ name: "Locals", variablesReference: 100, expensive: false }] },
  variables: { variables: [{ name: "a", value: "1", type: "int", variablesReference: 0 }] },
  evaluate: { result: "42" },
};
const emit = (msg: object) => handler?.({ payload: { session_id: 1, message: JSON.stringify(msg) } });

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, h: Handler) => {
    handler = h;
    return () => {
      handler = null;
    };
  }),
}));
vi.mock("./tauri", () => ({
  debugStart: vi.fn(async () => 1),
  debugStop: vi.fn(async () => {}),
  readFile: vi.fn(async () => {
    throw new Error("no launch.json");
  }),
  writeFile: vi.fn(async () => {}),
  debugRequest: vi.fn(async (_sid: number, command: string, args: Record<string, unknown>) => {
    const s = ++seq;
    sent.push({ command, args });
    queueMicrotask(() => {
      emit({ seq: 1000 + s, type: "response", request_seq: s, success: true, command, body: bodies[command] ?? {} });
      if (command === "initialize") emit({ seq: 2000, type: "event", event: "initialized" });
    });
    return s;
  }),
}));
vi.mock("./navigation", () => ({ openAt: vi.fn(async () => {}) }));

import { startDebugging, stepOver, stopDebugging, evaluate, samePath } from "./debugSession";
import { useDebugStore } from "../store/debugStore";
import { useEditorStore } from "../store/editorStore";
import { useFileStore } from "../store/fileStore";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("debug session over DAP", () => {
  beforeEach(async () => {
    await stopDebugging();
    sent.length = 0;
    seq = 0;
    useDebugStore.setState({ breakpoints: { "C:\\proj\\app.py": [3] }, console: [], error: null });
    useFileStore.setState({ root: "C:\\proj" });
    useEditorStore.setState({
      activeTab: "C:\\proj\\app.py",
      openTabs: [{ path: "C:\\proj\\app.py", name: "app.py", language: "python", dirty: false }],
    } as never);
  });

  it("initializes, sends breakpoints before configurationDone, then launches the active file", async () => {
    await startDebugging();
    await flush();
    const commands = sent.map((s) => s.command);
    expect(commands[0]).toBe("initialize");
    expect(commands).toContain("launch");
    expect(commands.indexOf("setBreakpoints")).toBeLessThan(commands.indexOf("configurationDone"));
    const bp = sent.find((s) => s.command === "setBreakpoints")!.args;
    expect(bp).toMatchObject({ source: { path: "C:\\proj\\app.py" }, lines: [3] });
    const launch = sent.find((s) => s.command === "launch")!.args;
    expect(launch).toMatchObject({ program: "C:\\proj\\app.py", cwd: "C:\\proj", console: "internalConsole" });
    expect(useDebugStore.getState().isDebugging).toBe(true);
  });

  it("on stop loads the stack and locals, and steps the stopped thread", async () => {
    await startDebugging();
    await flush();
    emit({ seq: 3000, type: "event", event: "stopped", body: { reason: "breakpoint", threadId: 5 } });
    await flush();
    await flush();
    const st = useDebugStore.getState();
    expect(st.isPaused).toBe(true);
    expect(st.stackFrames.map((f) => f.name)).toEqual(["add", "<module>"]);
    // The adapter's lower-case drive becomes the editor's spelling: no duplicate tab.
    expect(st.currentFile).toBe("C:\\proj\\app.py");
    expect(st.currentLine).toBe(3);
    expect(st.variables).toEqual([{ name: "a", value: "1", type: "int", variablesReference: 0 }]);

    stepOver();
    await flush();
    expect(sent.at(-1)).toEqual({ command: "next", args: { threadId: 5 } });
    expect(useDebugStore.getState().isPaused).toBe(false);
  });

  it("prints program output and evaluates in the console", async () => {
    await startDebugging();
    await flush();
    emit({ seq: 4000, type: "event", event: "output", body: { category: "stdout", output: "hello\nworld\n" } });
    await evaluate("6*7");
    const lines = useDebugStore.getState().console.map((l) => l.text);
    expect(lines).toContain("hello");
    expect(lines).toContain("world");
    expect(lines).toContain("> 6*7");
    expect(lines).toContain("42");
  });

  it("ends the session when the adapter terminates", async () => {
    await startDebugging();
    await flush();
    emit({ seq: 5000, type: "event", event: "terminated", body: {} });
    await flush();
    expect(useDebugStore.getState().isDebugging).toBe(false);
  });

  it("explains when the file has no debugger", async () => {
    useEditorStore.setState({
      activeTab: "C:\\proj\\notes.md",
      openTabs: [{ path: "C:\\proj\\notes.md", name: "notes.md", language: "markdown", dirty: false }],
    } as never);
    await startDebugging();
    expect(useDebugStore.getState().isDebugging).toBe(false);
    expect(useDebugStore.getState().error).toMatch(/launch\.json/);
  });

  it("compares Windows paths case-insensitively", () => {
    expect(samePath("c:\\a\\B.py", "C:/a/b.py")).toBe(true);
    expect(samePath("/home/a.py", "/home/A.py")).toBe(false);
  });
});
