/**
 * A minimal OpenAI-compatible chat client.
 *
 * There is no AI provider bundled with, or hard-coded into, Fahh Editor. The
 * user points the panel at whatever endpoint they already run or pay for. The
 * `/v1/chat/completions` shape is what Ollama, LM Studio, llama.cpp's server,
 * vLLM, OpenRouter, Groq and OpenAI itself all speak, so one code path covers
 * local and hosted alike.
 *
 * Nothing here reads an environment variable or a bundled secret: if the user
 * has not configured a base URL and a model, the panel refuses to send.
 */

export interface AiSettings {
  /** e.g. `http://localhost:11434/v1` or `https://api.openai.com/v1`. */
  baseUrl: string;
  /** e.g. `llama3.2` or `gpt-4o-mini`. Server-specific; no default is sane. */
  model: string;
  /** Optional — local servers usually need no key. Never shipped in the repo. */
  apiKey: string;
  /** Prepended as a `system` message when non-empty. */
  systemPrompt: string;
  /** Ask the server to stream tokens back. */
  stream: boolean;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: "",
  model: "",
  apiKey: "",
  systemPrompt:
    "You are a concise coding assistant embedded in the Fahh Editor IDE. Prefer short answers and complete code blocks.",
  stream: true,
};

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Why the panel cannot send yet, or `null` when it can. */
export function configurationProblem(settings: AiSettings): string | null {
  if (!settings.baseUrl.trim()) {
    return "No provider configured — set a base URL in Settings.";
  }
  if (!/^https?:\/\//i.test(settings.baseUrl.trim())) {
    return "Base URL must start with http:// or https://";
  }
  if (!settings.model.trim()) {
    return "No model configured — set a model name in Settings.";
  }
  return null;
}

export function isConfigured(settings: AiSettings): boolean {
  return configurationProblem(settings) === null;
}

/** Join the base URL with a path, tolerating a trailing slash on either. */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function chatCompletionsUrl(settings: AiSettings): string {
  return joinUrl(settings.baseUrl, "/chat/completions");
}

export function buildHeaders(settings: AiSettings): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const key = settings.apiKey.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

export function buildRequestBody(
  settings: AiSettings,
  messages: ChatMessage[]
): Record<string, unknown> {
  const system = settings.systemPrompt.trim();
  const full: ChatMessage[] = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  return {
    model: settings.model.trim(),
    messages: full,
    stream: settings.stream,
  };
}

/** Pull the assistant text out of a non-streamed response body. */
export function extractContent(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;
  return typeof content === "string" ? content : "";
}

/** Pull the incremental token out of one streamed `data:` chunk. */
export function extractDelta(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const delta = (choices[0] as { delta?: { content?: unknown } }).delta;
  const content = delta?.content;
  return typeof content === "string" ? content : "";
}

/**
 * Split a raw SSE buffer into complete `data:` payload strings, returning the
 * unconsumed tail so the caller can prepend it to the next chunk. Chunk
 * boundaries land mid-line constantly, so this must never assume a chunk is a
 * whole event.
 */
export function parseSseBuffer(buffer: string): {
  events: string[];
  rest: string;
} {
  const events: string[] = [];
  // Events are separated by a blank line; servers use \n\n or \r\n\r\n.
  const normalised = buffer.replace(/\r\n/g, "\n");
  const parts = normalised.split("\n\n");
  const rest = parts.pop() ?? "";

  for (const part of parts) {
    for (const line of part.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice("data:".length).trim();
      if (data) events.push(data);
    }
  }
  return { events, rest };
}

/** Turn an HTTP failure into something a user can act on. */
export async function describeHttpFailure(response: Response): Promise<string> {
  let detail = "";
  try {
    detail = (await response.text()).slice(0, 400);
  } catch {
    detail = "";
  }

  const base = `${response.status} ${response.statusText}`.trim();
  switch (response.status) {
    case 401:
    case 403:
      return `${base} — the endpoint rejected the API key.`;
    case 404:
      return `${base} — no /chat/completions at that base URL. Include the /v1 suffix (e.g. http://localhost:11434/v1).`;
    case 429:
      return `${base} — rate limited by the provider.`;
    default:
      return detail ? `${base} — ${detail}` : base;
  }
}

/** Turn a thrown fetch error into something a user can act on. */
export function describeNetworkFailure(err: unknown): string {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";

  if (/abort/i.test(message)) return "Request cancelled.";
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return (
      "Could not reach the endpoint. Check that it is running and that it " +
      "allows requests from the app's origin (for Ollama: set " +
      "OLLAMA_ORIGINS=* before starting it)."
    );
  }
  return message || "Request failed.";
}

export interface ChatOptions {
  signal?: AbortSignal;
  /** Called with each new token when streaming. */
  onToken?: (token: string) => void;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Send a chat turn. Resolves with the full assistant text; rejects with an
 * `Error` whose message is already user-readable.
 */
export async function sendChat(
  settings: AiSettings,
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<string> {
  const problem = configurationProblem(settings);
  if (problem) throw new Error(problem);

  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(chatCompletionsUrl(settings), {
      method: "POST",
      headers: buildHeaders(settings),
      body: JSON.stringify(buildRequestBody(settings, messages)),
      signal: options.signal,
    });
  } catch (err) {
    throw new Error(describeNetworkFailure(err));
  }

  if (!response.ok) {
    throw new Error(await describeHttpFailure(response));
  }

  // Non-streaming: one JSON body.
  if (!settings.stream || !response.body) {
    const payload = await response.json();
    return extractContent(payload);
  }

  // Streaming: server-sent events, `data: {…}` per token, `data: [DONE]` last.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseBuffer(buffer);
    buffer = rest;

    for (const event of events) {
      if (event === "[DONE]") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event);
      } catch {
        continue; // Keep-alive comment or a partial line; ignore it.
      }
      const token = extractDelta(parsed);
      if (token) {
        full += token;
        options.onToken?.(token);
      }
    }
  }

  return full;
}
