import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_SETTINGS, parseAgentSettings, settingsProblem, toProviderConfig } from "./agent";

describe("agent settings", () => {
  it("falls back to defaults on garbage", () => {
    expect(parseAgentSettings(null)).toEqual(DEFAULT_AGENT_SETTINGS);
    expect(parseAgentSettings("{not json")).toEqual(DEFAULT_AGENT_SETTINGS);
  });

  it("carries over the old AI Composer config as a custom provider", () => {
    const s = parseAgentSettings(null, JSON.stringify({ baseUrl: "http://localhost:11434/v1", model: "llama3.2", apiKey: "" }));
    expect(s).toMatchObject({ provider: "custom", baseUrl: "http://localhost:11434/v1", model: "llama3.2", mode: "ask" });
  });

  it("validates mode and provider", () => {
    const s = parseAgentSettings(JSON.stringify({ provider: "weird", baseUrl: "http://x", model: "m", mode: "yolo" }));
    expect(s.provider).toBe("custom");
    expect(s.mode).toBe("ask");
    expect(parseAgentSettings(JSON.stringify({ provider: "groq", mode: "plan" })).mode).toBe("plan");
  });

  it("explains what is missing before a turn can start", () => {
    expect(settingsProblem({ ...DEFAULT_AGENT_SETTINGS })).toMatch(/model/); // no default model
    expect(settingsProblem({ ...DEFAULT_AGENT_SETTINGS, model: "m" })).toMatch(/API key/);
    expect(settingsProblem({ ...DEFAULT_AGENT_SETTINGS, model: "m", apiKey: "k" })).toBeNull();
    expect(settingsProblem({ ...DEFAULT_AGENT_SETTINGS, provider: "ollama", baseUrl: "localhost" })).toMatch(/base URL/);
    expect(settingsProblem({ ...DEFAULT_AGENT_SETTINGS, provider: "ollama", baseUrl: "http://localhost:11434/v1", model: "" })).toMatch(/model/);
    expect(settingsProblem({ ...DEFAULT_AGENT_SETTINGS, provider: "ollama", baseUrl: "http://localhost:11434/v1", model: "m" })).toBeNull();
  });

  it("builds the backend provider config", () => {
    expect(toProviderConfig({ ...DEFAULT_AGENT_SETTINGS, provider: "anthropic", apiKey: " k " })).toMatchObject({ kind: "anthropic", api_key: "k" });
    expect(toProviderConfig({ ...DEFAULT_AGENT_SETTINGS, provider: "ollama", apiKey: "" }).api_key).toBeNull();
  });
});
