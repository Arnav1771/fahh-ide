/**
 * A Debug Adapter Protocol client. Rust only moves bytes (src-tauri/src/core/debugger.rs):
 * this matches each response to its request and hands events on.
 */

export interface DapMessage {
  seq: number;
  type: "request" | "response" | "event";
  command?: string;
  event?: string;
  request_seq?: number;
  success?: boolean;
  message?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body?: any;
}

/** Sends one request and resolves to its seq. */
type Send = (command: string, args: unknown) => Promise<number>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OnEvent = (event: string, body: any) => void;

interface Pending {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolve: (body: any) => void;
  reject: (e: Error) => void;
  command: string;
}

export class DapClient {
  private pending = new Map<number, Pending>();
  /** Responses that arrived before `send` told us their seq: the event and the invoke race. */
  private early = new Map<number, DapMessage>();
  private closed = false;

  constructor(
    private readonly send: Send,
    private readonly onEvent: OnEvent
  ) {}

  /** Send a request; resolves to the response body, rejects with the adapter's message. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async request<T = any>(command: string, args: unknown = {}): Promise<T> {
    if (this.closed) throw new Error("The debug session has ended");
    const seq = await this.send(command, args);
    return new Promise<T>((resolve, reject) => {
      const p: Pending = { resolve, reject, command };
      const early = this.early.get(seq);
      if (early) {
        this.early.delete(seq);
        settle(p, early);
      } else {
        this.pending.set(seq, p);
      }
    });
  }

  /** Feed one message from the adapter (raw JSON text or parsed). */
  handle(raw: string | DapMessage): void {
    let msg: DapMessage;
    try {
      msg = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return;
    }
    if (msg.type === "response" && typeof msg.request_seq === "number") {
      const p = this.pending.get(msg.request_seq);
      if (p) {
        this.pending.delete(msg.request_seq);
        settle(p, msg);
      } else {
        this.early.set(msg.request_seq, msg);
      }
    } else if (msg.type === "event" && msg.event) {
      this.onEvent(msg.event, msg.body ?? {});
    }
  }

  /** End the session: every request still waiting rejects. */
  close(reason = "The debug session has ended"): void {
    this.closed = true;
    for (const p of this.pending.values()) p.reject(new Error(reason));
    this.pending.clear();
    this.early.clear();
  }
}

function settle(p: Pending, msg: DapMessage): void {
  if (msg.success === false) {
    p.reject(new Error(msg.body?.error?.format || msg.message || `${p.command} failed`));
  } else {
    p.resolve(msg.body ?? {});
  }
}
