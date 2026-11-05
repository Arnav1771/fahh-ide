import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LspClient, REQUEST_TIMEOUT_MS, syncKind, type LspTransport } from "./client";
import { configurationFor, detectProjectTools, extraServersFor, languagesOf, lspLanguageId, primaryServerFor } from "./servers";

/** A fake server: records what the client sends and lets the test answer. */
function fakeTransport() {
  const sent: Record<string, unknown>[] = [];
  let failSend = false;
  const transport: LspTransport = {
    start: vi.fn(async () => {}),
    send: vi.fn(async (_server: string, message: string) => {
      if (failSend) throw new Error("broken pipe");
      sent.push(JSON.parse(message));
    }),
    stop: vi.fn(async () => {}),
  };
  return {
    transport,
    sent,
    breakPipe: () => (failSend = true),
    last: (method: string) => [...sent].reverse().find((m) => m.method === method) as { id: number; params: any } | undefined, // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function readyClient(caps: Record<string, unknown> = { textDocumentSync: 2, completionProvider: {} }, hooks = {}) {
  const t = fakeTransport();
  const client = new LspClient(t.transport, hooks);
  const ready = client.ensureServer("python", "/w", "file:///w");
  await client.flush("python");
  const init = t.last("initialize")!;
  client.handleMessage("python", { jsonrpc: "2.0", id: init.id, result: { capabilities: caps } });
  expect(await ready).toBe(true);
  await client.flush("python");
  return { client, ...t };
}

describe("LspClient lifecycle", () => {
  it("waits for initialize before initialized and documents", async () => {
    const t = fakeTransport();
    const client = new LspClient(t.transport);
    const ready = client.ensureServer("python", "/w", "file:///w");
    await client.flush("python");
    expect(t.sent.map((m) => m.method)).toEqual(["initialize"]);
    client.openDocument("python", "file:///w/a.py", "python", 1, "x"); // not ready: dropped
    const init = t.last("initialize")!;
    expect(init.params.rootUri).toBe("file:///w");
    expect(init.params.capabilities.textDocument.completion.completionItem.snippetSupport).toBe(true);
    client.handleMessage("python", { jsonrpc: "2.0", id: init.id, result: { capabilities: { hoverProvider: true } } });
    expect(await ready).toBe(true);
    await client.flush("python");
    expect(t.sent.map((m) => m.method)).toEqual(["initialize", "initialized"]);
    expect(client.capabilities("python").hoverProvider).toBe(true);
  });

  it("a start failure is reported, not thrown", async () => {
    const statuses: string[] = [];
    const t = fakeTransport();
    (t.transport.start as ReturnType<typeof vi.fn>).mockRejectedValueOnce("LSP binary 'ruff' not found on PATH");
    const client = new LspClient(t.transport, { onStatus: (_s, st) => statuses.push(st) });
    expect(await client.ensureServer("ruff", "/w", "file:///w")).toBe(false);
    expect(statuses).toEqual(["starting", "failed"]);
  });

  it("ensureServer twice starts once", async () => {
    const t = fakeTransport();
    const client = new LspClient(t.transport);
    void client.ensureServer("python", "/w", "file:///w");
    void client.ensureServer("python", "/w", "file:///w");
    await tick();
    expect(t.transport.start).toHaveBeenCalledTimes(1);
  });
});

describe("requests through the correlator", () => {
  it("resolves the reply that carries the request id", async () => {
    const { client, last } = await readyClient();
    const p = client.request("python", "textDocument/hover", { textDocument: { uri: "u" }, position: { line: 0, character: 0 } });
    await client.flush("python");
    const req = last("textDocument/hover")!;
    client.handleMessage("python", { jsonrpc: "2.0", id: req.id + 1000, result: "not mine" });
    client.handleMessage("python", { jsonrpc: "2.0", id: req.id, result: { contents: "doc" } });
    expect(await p).toEqual({ contents: "doc" });
  });

  it("an error reply is null for request, a message for requestStrict", async () => {
    const { client, last } = await readyClient();
    const p = client.request("python", "textDocument/definition", {});
    await client.flush("python");
    client.handleMessage("python", { id: last("textDocument/definition")!.id, error: { code: -32603, message: "boom" } });
    expect(await p).toBeNull();
    const q = client.requestStrict("python", "textDocument/rename", {});
    await client.flush("python");
    client.handleMessage("python", { id: last("textDocument/rename")!.id, error: { code: -32803, message: "cannot rename a builtin" } });
    await expect(q).rejects.toThrow("cannot rename a builtin");
  });

  it("server not ready -> null without sending", async () => {
    const t = fakeTransport();
    const client = new LspClient(t.transport);
    expect(await client.request("rust", "textDocument/hover", {})).toBeNull();
    expect(t.sent).toEqual([]);
  });

  describe("timeouts", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    it("gives up after ~3 s with null", async () => {
      const { client } = await (async () => {
        vi.useRealTimers();
        const r = await readyClient();
        vi.useFakeTimers();
        return r;
      })();
      const p = client.request("python", "textDocument/completion", {});
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
      expect(await p).toBeNull();
      expect(client.correlator.getPendingCount()).toBe(0);
    });
  });

  it("cancellation sends $/cancelRequest and resolves null", async () => {
    const { client, last } = await readyClient();
    let cancel: () => void = () => {};
    const token = { isCancellationRequested: false, onCancellationRequested: (cb: () => void) => ((cancel = cb), { dispose() {} }) };
    const p = client.request("python", "textDocument/completion", {}, { token });
    await client.flush("python");
    const id = last("textDocument/completion")!.id;
    token.isCancellationRequested = true;
    cancel();
    expect(await p).toBeNull();
    await client.flush("python");
    expect(last("$/cancelRequest")!.params).toEqual({ id });
    // A late reply for it is ignored.
    client.handleMessage("python", { id, result: { items: [] } });
    expect(client.correlator.getPendingCount()).toBe(0);
  });

  it("an already-cancelled token sends nothing", async () => {
    const { client, sent } = await readyClient();
    const before = sent.length;
    expect(await client.request("python", "textDocument/hover", {}, { token: { isCancellationRequested: true, onCancellationRequested: () => {} } })).toBeNull();
    expect(sent.length).toBe(before);
  });
});

describe("document sync", () => {
  it("didOpen once, incremental didChange with rising versions, didClose", async () => {
    const { client, last, sent } = await readyClient({ textDocumentSync: { openClose: true, change: 2 } });
    client.openDocument("python", "file:///w/a.py", "python", 1, "x = 1");
    client.openDocument("python", "file:///w/a.py", "python", 1, "x = 1");
    const change = { range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } }, rangeLength: 1, text: "2" };
    client.changeDocument("python", "file:///w/a.py", 2, [change], () => "x = 2");
    client.changeDocument("python", "file:///w/a.py", 2, [change], () => "x = 2"); // stale version: bumped
    await client.flush("python");
    expect(sent.filter((m) => m.method === "textDocument/didOpen")).toHaveLength(1);
    const changes = sent.filter((m) => m.method === "textDocument/didChange") as { params: any }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(changes.map((c) => c.params.textDocument.version)).toEqual([2, 3]);
    expect(changes[0].params.contentChanges).toEqual([change]);
    client.closeDocument("python", "file:///w/a.py");
    await client.flush("python");
    expect(last("textDocument/didClose")!.params).toEqual({ textDocument: { uri: "file:///w/a.py" } });
    expect(client.isOpen("python", "file:///w/a.py")).toBe(false);
  });

  it("full sync servers get the whole text", async () => {
    const { client, last } = await readyClient({ textDocumentSync: 1 });
    client.openDocument("python", "u", "python", 1, "a");
    client.changeDocument("python", "u", 2, [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, text: "b" }], () => "b");
    await client.flush("python");
    expect(last("textDocument/didChange")!.params.contentChanges).toEqual([{ text: "b" }]);
  });

  it("didChange is queued before a request made right after it", async () => {
    const { client, sent } = await readyClient();
    client.openDocument("python", "u", "python", 1, "a");
    client.changeDocument("python", "u", 2, [{ range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } }, text: "." }], () => "a.");
    void client.request("python", "textDocument/completion", {});
    await client.flush("python");
    const order = sent.map((m) => m.method).filter((m) => m !== "initialize" && m !== "initialized");
    expect(order).toEqual(["textDocument/didOpen", "textDocument/didChange", "textDocument/completion"]);
  });

  it("didSave includes text only when the server asks", async () => {
    const { client, last } = await readyClient({ textDocumentSync: { change: 2, save: { includeText: true } } });
    client.openDocument("python", "u", "python", 1, "a");
    client.saveDocument("python", "u", "a");
    await client.flush("python");
    expect(last("textDocument/didSave")!.params).toEqual({ textDocument: { uri: "u" }, text: "a" });
  });

  it("syncKind reads both shapes", () => {
    expect(syncKind({ textDocumentSync: 2 })).toBe(2);
    expect(syncKind({ textDocumentSync: { change: 1 } })).toBe(1);
    expect(syncKind({})).toBe(1);
  });

  it("a dead pipe marks the server failed", async () => {
    const statuses: string[] = [];
    const { client, breakPipe } = await readyClient(undefined, { onStatus: (_s: string, st: string) => statuses.push(st) });
    breakPipe();
    client.openDocument("python", "u", "python", 1, "a");
    await client.flush("python");
    expect(client.status("python")).toBe("failed");
    expect(statuses.at(-1)).toBe("failed");
  });
});

describe("requests from the server", () => {
  it("answers configuration, progress and registration so servers never stall", async () => {
    const { client, sent } = await readyClient(undefined, { configuration: (s: string, sec?: string) => configurationFor(s, sec, "file:///w") });
    client.handleMessage("python", { jsonrpc: "2.0", id: 7, method: "workspace/configuration", params: { items: [{ section: "python" }, { section: "python.analysis" }] } });
    client.handleMessage("python", { jsonrpc: "2.0", id: 8, method: "window/workDoneProgress/create", params: { token: "t" } });
    client.handleMessage("python", { jsonrpc: "2.0", id: 9, method: "client/registerCapability", params: { registrations: [] } });
    client.handleMessage("python", { jsonrpc: "2.0", id: 10, method: "something/unknown", params: {} });
    await tick();
    await client.flush("python");
    const reply = (id: number) => sent.find((m) => m.id === id && !("method" in m)) as Record<string, unknown>;
    expect(reply(7).result).toEqual([{}, {}]);
    expect(reply(8).result).toBeNull();
    expect(reply(9).result).toBeNull();
    expect((reply(10).error as { code: number }).code).toBe(-32601);
  });

  it("a server request id that collides with ours is not taken for a reply", async () => {
    const { client, last } = await readyClient();
    const p = client.request("python", "textDocument/hover", {});
    await client.flush("python");
    const id = last("textDocument/hover")!.id;
    client.handleMessage("python", { jsonrpc: "2.0", id, method: "window/workDoneProgress/create", params: {} });
    expect(client.correlator.getPendingCount()).toBe(1);
    client.handleMessage("python", { jsonrpc: "2.0", id, result: { contents: "ok" } });
    expect(await p).toEqual({ contents: "ok" });
  });

  it("workspace/applyEdit goes to the hook and reports applied", async () => {
    const applyEdit = vi.fn(async () => true);
    const { client, sent } = await readyClient(undefined, { applyEdit });
    client.handleMessage("python", { jsonrpc: "2.0", id: 42, method: "workspace/applyEdit", params: { edit: { changes: {} } } });
    await tick();
    await client.flush("python");
    expect(applyEdit).toHaveBeenCalledWith("python", { changes: {} });
    expect(sent.find((m) => m.id === 42)?.result).toEqual({ applied: true });
  });

  it("notifications reach the hook", async () => {
    const onNotification = vi.fn();
    const { client } = await readyClient(undefined, { onNotification });
    client.handleMessage("python", { jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: "u", diagnostics: [] } });
    expect(onNotification).toHaveBeenCalledWith("python", "textDocument/publishDiagnostics", { uri: "u", diagnostics: [] });
  });
});

describe("server table", () => {
  it("maps Monaco languages to servers; JS and TS share one", () => {
    expect(primaryServerFor("javascript")).toBe("typescript");
    expect(primaryServerFor("scss")).toBe("css");
    expect(primaryServerFor("markdown")).toBeNull();
    expect(languagesOf("typescript").sort()).toEqual(["javascript", "typescript"]);
    expect(languagesOf("ruff")).toEqual(["python"]);
  });
  it("extras only when the project uses them", () => {
    expect(extraServersFor("typescript", { eslint: false, tailwind: false })).toEqual([]);
    expect(extraServersFor("typescript", { eslint: true, tailwind: true })).toEqual(["eslint", "tailwind"]);
    expect(extraServersFor("python", { eslint: false, tailwind: false })).toEqual(["ruff"]);
  });
  it("detects ESLint and Tailwind from root files or package.json", () => {
    expect(detectProjectTools(["eslint.config.js"], null)).toEqual({ eslint: true, tailwind: false });
    expect(detectProjectTools([], '{"devDependencies":{"tailwindcss":"^3"}}')).toEqual({ eslint: false, tailwind: true });
    expect(detectProjectTools(["README.md"], '{"dependencies":{}}')).toEqual({ eslint: false, tailwind: false });
  });
  it("LSP language ids", () => {
    expect(lspLanguageId("/a/App.tsx", "typescript")).toBe("typescriptreact");
    expect(lspLanguageId("/a/x.jsx", "javascript")).toBe("javascriptreact");
    expect(lspLanguageId("/a/run.sh", "shell")).toBe("shellscript");
    expect(lspLanguageId("/a/m.py", "python")).toBe("python");
  });
  it("ESLint gets a full settings object", () => {
    const cfg = configurationFor("eslint", "", "file:///w/app") as Record<string, unknown>;
    expect(cfg.validate).toBe("on");
    expect(cfg.workspaceFolder).toEqual({ uri: "file:///w/app", name: "app" });
  });
});
