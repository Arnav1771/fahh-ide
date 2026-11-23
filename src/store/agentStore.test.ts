import { beforeEach, describe, expect, it } from "vitest";
import { onEnvelope, useAgentStore } from "./agentStore";

describe("agentStore prompt queueing & steering", () => {
  beforeEach(() => {
    useAgentStore.getState().newChat();
  });

  it("enqueues prompts and maintains FIFO order", () => {
    const store = useAgentStore.getState();
    expect(store.queue).toEqual([]);

    store.enqueue("First prompt");
    store.enqueue("Second prompt");
    store.enqueue("Third prompt");

    expect(useAgentStore.getState().queue).toEqual([
      "First prompt",
      "Second prompt",
      "Third prompt",
    ]);
  });

  it("dequeues prompts in FIFO order", () => {
    const store = useAgentStore.getState();
    store.enqueue("Task 1");
    store.enqueue("Task 2");

    const first = store.dequeue();
    expect(first).toBe("Task 1");
    expect(useAgentStore.getState().queue).toEqual(["Task 2"]);

    const second = store.dequeue();
    expect(second).toBe("Task 2");
    expect(useAgentStore.getState().queue).toEqual([]);

    const third = store.dequeue();
    expect(third).toBeUndefined();
  });

  it("removes specific queue items by index", () => {
    const store = useAgentStore.getState();
    store.enqueue("Task A");
    store.enqueue("Task B");
    store.enqueue("Task C");

    store.removeQueueItem(1); // Remove Task B
    expect(useAgentStore.getState().queue).toEqual(["Task A", "Task C"]);
  });

  it("clears queue on clearQueue and newChat", () => {
    const store = useAgentStore.getState();
    store.enqueue("Task X");
    store.enqueue("Task Y");
    expect(useAgentStore.getState().queue).toHaveLength(2);

    store.clearQueue();
    expect(useAgentStore.getState().queue).toEqual([]);

    store.enqueue("Task Z");
    store.newChat();
    expect(useAgentStore.getState().queue).toEqual([]);
  });
});

describe("agentStore background sessions", () => {
  beforeEach(() => {
    useAgentStore.setState({ background: {} });
    useAgentStore.getState().newChat();
  });

  it("switching to a new session keeps the running one working in the background", () => {
    useAgentStore.setState({ session: "A", status: "running", title: "Refactor the parser", items: [{ kind: "user", text: "Refactor the parser" }] });
    useAgentStore.getState().newChat();
    const s = useAgentStore.getState();
    expect(s.session).toBeNull();
    expect(s.background.A).toEqual({ title: "Refactor the parser", status: "running" });
  });

  it("an idle session is not parked", () => {
    useAgentStore.setState({ session: "B", status: "done", title: "Old", items: [] });
    useAgentStore.getState().newChat();
    expect(useAgentStore.getState().background.B).toBeUndefined();
  });

  it("events from a background session update its status, not the session on screen", () => {
    useAgentStore.setState({ session: "A", status: "running", title: "Task A", items: [{ kind: "user", text: "Task A" }] });
    useAgentStore.getState().newChat();
    useAgentStore.setState({ session: "C", status: "idle", items: [] });
    onEnvelope({ session: "A", event: { type: "approval_request", turn: 1, id: "p1", tool: "run", kind: "run", summary: "npm test", command: "npm test", path: null, old_text: null, new_text: null } } as never);
    expect(useAgentStore.getState().background.A.status).toBe("needs_input");
    onEnvelope({ session: "A", event: { type: "done", turn: 1, files: [] } } as never);
    const s = useAgentStore.getState();
    expect(s.background.A.status).toBe("done");
    expect(s.session).toBe("C");
    expect(s.items).toEqual([]);
  });
});
