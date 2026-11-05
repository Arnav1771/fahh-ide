import { describe, expect, it, vi } from "vitest";

const calls: { cmd: string; args: unknown }[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: unknown) => {
    calls.push({ cmd, args });
    return [];
  }),
}));

const { useAgentStore } = await import("./agentStore");

const turn = (accepted: string[]) => ({ 1: { turn: 1, files: ["a.ts", "b.ts", "c.ts"], accepted, reverted: [], finished: true, errorsAdded: 0 } });

describe("Reject all", () => {
  it("reverts the whole turn in one call when nothing was accepted", async () => {
    calls.length = 0;
    useAgentStore.setState({ session: "s", turns: turn([]) });
    expect(await useAgentStore.getState().rejectAll(1)).toBe(3);
    expect(calls.map((c) => c.cmd)).toEqual(["agent_revert_turn"]);
    expect(useAgentStore.getState().turns[1].files).toEqual([]);
  });

  it("restores only the pending files when some were accepted", async () => {
    calls.length = 0;
    useAgentStore.setState({ session: "s", turns: turn(["b.ts"]) });
    expect(await useAgentStore.getState().rejectAll(1)).toBe(2);
    expect(calls.map((c) => c.cmd)).toEqual(["agent_revert_file", "agent_revert_file"]);
    expect(useAgentStore.getState().turns[1].files).toEqual(["b.ts"]);
  });
});
