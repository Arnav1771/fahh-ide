import { describe, it, expect, vi } from "vitest";
import { DapClient } from "./dap";

function client() {
  let seq = 0;
  const sent: Array<{ command: string; args: unknown }> = [];
  const events: Array<[string, unknown]> = [];
  const c = new DapClient(
    async (command, args) => {
      sent.push({ command, args });
      return ++seq;
    },
    (event, body) => events.push([event, body])
  );
  return { c, sent, events };
}

const response = (request_seq: number, body: unknown, success = true, message?: string) =>
  JSON.stringify({ seq: 100 + request_seq, type: "response", request_seq, success, body, message });

describe("DapClient", () => {
  it("resolves a request with its response body", async () => {
    const { c, sent } = client();
    const p = c.request("threads");
    await Promise.resolve();
    c.handle(response(1, { threads: [{ id: 7, name: "main" }] }));
    await expect(p).resolves.toEqual({ threads: [{ id: 7, name: "main" }] });
    expect(sent).toEqual([{ command: "threads", args: {} }]);
  });

  it("matches a response that arrives before send() returns its seq", async () => {
    let release!: (n: number) => void;
    const c = new DapClient(
      () => new Promise<number>((r) => (release = r)),
      () => {}
    );
    const p = c.request("initialize");
    c.handle(response(1, { supportsConfigurationDoneRequest: true }));
    release(1);
    await expect(p).resolves.toEqual({ supportsConfigurationDoneRequest: true });
  });

  it("rejects with the adapter's error text", async () => {
    const { c } = client();
    const p = c.request("launch", { program: "x.py" });
    await Promise.resolve();
    c.handle(
      JSON.stringify({
        seq: 9,
        type: "response",
        request_seq: 1,
        success: false,
        message: "launch failed",
        body: { error: { format: "File not found: x.py" } },
      })
    );
    await expect(p).rejects.toThrow("File not found: x.py");
  });

  it("hands events on and ignores garbage", () => {
    const { c, events } = client();
    c.handle("not json");
    c.handle(JSON.stringify({ seq: 1, type: "event", event: "stopped", body: { threadId: 3, reason: "breakpoint" } }));
    c.handle(JSON.stringify({ seq: 2, type: "event", event: "initialized" }));
    expect(events).toEqual([
      ["stopped", { threadId: 3, reason: "breakpoint" }],
      ["initialized", {}],
    ]);
  });

  it("close() rejects waiting requests and refuses new ones", async () => {
    const { c } = client();
    const p = c.request("continue", { threadId: 1 });
    await Promise.resolve();
    c.close();
    await expect(p).rejects.toThrow("ended");
    await expect(c.request("next")).rejects.toThrow("ended");
  });

  it("does not resolve a request from another request's response", async () => {
    const { c } = client();
    const first = vi.fn();
    void c.request("scopes").then(first);
    await Promise.resolve();
    c.handle(response(2, {}));
    await Promise.resolve();
    expect(first).not.toHaveBeenCalled();
  });
});
