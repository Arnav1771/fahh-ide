import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_SETTINGS, parseAgentSettings, settingsProblem, toJudgeConfig, toProviderConfig } from "./agent";
import { baseUrlProblem, chatModels, defaultModelFor, endpointOf, modelsError, modelsWait, PROVIDER_PRESETS, selectPreset, showsBaseUrl } from "./agent";
import { modelListStatus, modelOptions, providerNameOf, TYPE_MODEL, type ModelList } from "./agent";

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

describe("custom endpoints", () => {
  const ep = { id: "a1", name: "Work LLM", baseUrl: "https://llm.example.com/v1", apiKey: "k", kind: "anthropic" };
  it("keeps saved endpoints and a provider that points at one", () => {
    const s = parseAgentSettings(JSON.stringify({ provider: "ep:a1", baseUrl: ep.baseUrl, model: "m", endpoints: [ep, { bad: true }] }));
    expect(s.provider).toBe("ep:a1");
    expect(s.endpoints).toEqual([ep]);
    expect(endpointOf(s)?.name).toBe("Work LLM");
  });
  it("uses the endpoint type for the provider config", () => {
    const s = parseAgentSettings(JSON.stringify({ provider: "ep:a1", baseUrl: ep.baseUrl, model: "m", endpoints: [ep] }));
    expect(toProviderConfig(s)).toMatchObject({ kind: "anthropic", base_url: ep.baseUrl, model: "m" });
  });
  it("falls back to custom when the endpoint was removed", () => {
    const s = parseAgentSettings(JSON.stringify({ provider: "ep:gone", baseUrl: "https://x/v1", model: "m", endpoints: [] }));
    expect(s.provider).toBe("custom");
    expect(toProviderConfig(s).kind).toBe("openai");
  });
});

describe("live model lists", () => {
  it("keeps chat models only, de-duplicated and naturally sorted", () => {
    const groq = ["whisper-large-v3", "openai/gpt-oss-20b", "playai-tts", "llama-3.3-70b-versatile", "meta-llama/llama-guard-4-12b", "openai/gpt-oss-120b", "llama-3.1-8b-instant", " openai/gpt-oss-20b ", ""];
    expect(chatModels(groq)).toEqual(["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "openai/gpt-oss-20b", "openai/gpt-oss-120b"]);
    expect(chatModels(["text-embedding-3-small", "gpt-4o-mini-tts", "dall-e-3", "omni-moderation-latest", "gpt-4o-transcribe", "gpt-4o"])).toEqual(["gpt-4o"]);
    expect(chatModels(["nomic-embed-text:latest", "qwen2.5-coder:7b", "nvidia/llama-3.2-nv-rerankqa-1b-v2"])).toEqual(["qwen2.5-coder:7b"]);
    expect(chatModels([])).toEqual([]);
  });

  it("selects the preset's preferred model only when the provider still lists it", () => {
    expect(defaultModelFor(["a", "openai/gpt-oss-120b"], "groq")).toBe("openai/gpt-oss-120b");
    expect(defaultModelFor(["b", "c"], "groq")).toBe("b");
    expect(defaultModelFor([], "custom")).toBe("");
  });

  it("explains failed list requests in plain words", () => {
    expect(modelsError('provider returned 401 Unauthorized: {"error":"Invalid API Key"}')).toBe("Key rejected (401). Check the API key.");
    expect(modelsError(new Error("provider returned 404 Not Found: nope"))).toMatch(/404.*base URL/);
    expect(modelsError("provider returned 503 Service Unavailable: busy")).toMatch(/\(503\)/);
    expect(modelsError("could not reach the provider: error sending request")).toMatch(/Could not reach/);
    expect(modelsError(new TypeError("Cannot read properties of undefined (reading 'invoke')"))).toMatch(/desktop app/);
    expect(modelsError("")).toBe("Could not load models.");
  });

  it("waits for what the request needs: a key, or a usable URL", () => {
    expect(modelsWait({ provider: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "" })).toMatch(/Groq key/);
    expect(modelsWait({ provider: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "gsk_x" })).toBeNull();
    expect(modelsWait({ provider: "ollama", baseUrl: "http://localhost:11434/v1", apiKey: "" })).toBeNull(); // no key needed
    expect(modelsWait({ provider: "custom", baseUrl: "", apiKey: "" })).toMatch(/base URL/);
    expect(modelsWait({ provider: "custom", baseUrl: "http://localhost:8000/v1", apiKey: "" })).toBeNull(); // key optional
  });
});

describe("the shared model picker", () => {
  const ok: ModelList = { state: "ok", ids: ["m1", "m2"] };
  const values = (l: ModelList, v: string, opt?: boolean) => modelOptions(l, v, opt).map((o) => o.value);

  it("lists the live models, then the typed value, then the escape hatch", () => {
    expect(values(ok, "m1")).toEqual(["m1", "m2", TYPE_MODEL]);
    expect(values(ok, "mine")).toEqual(["m1", "m2", "mine", TYPE_MODEL]);
    expect(modelOptions(ok, "mine").find((o) => o.value === "mine")?.label).toBe("mine (typed)");
    expect(modelOptions(ok, "").at(-1)?.label).toBe("Type a model name…");
  });

  it("asks for a model when none is set; Fast model offers the main model instead", () => {
    expect(modelOptions(ok, "")[0]).toEqual({ value: "", label: "Choose a model", disabled: true });
    expect(modelOptions(ok, "", true)[0]).toEqual({ value: "", label: "Same as main model" });
    expect(modelOptions(ok, "m2", true)[0].label).toBe("Same as main model");
  });

  it("keeps the escape hatch (and the current value) when the list fails or is empty", () => {
    for (const l of [{ state: "error", msg: "x" }, { state: "wait", hint: "y" }, { state: "ok", ids: [] }] as ModelList[]) {
      expect(values(l, "kept")).toEqual(["kept", TYPE_MODEL]);
    }
  });

  it("states every list state in one line", () => {
    expect(modelListStatus({ state: "loading" }, "Groq")).toBe("Loading models…");
    expect(modelListStatus({ state: "wait", hint: "Add your Groq key to load its models." }, "Groq")).toMatch(/Groq key/);
    expect(modelListStatus({ state: "error", msg: "Key rejected (401). Check the API key." }, "Groq")).toMatch(/401/);
    expect(modelListStatus(ok, "Groq")).toBe("2 chat models from Groq");
    expect(modelListStatus({ state: "ok", ids: [] }, "Groq")).toMatch(/listed no chat models.*Type a model name/);
  });

  it("names the provider in sentences", () => {
    expect(providerNameOf({ ...DEFAULT_AGENT_SETTINGS, provider: "groq" })).toBe("Groq");
    expect(providerNameOf({ ...DEFAULT_AGENT_SETTINGS, provider: "custom" })).toBe("your endpoint");
    const ep = { id: "x", name: "Work LLM", baseUrl: "http://h/v1", apiKey: "", kind: "openai" as const };
    expect(providerNameOf({ ...DEFAULT_AGENT_SETTINGS, provider: "ep:x", endpoints: [ep] })).toBe("Work LLM");
  });
});

describe("provider endpoints", () => {
  it("maps each built-in provider to its endpoint and clears the model choice", () => {
    expect(selectPreset("groq")).toEqual({ provider: "groq", baseUrl: "https://api.groq.com/openai/v1", model: "", fastModel: "" });
    expect(selectPreset("ollama")?.baseUrl).toBe("http://localhost:11434/v1");
    expect(selectPreset("custom")?.baseUrl).toBe("");
    expect(selectPreset("nope")).toBeNull();
    for (const p of PROVIDER_PRESETS.filter((x) => x.id !== "custom")) expect(baseUrlProblem(p.baseUrl)).toBeNull();
  });

  it("shows the base URL only for Custom and saved endpoints", () => {
    expect(showsBaseUrl("groq")).toBe(false);
    expect(showsBaseUrl("custom")).toBe(true);
    expect(showsBaseUrl("ep:a1")).toBe(true);
  });

  it("every provider has a key placeholder", () => {
    expect(PROVIDER_PRESETS.find((p) => p.id === "groq")?.keyHint).toMatch(/^gsk_.*console\.groq\.com/);
    expect(PROVIDER_PRESETS.find((p) => p.id === "ollama")?.keyHint).toBe("Not needed");
    expect(PROVIDER_PRESETS.find((p) => p.id === "custom")?.keyHint).toBe("Optional");
    for (const p of PROVIDER_PRESETS) expect(p.keyHint).toBeTruthy();
  });

  it("validates base URLs inline", () => {
    expect(baseUrlProblem("https://llm.example.com/v1")).toBeNull();
    expect(baseUrlProblem(" http://localhost:8000/v1 ")).toBeNull();
    expect(baseUrlProblem("")).toMatch(/Enter/);
    expect(baseUrlProblem("localhost:8000")).toMatch(/http:\/\//);
    expect(baseUrlProblem("ftp://files.example.com")).toMatch(/http:\/\//);
    expect(baseUrlProblem("not a url")).toMatch(/Not a URL/);
  });
});
