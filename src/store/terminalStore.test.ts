import { describe, it, expect, vi } from "vitest";
vi.mock("../lib/ptySessions", () => ({ kill: vi.fn() }));
import { useTerminalStore } from "./terminalStore";

describe("terminal tabs", () => {
  it("a new terminal (a task) is shown even while split, and split puts two side by side", () => {
    const a = useTerminalStore.getState().activeSessionId;
    const b = useTerminalStore.getState().splitTerminal("cmd");
    expect(useTerminalStore.getState()).toMatchObject({ isSplitView: true, splitSessionIds: [a, b] });
    const task = useTerminalStore.getState().createSession("", "Task - echo");
    expect(useTerminalStore.getState()).toMatchObject({ isSplitView: false, activeSessionId: task, splitSessionIds: [task] });
  });

  it("closing the last terminal leaves none (the panel offers New Terminal), and kills its shell", async () => {
    const { kill } = await import("../lib/ptySessions");
    const ids = useTerminalStore.getState().sessions.map((s) => s.id);
    for (const id of ids) useTerminalStore.getState().closeSession(id);
    expect(useTerminalStore.getState()).toMatchObject({ sessions: [], activeSessionId: "", splitSessionIds: [], isSplitView: false });
    expect(vi.mocked(kill).mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(ids));
    // split with nothing open just opens one
    const one = useTerminalStore.getState().splitTerminal("bash");
    expect(useTerminalStore.getState()).toMatchObject({ isSplitView: false, activeSessionId: one, splitSessionIds: [one] });
  });

  it("killing one pane of a split keeps the other, and the split ends", () => {
    const a = useTerminalStore.getState().activeSessionId;
    const b = useTerminalStore.getState().splitTerminal("bash");
    const c = useTerminalStore.getState().splitTerminal("bash");
    expect(useTerminalStore.getState().splitSessionIds).toEqual([a, b, c]);
    useTerminalStore.getState().closeSession(c);
    expect(useTerminalStore.getState()).toMatchObject({ isSplitView: true, splitSessionIds: [a, b] });
    useTerminalStore.getState().closeSession(a);
    expect(useTerminalStore.getState()).toMatchObject({ isSplitView: false, activeSessionId: b, splitSessionIds: [b] });
  });
});
