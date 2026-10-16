import { describe, expect, it } from "vitest";
import {
  agentReducer,
  errorsAdded,
  initialAgentState,
  itemsFromHistory,
  joinRoot,
  lastReply,
  pendingReview,
  relToRoot,
  samePath,
  type AgentAction,
  type AgentState,
} from "./agentState";
import type { AgentEvent, AgentMsg } from "./types";

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

describe("subagents, judge, loop and sessions", () => {
  const started: AgentEvent = { type: "sub_started", turn: 1, child: "c1", name: "explore", task: "find x", model: null, mode: "qa" };
  const sub = (event: AgentEvent): AgentAction => ev({ type: "sub", turn: 1, child: "c1", name: "explore", event });

  it("nests a subagent's tool lines under its card and finishes it", () => {
    const s = run([
      ev(started),
      sub({ type: "tool_call", turn: 1, id: "t1", name: "search", args: { pattern: "x" }, kind: "read" }),
      sub({ type: "tool_result", turn: 1, id: "t1", ok: true, output: "a.rs:1" }),
      sub({ type: "text_delta", turn: 1, text: "hidden prose" }),
      ev({ type: "sub_done", turn: 1, child: "c1", name: "explore", ok: true, steps: 2, summary: "found it" }),
    ]);
    expect(s.items).toHaveLength(1);
    const card = s.items[0];
    expect(card).toMatchObject({ kind: "sub", name: "explore", status: "done", steps: 2, summary: "found it" });
    if (card.kind !== "sub") throw new Error();
    expect(card.items).toHaveLength(1); // the tool card; the child's prose is not shown
    expect(card.items[0]).toMatchObject({ kind: "tool", status: "ok", output: "a.rs:1" });
  });

  it("two subagents stay separate", () => {
    const s = run([
      ev(started),
      ev({ ...started, child: "c2", name: "reviewer" } as AgentEvent),
      ev({ type: "sub", turn: 1, child: "c2", name: "reviewer", event: { type: "tool_call", turn: 1, id: "t9", name: "read_file", args: {}, kind: "read" } }),
      ev({ type: "sub_done", turn: 1, child: "c1", name: "explore", ok: false, steps: 0, summary: "stopped" }),
    ]);
    const [a, b] = s.items;
    expect(a).toMatchObject({ child: "c1", status: "failed" });
    expect(b).toMatchObject({ child: "c2", status: "running" });
    if (a.kind !== "sub" || b.kind !== "sub") throw new Error();
    expect(a.items).toHaveLength(0);
    expect(b.items).toHaveLength(1);
  });

  it("a subagent's approval needs input, is answered inside the card, and the turn goes on", () => {
    let s = run([ev(started), sub({ ...(approval as object), id: "appr-7" } as AgentEvent)]);
    expect(s.status).toBe("needs_input");
    s = agentReducer(s, { type: "approval_answered", id: "appr-7", allow: false });
    expect(s.status).toBe("running");
    const card = s.items[0];
    if (card.kind !== "sub") throw new Error();
    expect(card.items[0]).toMatchObject({ kind: "approval", state: "denied" });
  });

  it("a subagent's edit lands in the turn's review", () => {
    const s = run([ev(started), sub({ type: "file_changed", turn: 1, path: "child.txt" })]);
    expect(s.turns[1].files).toEqual(["child.txt"]);
  });

  it("judge verdicts, loop rounds, notices and compaction become lines", () => {
    const s = run([
      ev({ type: "judge", turn: 1, command: "npm test", safe: true, reason: "a test run" }),
      ev({ type: "judge", turn: 1, command: "rm -rf x", safe: false, reason: "deletes" }),
      ev({ type: "loop_round", turn: 1, round: 1, max: 3, approved: false, notes: "add a test" }),
      ev({ type: "loop_round", turn: 1, round: 2, max: 3, approved: true, notes: "" }),
      ev({ type: "notice", turn: 1, text: "BYPASS MODE" }),
      ev({ type: "compacted", turn: 1, before: 9000, after: 800 }),
    ]);
    const text = s.items.map((i) => (i as { text: string }).text);
    expect(text[0]).toBe("Judge: SAFE npm test (a test run)");
    expect(text[1]).toBe("Judge: UNSAFE rm -rf x (deletes)");
    expect(text[2]).toBe("Loop round 1/3: changes requested: add a test");
    expect(text[3]).toBe("Loop round 2/3: the reviewer approved");
    expect(text[4]).toBe("BYPASS MODE");
    expect(text[5]).toContain("9000 to 800");
  });

  it("resuming rebuilds the transcript from the saved conversation", () => {
    const history: AgentMsg[] = [
      { role: "user", text: "[Summary of the earlier conversation]\nthey did x" },
      { role: "user", text: "change a" },
      { role: "assistant", text: "", calls: [{ id: "1", name: "write_file", args: { path: "a" } }, { id: "2", name: "run_command", args: { command: "rm a" } }] },
      { role: "tool_result", id: "1", name: "write_file", content: "edited a" },
      { role: "tool_result", id: "2", name: "run_command", content: "denied: blocked" },
      { role: "assistant", text: "done", calls: [] },
    ];
    const items = itemsFromHistory(history);
    expect(items.map((i) => i.kind)).toEqual(["notice", "user", "tool", "tool", "assistant"]);
    expect(items[2]).toMatchObject({ toolKind: "edit", status: "ok" });
    expect(items[3]).toMatchObject({ toolKind: "run", status: "error" });
    const s = agentReducer(initialAgentState, { type: "loaded", loaded: { session: "s7", title: "T", history, turns: [{ id: 1, prompt: "change a", hist_start: 1, mode: "ask", at: 0 }] } });
    expect(s).toMatchObject({ session: "s7", title: "T", status: "idle" });
    expect(Object.keys(s.turns)).toEqual(["1"]);
    expect(lastReply(s.items)).toBe("done");
  });

  it("the sessions picker keeps which one is current", () => {
    const s = run([{ type: "started", session: "s1", turn: 1 }, { type: "sessions", sessions: [{ id: "s1", title: "A", updated: 1, steps: 1 }] }]);
    expect(s.items[0]).toMatchObject({ kind: "sessions", current: "s1" });
    expect(agentReducer(s, { type: "renamed", title: "Z" }).title).toBe("Z");
  });
});
