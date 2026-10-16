import { describe, expect, it } from "vitest";
import {
  agentReducer,
  errorsAdded,
  initialAgentState,
  joinRoot,
  pendingReview,
  relToRoot,
  samePath,
  type AgentAction,
  type AgentState,
} from "./agentState";
import type { AgentEvent } from "./types";

const run = (actions: AgentAction[], from: AgentState = initialAgentState) => actions.reduce(agentReducer, from);
const ev = (event: AgentEvent): AgentAction => ({ type: "event", event });

const approval: AgentEvent = {
  type: "approval_request",
  turn: 1,
  id: "appr-1",
  tool: "run_command",
  kind: "run",
  summary: "Run a command",
  command: "npm test",
  path: null,
  old_text: null,
  new_text: null,
};

describe("agentReducer", () => {
  it("streams text into one assistant bubble per turn", () => {
    const s = run([
      { type: "user_sent", text: "hi" },
      ev({ type: "text_delta", turn: 1, text: "Hel" }),
      ev({ type: "text_delta", turn: 1, text: "lo" }),
    ]);
    expect(s.items).toEqual([
      { kind: "user", text: "hi" },
      { kind: "assistant", turn: 1, text: "Hello" },
    ]);
    expect(s.status).toBe("running");
  });

  it("starts a new bubble after a tool call", () => {
    const s = run([
      ev({ type: "text_delta", turn: 1, text: "a" }),
      ev({ type: "tool_call", turn: 1, id: "c1", name: "read_file", args: { path: "x" }, kind: "read" }),
      ev({ type: "text_delta", turn: 1, text: "b" }),
    ]);
    expect(s.items.map((i) => i.kind)).toEqual(["assistant", "tool", "assistant"]);
  });

  it("completes a tool card with its result", () => {
    const s = run([
      ev({ type: "tool_call", turn: 1, id: "c1", name: "search", args: {}, kind: "read" }),
      ev({ type: "tool_result", turn: 1, id: "c1", ok: false, output: "denied: nope" }),
    ]);
    expect(s.items[0]).toMatchObject({ kind: "tool", status: "error", output: "denied: nope" });
  });

  it("needs_input while an approval is pending, running again once answered", () => {
    let s = run([{ type: "user_sent", text: "go" }, ev(approval)]);
    expect(s.status).toBe("needs_input");
    expect(s.items[1]).toMatchObject({ kind: "approval", command: "npm test", state: "pending" });
    s = agentReducer(s, { type: "approval_answered", id: "appr-1", allow: false });
    expect(s.status).toBe("running");
    expect(s.items[1]).toMatchObject({ state: "denied" });
  });

  it("stays needs_input while a second approval is still pending", () => {
    let s = run([ev(approval), ev({ ...(approval as object), id: "appr-2" } as AgentEvent)]);
    s = agentReducer(s, { type: "approval_answered", id: "appr-1", allow: true });
    expect(s.status).toBe("needs_input");
  });

  it("tracks changed files per turn and finishes", () => {
    const s = run([
      ev({ type: "turn_started", turn: 1 }),
      ev({ type: "file_changed", turn: 1, path: "a.ts" }),
      ev({ type: "file_changed", turn: 1, path: "a.ts" }),
      ev({ type: "done", turn: 1, steps: 2, files: ["a.ts"] }),
    ]);
    expect(s.status).toBe("done");
    expect(s.turns[1]).toMatchObject({ files: ["a.ts"], finished: true });
    expect(pendingReview(s)).toHaveLength(1);
  });

  it("accept clears the review, reject and revert-turn drop files", () => {
    const base = run([ev({ type: "file_changed", turn: 1, path: "a.ts" }), ev({ type: "file_changed", turn: 1, path: "b.ts" })]);
    const accepted = run([{ type: "file_accepted", turn: 1, path: "a.ts" }, { type: "file_accepted", turn: 1, path: "b.ts" }], base);
    expect(pendingReview(accepted)).toHaveLength(0);
    const rejected = agentReducer(base, { type: "file_reverted", turn: 1, path: "a.ts" });
    expect(rejected.turns[1].files).toEqual(["b.ts"]);
    expect(rejected.turns[1].reverted).toEqual(["a.ts"]);
    const reverted = agentReducer(base, { type: "turn_reverted", turn: 1 });
    expect(reverted.turns[1].files).toEqual([]);
    expect(reverted.turns[1].reverted).toEqual(["a.ts", "b.ts"]);
    expect(pendingReview(reverted)).toHaveLength(0);
  });

  it("keeps a plan and marks it implementing", () => {
    let s = run([ev({ type: "plan_written", turn: 1, id: "p-1", path: ".fahh/plans/p-1.md", markdown: "# P" })]);
    expect(s.items[0]).toMatchObject({ kind: "plan", state: "proposed" });
    s = agentReducer(s, { type: "plan_implementing", id: "p-1" });
    expect(s.items[0]).toMatchObject({ state: "implementing" });
  });

  it("turns errors into notices and status", () => {
    const s = run([ev({ type: "error", turn: 1, message: "provider returned 401" })]);
    expect(s.status).toBe("error");
    expect(s.items[0]).toMatchObject({ kind: "notice", text: "provider returned 401" });
    expect(run([ev({ type: "error", turn: 1, message: "stopped" })]).items[0]).toMatchObject({ text: "Stopped." });
  });

  it("accumulates errors added and resets", () => {
    let s = run([{ type: "errors_added", turn: 2, count: 1 }, { type: "errors_added", turn: 2, count: 2 }]);
    expect(s.turns[2].errorsAdded).toBe(3);
    s = agentReducer(s, { type: "reset" });
    expect(s).toEqual(initialAgentState);
  });
});

describe("helpers", () => {
  it("only counts error growth (the fahh tie-in)", () => {
    expect(errorsAdded(0, 2)).toBe(2);
    expect(errorsAdded(3, 3)).toBe(0);
    expect(errorsAdded(3, 1)).toBe(0);
  });
  it("maps editor model paths to workspace-relative paths", () => {
    expect(relToRoot("C:\\proj", "/C:/proj/src/a.ts")).toBe("src/a.ts");
    expect(relToRoot("/home/me/p", "/home/me/p/a.ts")).toBe("a.ts");
    expect(relToRoot("/home/me/p", "/home/me/other/a.ts")).toBeNull();
  });
  it("compares paths across platforms", () => {
    expect(samePath("C:\\Proj\\src\\a.ts", "c:/proj/src/a.ts")).toBe(true);
    expect(samePath("/a/b", "/a/c")).toBe(false);
    expect(joinRoot("C:\\proj\\", "src/a.ts")).toBe("C:\\proj/src/a.ts");
  });
});
