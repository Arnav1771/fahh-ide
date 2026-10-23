import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_SETTINGS, parseAgentSettings, settingsProblem, toJudgeConfig, toProviderConfig } from "./agent";

describe("agent settings", () => {
  it("falls back to defaults on garbage", () => {
    expect(parseAgentSettings(null)).toEqual(DEFAULT_AGENT_SETTINGS);
    expect(parseAgentSettings("{not json")).toEqual(DEFAULT_AGENT_SETTINGS);
  });

  it("carries over the legacy AI settings as a custom provider", () => {
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

  it("keeps the fast model and extra folders, and ignores junk", () => {
    const s = parseAgentSettings(JSON.stringify({ provider: "groq", fastModel: "quick", extraDirs: ["/a", 5, "/b"], mode: "smart" }));
    expect(s).toMatchObject({ fastModel: "quick", extraDirs: ["/a", "/b"], mode: "smart" });
    expect(parseAgentSettings(JSON.stringify({ mode: "qa" })).mode).toBe("ask"); // qa is one-shot only
    expect(parseAgentSettings(JSON.stringify({ mode: "bypass" })).mode).toBe("bypass");
  });

  it("judge config follows the fast model", () => {
    expect(toJudgeConfig({ ...DEFAULT_AGENT_SETTINGS, model: "big", fastModel: "" })).toBeNull();
    expect(toJudgeConfig({ ...DEFAULT_AGENT_SETTINGS, model: "big", fastModel: "quick" })?.model).toBe("quick");
    expect(toProviderConfig({ ...DEFAULT_AGENT_SETTINGS, model: "big" }, "other").model).toBe("other");
  });

  it("builds the backend provider config", () => {
    expect(toProviderConfig({ ...DEFAULT_AGENT_SETTINGS, provider: "anthropic", apiKey: " k " })).toMatchObject({ kind: "anthropic", api_key: "k" });
    expect(toProviderConfig({ ...DEFAULT_AGENT_SETTINGS, provider: "ollama", apiKey: "" }).api_key).toBeNull();
  });
});
