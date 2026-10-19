import { beforeEach, describe, expect, it } from "vitest";
import { useAgentStore } from "./agentStore";

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
