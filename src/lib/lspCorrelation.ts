/**
 * LSP Request-Response Correlator for Monaco Editor.
 *
 * Correlates outbound JSON-RPC request IDs with inbound `lsp://message` replies.
 * Translates LSP completions, hover, and definition responses into Monaco formats.
 */

export interface PendingRequest<T = unknown> {
  id: number;
  method: string;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class LspCorrelator {
  private nextId = 100;
  private pending = new Map<number, PendingRequest>();

  /**
   * Builds an LSP request envelope and returns the payload string + promise for reply.
   */
  createRequest<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 4000
  ): { id: number; payload: string; promise: Promise<T> } {
    const id = this.nextId++;
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });

    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request ${method} (id=${id}) timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, {
        id,
        method,
        resolve: resolve as (val: unknown) => void,
        reject,
        timer,
      });
    });

    return { id, payload, promise };
  }

  /**
   * Matches an inbound JSON-RPC response against pending request IDs.
   * Returns true if handled.
   */
  handleResponse(msg: { id?: number | null; result?: unknown; error?: unknown }): boolean {
    if (msg.id === undefined || msg.id === null) return false;
    const req = this.pending.get(Number(msg.id));
    if (!req) return false;

    clearTimeout(req.timer);
    this.pending.delete(req.id);

    if (msg.error) {
      req.reject(msg.error);
    } else {
      req.resolve(msg.result);
    }
    return true;
  }

  getPendingCount(): number {
    return this.pending.size;
  }

  clear(): void {
    for (const req of this.pending.values()) {
      clearTimeout(req.timer);
      req.reject(new Error("LspCorrelator reset"));
    }
    this.pending.clear();
  }
}

/**
 * Translates raw LSP completion items to Monaco completion objects.
 */
export function translateLspCompletions(lspResult: any): Array<{
  label: string;
  kind: number;
  insertText: string;
  detail?: string;
  documentation?: string;
}> {
  if (!lspResult) return [];
  const items = Array.isArray(lspResult) ? lspResult : lspResult.items || [];
  return items.map((item: any) => ({
    label: item.label,
    kind: item.kind ?? 1, // 1 = Text
    insertText: item.insertText || item.label,
    detail: item.detail,
    documentation: typeof item.documentation === "string" ? item.documentation : item.documentation?.value,
  }));
}

/**
 * Translates raw LSP hover response to Monaco markdown hover content.
 */
export function translateLspHover(lspResult: any): string[] {
  if (!lspResult || !lspResult.contents) return [];
  const contents = lspResult.contents;
  if (typeof contents === "string") return [contents];
  if (Array.isArray(contents)) {
    return contents.map((c) => (typeof c === "string" ? c : c.value || ""));
  }
  if (contents.value) return [contents.value];
  return [];
}
