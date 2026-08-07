import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AI_SETTINGS,
  buildHeaders,
  buildRequestBody,
  chatCompletionsUrl,
  configurationProblem,
  describeNetworkFailure,
  extractContent,
  extractDelta,
  isConfigured,
  joinUrl,
  parseSseBuffer,
  sendChat,
  type AiSettings,
} from "./ai";

function settings(partial: Partial<AiSettings> = {}): AiSettings {
  return {
    ...DEFAULT_AI_SETTINGS,
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2",
    apiKey: "",
    stream: false,
    ...partial,
  };
}

describe("configuration gating — nothing ships pre-configured", () => {
  it("refuses out of the box", () => {
    expect(isConfigured(DEFAULT_AI_SETTINGS)).toBe(false);
    expect(configurationProblem(DEFAULT_AI_SETTINGS)).toMatch(/base URL/i);
  });

  it("names the missing model once a base URL is set", () => {
    expect(configurationProblem(settings({ model: "" }))).toMatch(/model/i);
  });

  it("rejects a base URL with no scheme", () => {
    expect(configurationProblem(settings({ baseUrl: "localhost:11434/v1" })))
      .toMatch(/http/i);
  });

  it("accepts a complete local configuration with no API key", () => {
    expect(configurationProblem(settings())).toBeNull();
    expect(isConfigured(settings())).toBe(true);
  });

  it("ships with no key and no base URL in the defaults", () => {
    expect(DEFAULT_AI_SETTINGS.apiKey).toBe("");
    expect(DEFAULT_AI_SETTINGS.baseUrl).toBe("");
    expect(DEFAULT_AI_SETTINGS.model).toBe("");
  });
});

describe("URL building", () => {
  it("tolerates a trailing slash on the base URL", () => {
    expect(joinUrl("http://x/v1/", "/chat/completions")).toBe(
      "http://x/v1/chat/completions"
    );
    expect(joinUrl("http://x/v1", "chat/completions")).toBe(
      "http://x/v1/chat/completions"
    );
  });

  it("targets the OpenAI-compatible endpoint", () => {
    expect(chatCompletionsUrl(settings())).toBe(
      "http://localhost:11434/v1/chat/completions"
    );
  });
});

describe("request construction", () => {
  it("omits Authorization when there is no key (local servers reject it)", () => {
    expect(buildHeaders(settings())).toEqual({
      "Content-Type": "application/json",
    });
  });

  it("sends a bearer token when a key is configured", () => {
    expect(buildHeaders(settings({ apiKey: "sk-test" })).Authorization).toBe(
      "Bearer sk-test"
    );
  });

  it("prepends the system prompt", () => {
    const body = buildRequestBody(settings({ systemPrompt: "be terse" }), [
      { role: "user", content: "hi" },
    ]);

    expect(body.messages).toEqual([
      { role: "system", content: "be terse" },
      { role: "user", content: "hi" },
    ]);
    expect(body.model).toBe("llama3.2");
    expect(body.stream).toBe(false);
  });

  it("omits an empty system prompt entirely", () => {
    const body = buildRequestBody(settings({ systemPrompt: "  " }), [
      { role: "user", content: "hi" },
    ]);
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });
});

describe("response parsing", () => {
  it("pulls the message out of a completion", () => {
    expect(
      extractContent({ choices: [{ message: { content: "hello" } }] })
    ).toBe("hello");
  });

  it("returns an empty string for a malformed body instead of throwing", () => {
    expect(extractContent(null)).toBe("");
    expect(extractContent({})).toBe("");
    expect(extractContent({ choices: [] })).toBe("");
    expect(extractContent({ choices: [{}] })).toBe("");
  });

  it("pulls the token out of a stream chunk", () => {
    expect(extractDelta({ choices: [{ delta: { content: "he" } }] })).toBe("he");
    expect(extractDelta({ choices: [{ delta: {} }] })).toBe("");
  });
});

describe("parseSseBuffer — chunk boundaries land mid-line constantly", () => {
  it("extracts complete events and keeps the tail", () => {
    const { events, rest } = parseSseBuffer(
      'data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"'
    );
    expect(events).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('data: {"c"');
  });

  it("handles CRLF line endings", () => {
    const { events } = parseSseBuffer('data: {"a":1}\r\n\r\n');
    expect(events).toEqual(['{"a":1}']);
  });

  it("surfaces the [DONE] sentinel as an event", () => {
    const { events } = parseSseBuffer("data: [DONE]\n\n");
    expect(events).toEqual(["[DONE]"]);
  });

  it("ignores non-data lines such as SSE comments", () => {
    const { events } = parseSseBuffer(': keep-alive\ndata: {"a":1}\n\n');
    expect(events).toEqual(['{"a":1}']);
  });

  it("returns nothing when no event is complete yet", () => {
    const { events, rest } = parseSseBuffer('data: {"a"');
    expect(events).toEqual([]);
    expect(rest).toBe('data: {"a"');
  });
});

describe("sendChat", () => {
  it("refuses to send when not configured, without touching the network", async () => {
    const fetchImpl = vi.fn();
    await expect(
      sendChat(DEFAULT_AI_SETTINGS, [{ role: "user", content: "hi" }], {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow(/base URL/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the assistant text for a non-streaming response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
      json: async () => ({ choices: [{ message: { content: "42" } }] }),
    });

    const reply = await sendChat(
      settings(),
      [{ role: "user", content: "what is 6*7" }],
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    expect(reply).toBe("42");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).model).toBe("llama3.2");
  });

  it("explains a 404 as a missing /v1 suffix", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "",
    });

    await expect(
      sendChat(settings(), [{ role: "user", content: "hi" }], {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow(/\/v1/);
  });

  it("explains a 401 as a rejected key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    });

    await expect(
      sendChat(settings({ apiKey: "bad" }), [{ role: "user", content: "hi" }], {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow(/API key/i);
  });

  it("streams tokens and returns the joined text", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DO',
      "NE]\n\n",
    ].map((s) => new TextEncoder().encode(s));

    let i = 0;
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: async () =>
            i < chunks.length
              ? { done: false, value: chunks[i++] }
              : { done: true, value: undefined },
        }),
      },
    });

    const tokens: string[] = [];
    const reply = await sendChat(
      settings({ stream: true }),
      [{ role: "user", content: "hi" }],
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        onToken: (t) => tokens.push(t),
      }
    );

    expect(tokens).toEqual(["Hel", "lo"]);
    expect(reply).toBe("Hello");
  });
});

describe("describeNetworkFailure", () => {
  it("tells the user about CORS/origin when fetch could not connect", () => {
    expect(describeNetworkFailure(new TypeError("Failed to fetch"))).toMatch(
      /OLLAMA_ORIGINS/
    );
  });

  it("recognises a user-initiated abort", () => {
    const err = new Error("The operation was aborted.");
    expect(describeNetworkFailure(err)).toBe("Request cancelled.");
  });

  it("falls back to the raw message", () => {
    expect(describeNetworkFailure(new Error("socket hang up"))).toBe(
      "socket hang up"
    );
  });
});
