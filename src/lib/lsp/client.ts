/**
 * The JSON-RPC side of the language servers, independent of Tauri and Monaco: a fake
 * transport drives it in tests, `tauriTransport` in the app.
 *
 * - one correlator for every request, so replies find their caller by id;
 * - every message to a server goes through one queue per server, so a `didChange`
 *   always reaches the server before the completion request typed right after it
 *   (Tauri may run two `lsp_send` invocations out of order otherwise);
 * - `initialize` is awaited before `initialized` and any document is opened;
 * - requests the server sends us (configuration, progress, applyEdit…) are answered,
 *   because some servers (pyright, ESLint) wait for those answers before working;
 * - feature requests time out after ~3 s and resolve empty, and are cancelled with
 *   `$/cancelRequest` when Monaco drops them (the user kept typing).
 */
import { LspCorrelator } from "../lspCorrelation";
import type { LspRange, LspWorkspaceEdit } from "./protocol";

export interface LspTransport {
  start(server: string, workspace: string): Promise<void>;
  send(server: string, message: string): Promise<void>;
  stop(server: string): Promise<void>;
}

export interface CancelToken {
  isCancellationRequested: boolean;
  onCancellationRequested(cb: () => void): { dispose(): void } | void;
}

export type ServerStatus = "starting" | "ready" | "failed" | "stopped";

export interface ClientHooks {
  onStatus?(server: string, status: ServerStatus, detail?: string): void;
  onNotification?(server: string, method: string, params: unknown): void;
  /** `workspace/applyEdit` from a server (e.g. organize imports). */
  applyEdit?(server: string, edit: LspWorkspaceEdit): Promise<boolean>;
  configuration?(server: string, section: string | undefined, workspaceUri: string): unknown;
}

/** Default wait for a feature request: past this the user has moved on, show nothing. */
export const REQUEST_TIMEOUT_MS = 3000;
/** Servers index the project on start; pyright and rust-analyzer can take a while. */
export const INITIALIZE_TIMEOUT_MS = 60000;

interface DocState { languageId: string; version: number }

interface ServerState {
  key: string;
  workspace: string;
  workspaceUri: string;
  status: ServerStatus;
  caps: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  queue: Promise<void>;
  docs: Map<string, DocState>;
  ready: Promise<boolean>;
}

export function initializeParams(workspaceUri: string, initializationOptions?: unknown) {
  const name = decodeURIComponent(workspaceUri.split("/").filter(Boolean).pop() ?? "workspace");
  return {
    processId: null,
    clientInfo: { name: "Fahh Editor" },
    rootUri: workspaceUri,
    workspaceFolders: [{ uri: workspaceUri, name }],
    initializationOptions,
    capabilities: {
      general: { positionEncodings: ["utf-16"] },
      window: { workDoneProgress: true, showMessage: {} },
      workspace: {
        applyEdit: true,
        workspaceEdit: { documentChanges: true, resourceOperations: ["create", "rename", "delete"] },
        configuration: true,
        workspaceFolders: true,
        didChangeConfiguration: { dynamicRegistration: false },
        didChangeWatchedFiles: { dynamicRegistration: false },
      },
      textDocument: {
        synchronization: { dynamicRegistration: false, didSave: true, willSave: false, willSaveWaitUntil: false },
        publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } },
        completion: {
          contextSupport: true,
          completionItem: {
            snippetSupport: true,
            commitCharactersSupport: true,
            documentationFormat: ["markdown", "plaintext"],
            deprecatedSupport: true,
            preselectSupport: true,
            tagSupport: { valueSet: [1] },
            insertReplaceSupport: true,
            labelDetailsSupport: true,
            resolveSupport: { properties: ["documentation", "detail", "additionalTextEdits"] },
          },
          completionItemKind: { valueSet: Array.from({ length: 25 }, (_, i) => i + 1) },
          completionList: { itemDefaults: ["commitCharacters", "editRange", "insertTextFormat", "data"] },
        },
        hover: { contentFormat: ["markdown", "plaintext"] },
        signatureHelp: {
          contextSupport: true,
          signatureInformation: {
            documentationFormat: ["markdown", "plaintext"],
            parameterInformation: { labelOffsetSupport: true },
            activeParameterSupport: true,
          },
        },
        definition: { linkSupport: true },
        references: {},
        documentHighlight: {},
        rename: { prepareSupport: true },
        codeAction: {
          isPreferredSupport: true,
          dataSupport: true,
          resolveSupport: { properties: ["edit"] },
          codeActionLiteralSupport: {
            codeActionKind: {
              valueSet: ["", "quickfix", "refactor", "refactor.extract", "refactor.inline", "refactor.rewrite", "source", "source.organizeImports", "source.fixAll"],
            },
          },
        },
        inlayHint: {},
      },
    },
  };
}

/** `textDocumentSync` -> 0 none / 1 full / 2 incremental. */
export function syncKind(caps: Record<string, any> | undefined): number { // eslint-disable-line @typescript-eslint/no-explicit-any
  const s = caps?.textDocumentSync;
  if (typeof s === "number") return s;
  if (s && typeof s === "object" && typeof s.change === "number") return s.change;
  return 1;
}

export class LspClient {
  readonly correlator = new LspCorrelator();
  private servers = new Map<string, ServerState>();

  constructor(private transport: LspTransport, private hooks: ClientHooks = {}) {}

  status(key: string): ServerStatus | null {
    return this.servers.get(key)?.status ?? null;
  }

  isReady(key: string): boolean {
    return this.servers.get(key)?.status === "ready";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  capabilities(key: string): Record<string, any> {
    return this.servers.get(key)?.caps ?? {};
  }

  readyServers(): string[] {
    return [...this.servers.values()].filter((s) => s.status === "ready").map((s) => s.key);
  }

  /** Start (once) and initialize a server. Resolves true when it is ready. */
  ensureServer(key: string, workspace: string, workspaceUri: string, initializationOptions?: unknown): Promise<boolean> {
    const existing = this.servers.get(key);
    if (existing && existing.status !== "failed" && existing.status !== "stopped") return existing.ready;

    const st: ServerState = {
      key,
      workspace,
      workspaceUri,
      status: "starting",
      caps: {},
      queue: Promise.resolve(),
      docs: new Map(),
      ready: Promise.resolve(false),
    };
    this.servers.set(key, st);
    this.setStatus(st, "starting");

    st.ready = (async () => {
      try {
        // A server that died mid-session is still registered on the Rust side: clear it first.
        if (existing?.status === "failed") await this.transport.stop(key).catch(() => {});
        await this.transport.start(key, workspace);
        const reply = await this.sendRequest<{ capabilities?: Record<string, unknown> }>(
          st,
          "initialize",
          initializeParams(workspaceUri, initializationOptions),
          INITIALIZE_TIMEOUT_MS
        );
        if (this.servers.get(key) !== st) return false;
        st.caps = reply?.capabilities ?? {};
        this.enqueue(st, JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }));
        this.setStatus(st, "ready");
        return true;
      } catch (err) {
        if (this.servers.get(key) === st) this.setStatus(st, "failed", String((err as Error)?.message ?? err));
        return false;
      }
    })();
    return st.ready;
  }

  async stopServer(key: string): Promise<void> {
    const st = this.servers.get(key);
    if (!st) return;
    this.servers.delete(key);
    st.status = "stopped";
    this.hooks.onStatus?.(key, "stopped");
    await this.transport.stop(key).catch(() => {});
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.servers.keys()].map((k) => this.stopServer(k)));
    this.correlator.clear();
  }

  notify(key: string, method: string, params: unknown): void {
    const st = this.servers.get(key);
    if (!st || st.status !== "ready") return;
    this.enqueue(st, JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  /**
   * A feature request. Never throws: no server, an error reply, a timeout or a
   * cancellation all resolve `null`, which providers turn into "nothing here".
   */
  async request<T>(key: string, method: string, params: unknown, opts: { timeoutMs?: number; token?: CancelToken } = {}): Promise<T | null> {
    try {
      return await this.requestStrict<T>(key, method, params, opts);
    } catch {
      return null;
    }
  }

  /** Like `request`, but an error reply rejects with the server's message (rename shows it). */
  async requestStrict<T>(key: string, method: string, params: unknown, opts: { timeoutMs?: number; token?: CancelToken } = {}): Promise<T | null> {
    const st = this.servers.get(key);
    if (!st || st.status !== "ready") return null;
    if (opts.token?.isCancellationRequested) return null;
    const { id, payload, promise } = this.correlator.createRequest<T>(method, params as Record<string, unknown>, opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const sub = opts.token?.onCancellationRequested(() => {
      if (this.correlator.cancel(id)) this.enqueue(st, JSON.stringify({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id } }));
    });
    this.enqueue(st, payload);
    try {
      return await promise;
    } catch (err) {
      const e = err as { code?: number; message?: string };
      // -32800 RequestCancelled, -32801 ContentModified, and our own timeout/cancel: just "no answer".
      if (e?.code === -32800 || e?.code === -32801 || /timed out|cancelled/.test(String(e?.message ?? ""))) return null;
      throw new Error(e?.message ?? String(err));
    } finally {
      sub?.dispose?.();
    }
  }

  // ── Documents ──────────────────────────────────────────────────────────────

  isOpen(key: string, uri: string): boolean {
    return !!this.servers.get(key)?.docs.has(uri);
  }

  openDocument(key: string, uri: string, languageId: string, version: number, text: string): void {
    const st = this.servers.get(key);
    if (!st || st.status !== "ready" || st.docs.has(uri)) return;
    st.docs.set(uri, { languageId, version });
    this.enqueue(st, JSON.stringify({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId, version, text } } }));
  }

  /**
   * `changes` are Monaco's content changes already in LSP coordinates, in the order
   * Monaco applied them. A server that wants full sync gets `fullText()` instead.
   */
  changeDocument(key: string, uri: string, version: number, changes: { range: LspRange; rangeLength?: number; text: string }[], fullText: () => string): void {
    const st = this.servers.get(key);
    const doc = st?.docs.get(uri);
    if (!st || !doc || st.status !== "ready") return;
    const kind = syncKind(st.caps);
    if (kind === 0) return;
    if (version <= doc.version) version = doc.version + 1;
    doc.version = version;
    const contentChanges = kind === 2 && changes.length ? changes : [{ text: fullText() }];
    this.enqueue(st, JSON.stringify({ jsonrpc: "2.0", method: "textDocument/didChange", params: { textDocument: { uri, version }, contentChanges } }));
  }

  saveDocument(key: string, uri: string, text: string): void {
    const st = this.servers.get(key);
    if (!st || !st.docs.has(uri) || st.status !== "ready") return;
    const save = st.caps.textDocumentSync?.save;
    const includeText = !!(save && typeof save === "object" && save.includeText);
    this.enqueue(st, JSON.stringify({ jsonrpc: "2.0", method: "textDocument/didSave", params: { textDocument: { uri }, ...(includeText ? { text } : {}) } }));
  }

  closeDocument(key: string, uri: string): void {
    const st = this.servers.get(key);
    if (!st || !st.docs.delete(uri) || st.status !== "ready") return;
    this.enqueue(st, JSON.stringify({ jsonrpc: "2.0", method: "textDocument/didClose", params: { textDocument: { uri } } }));
  }

  // ── Inbound ────────────────────────────────────────────────────────────────

  /** Everything a server says arrives here (parsed JSON). */
  handleMessage(key: string, msg: unknown): void {
    if (!msg || typeof msg !== "object") return;
    const m = msg as { id?: number | string | null; method?: string; params?: unknown; result?: unknown; error?: unknown };
    if (typeof m.method === "string") {
      if (m.id !== undefined && m.id !== null) void this.answerServerRequest(key, m.id, m.method, m.params);
      else this.hooks.onNotification?.(key, m.method, m.params);
      return;
    }
    this.correlator.handleResponse(m as { id?: number | null; result?: unknown; error?: unknown });
  }

  private async answerServerRequest(key: string, id: number | string, method: string, params: unknown): Promise<void> {
    const st = this.servers.get(key);
    if (!st) return;
    let result: unknown = null;
    let error: { code: number; message: string } | undefined;
    try {
      switch (method) {
        case "workspace/configuration": {
          const items = ((params as { items?: { section?: string; scopeUri?: string }[] })?.items ?? []);
          result = items.map((it) => (this.hooks.configuration ? this.hooks.configuration(key, it.section, st.workspaceUri) : null));
          break;
        }
        case "workspace/workspaceFolders":
          result = [{ uri: st.workspaceUri, name: decodeURIComponent(st.workspaceUri.split("/").filter(Boolean).pop() ?? "workspace") }];
          break;
        case "workspace/applyEdit": {
          const edit = (params as { edit?: LspWorkspaceEdit })?.edit ?? {};
          const applied = this.hooks.applyEdit ? await this.hooks.applyEdit(key, edit) : false;
          result = { applied };
          break;
        }
        case "window/showDocument":
          result = { success: false };
          break;
        case "client/registerCapability":
        case "client/unregisterCapability":
        case "window/workDoneProgress/create":
        case "window/showMessageRequest":
        case "workspace/semanticTokens/refresh":
        case "workspace/inlayHint/refresh":
        case "workspace/codeLens/refresh":
        case "workspace/diagnostic/refresh":
          result = null;
          break;
        default:
          // ESLint asks things like eslint/confirmESLintExecution, eslint/openDoc: "no" is a fine answer.
          if (method.startsWith("eslint/")) result = method === "eslint/confirmESLintExecution" ? 4 /* approved */ : null;
          else error = { code: -32601, message: `Unhandled method ${method}` };
      }
    } catch (err) {
      error = { code: -32603, message: String(err) };
    }
    this.enqueue(st, JSON.stringify(error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result }));
  }

  // ── Plumbing ───────────────────────────────────────────────────────────────

  private sendRequest<T>(st: ServerState, method: string, params: unknown, timeoutMs: number): Promise<T> {
    const { payload, promise } = this.correlator.createRequest<T>(method, params as Record<string, unknown>, timeoutMs);
    this.enqueue(st, payload);
    return promise;
  }

  private enqueue(st: ServerState, message: string): void {
    st.queue = st.queue
      .then(() => this.transport.send(st.key, message))
      .catch((err: unknown) => {
        // The process is gone: say so once; the next file of that language restarts it.
        if (st.status !== "failed" && this.servers.get(st.key) === st) {
          this.setStatus(st, "failed", String((err as Error)?.message ?? err));
          st.docs.clear();
        }
      });
  }

  private setStatus(st: ServerState, status: ServerStatus, detail?: string): void {
    st.status = status;
    this.hooks.onStatus?.(st.key, status, detail);
  }

  /** Test helper: wait for every queued message to be handed to the transport. */
  async flush(key: string): Promise<void> {
    await this.servers.get(key)?.queue;
  }
}
