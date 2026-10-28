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

  it("closing the last terminal starts a fresh one", () => {
    for (const s of useTerminalStore.getState().sessions) useTerminalStore.getState().closeSession(s.id);
    expect(useTerminalStore.getState().sessions).toHaveLength(1);
  });
});
