/** Fahh Local: IPC wrappers, provider presets and settings parsing. */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentContextInfo,
  AgentDecision,
  AgentDiagFile,
  AgentEnvelope,
  AgentFileDiff,
  AgentLoaded,
  AgentMode,
  AgentProviderConfig,
  AgentProviderKind,
  AgentRevertResult,
  AgentSessionInfo,
  AgentStartParams,
  AgentStartResult,
  AgentTurnRec,
  AgentUsage,
  AgentsReport,
} from "./types";

export const agentStart = (params: AgentStartParams) => invoke<AgentStartResult>("agent_start", { params });
export const agentApprove = (session: string, approval: string, decision: AgentDecision) =>
  invoke<void>("agent_approve", { session, approval, decision });
export const agentStop = (session: string) => invoke<void>("agent_stop", { session });
export const agentRevertTurn = (session: string, turn: number) => invoke<string[]>("agent_revert_turn", { session, turn });
export const agentRevertFile = (session: string, turn: number, path: string) =>
  invoke<void>("agent_revert_file", { session, turn, path });
export const agentTurnDiff = (session: string, turn: number) => invoke<AgentFileDiff[]>("agent_turn_diff", { session, turn });
export const agentListModels = (provider: AgentProviderConfig) => invoke<string[]>("agent_list_models", { provider });
export const agentSetDiagnostics = (files: AgentDiagFile[]) => invoke<void>("agent_set_diagnostics", { files });

export const agentStopChild = (session: string, child: string) => invoke<void>("agent_stop_child", { session, child });

// sessions, steps, context
export const agentSessions = (workspace: string) => invoke<AgentSessionInfo[]>("agent_sessions", { workspace });
export const agentSessionLoad = (workspace: string, id?: string | null, extraDirs?: string[]) =>
  invoke<AgentLoaded>("agent_session_load", { workspace, id: id ?? null, extraDirs: extraDirs ?? [] });
export const agentSessionFork = (session: string, step?: number | null) => invoke<AgentLoaded>("agent_session_fork", { session, step: step ?? null });
export const agentSessionRevert = (session: string, step: number) => invoke<AgentRevertResult>("agent_session_revert", { session, step });
export const agentSessionRename = (session: string, title: string) => invoke<void>("agent_session_rename", { session, title });
export const agentSessionRemove = (workspace: string, id: string) => invoke<void>("agent_session_remove", { workspace, id });
export const agentSteps = (session: string) => invoke<AgentTurnRec[]>("agent_steps", { session });
export const agentCompact = (session: string, provider: AgentProviderConfig) =>
  invoke<{ folded: number; before: number; after: number }>("agent_compact", { session, provider });
export const agentContext = (session: string, model: string) => invoke<AgentContextInfo>("agent_context", { session, model });
export const agentUsage = (session: string) => invoke<AgentUsage>("agent_usage", { session });
export const agentExport = (session: string, path?: string | null) => invoke<string>("agent_export", { session, path: path ?? null });
export const agentAgents = (workspace: string) => invoke<AgentsReport>("agent_agents", { workspace });

export const listenAgent = (cb: (e: AgentEnvelope) => void): Promise<UnlistenFn> =>
  listen<AgentEnvelope>("agent://event", (e) => cb(e.payload));

// ─── providers ────────────────────────────────────────────────────────────────

export interface ProviderPreset {
  id: string;
  label: string;
  kind: AgentProviderKind;
  /** Implied by the provider: shown only under "Edit endpoint" (and always for Custom). */
  baseUrl: string;
  needsKey: boolean;
  /** Preferred pick once the live model list loads, used only when the provider still lists it. */
  defaultModel: string;
  /** API key placeholder: what a key looks like and where to get one. */
  keyHint: string;
}

/** Model names are never hardcoded here: the list comes live from the provider (`agent_list_models`). */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: "groq", label: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", needsKey: true, defaultModel: "openai/gpt-oss-120b", keyHint: "gsk_… from console.groq.com" },
  { id: "openai", label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", needsKey: true, defaultModel: "gpt-4o", keyHint: "sk-… from platform.openai.com" },
  { id: "anthropic", label: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", needsKey: true, defaultModel: "claude-3-7-sonnet-latest", keyHint: "sk-ant-… from console.anthropic.com" },
  { id: "ollama", label: "Ollama (local)", kind: "openai", baseUrl: "http://localhost:11434/v1", needsKey: false, defaultModel: "llama3.2", keyHint: "Not needed" },
  { id: "openrouter", label: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", needsKey: true, defaultModel: "anthropic/claude-3.7-sonnet", keyHint: "sk-or-… from openrouter.ai/keys" },
  { id: "gemini", label: "Gemini", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", needsKey: true, defaultModel: "gemini-2.0-flash", keyHint: "AIza… from aistudio.google.com" },
  { id: "nvidia", label: "NVIDIA NIM", kind: "openai", baseUrl: "https://integrate.api.nvidia.com/v1", needsKey: true, defaultModel: "meta/llama-3.3-70b-instruct", keyHint: "nvapi-… from build.nvidia.com" },
  { id: "custom", label: "Custom (OpenAI-compatible)", kind: "openai", baseUrl: "", needsKey: false, defaultModel: "", keyHint: "Optional" },
];

export const presetOf = (id: string): ProviderPreset | undefined => PROVIDER_PRESETS.find((p) => p.id === id);

/** Custom and saved endpoints show their base URL; built-in providers imply theirs. */
export const showsBaseUrl = (provider: string) => provider === "custom" || provider.startsWith("ep:");

/** What picking a built-in provider changes: its endpoint, and a fresh model choice. */
export function selectPreset(id: string): Partial<AgentSettings> | null {
  const p = presetOf(id);
  return p ? { provider: p.id, baseUrl: p.baseUrl, model: "", fastModel: "" } : null;
}

/** Inline check for a base URL field: why it is not usable, or null. */
export function baseUrlProblem(url: string): string | null {
  const u = url.trim();
  if (!u) return "Enter the endpoint's base URL.";
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return "Not a URL. Example: https://llm.example.com/v1";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Start with http:// or https://, e.g. http://localhost:8000/v1";
  if (!parsed.hostname) return "The URL needs a host name.";
  return null;
}

/** Ids that are not chat models: speech, embeddings, safety classifiers, images, rerankers. */
const NON_CHAT = /whisper|tts|embed|guard|moderation|dall-e|gpt-image|imagen|veo-|sora|transcribe|audio|realtime|rerank|babbage|davinci|search-preview|computer-use|lyria|\baqa\b/i;
export const isChatModel = (id: string) => !NON_CHAT.test(id);

/** A provider's model list, ready for a dropdown: chat models only, de-duplicated, natural sort. */
export function chatModels(ids: readonly string[]): string[] {
  const clean = [...new Set(ids.map((s) => s.trim()).filter(Boolean))].filter(isChatModel);
  return clean.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

/** The model to select once a list loads: the preset's preference if offered, else the first. */
export const defaultModelFor = (ids: readonly string[], provider: string): string => {
  const pref = presetOf(provider)?.defaultModel;
  return pref && ids.includes(pref) ? pref : ids[0] ?? "";
};

/** Why the model list cannot be fetched yet (shown instead of a list), or null. */
export function modelsWait(s: Pick<AgentSettings, "provider" | "baseUrl" | "apiKey">): string | null {
  if (baseUrlProblem(s.baseUrl)) return s.baseUrl.trim() ? "Fix the base URL to load models." : "Enter a base URL to load its models.";
  const p = presetOf(s.provider);
  if (p?.needsKey && !s.apiKey.trim()) return `Add your ${p.label} key to load its models.`;
  return null;
}

/** A failed model-list request in plain words (the backend passes the provider's status through). */
export function modelsError(e: unknown): string {
  const m = (e instanceof Error ? e.message : String(e)).trim();
  const code = /provider returned (\d{3})/.exec(m)?.[1];
  if (code === "401") return "Key rejected (401). Check the API key.";
  if (code === "403") return "This key cannot list models (403).";
  if (code === "404") return "No model list at this URL (404). Check the base URL.";
  if (code === "429") return "Rate limited (429). Wait a moment, then retry.";
  if (code) return `The provider returned an error (${code}). Retry in a moment.`;
  if (/could not reach/i.test(m)) return "Could not reach the provider. Check the URL and your connection.";
  if (/invoke|__TAURI|transformCallback/.test(m)) return "Model lists load in the desktop app.";
  return m.slice(0, 200) || "Could not load models.";
}

/** The provider's model list, live: waiting for setup, loading, failed, or loaded (possibly empty). */
export type ModelList = { state: "wait"; hint: string } | { state: "loading" } | { state: "error"; msg: string } | { state: "ok"; ids: string[] };

/** The option value that switches a model picker to a free-text field. */
export const TYPE_MODEL = "__type";

/**
 * Every model picker's options, in order: the empty choice ("Same as main model" for
 * the optional Fast model, a disabled prompt otherwise), the live list, the current
 * value when the list lacks it, and the "Type a model name…" escape hatch.
 */
export function modelOptions(list: ModelList, value: string, optional = false): { value: string; label: string; disabled?: boolean }[] {
  const ids = list.state === "ok" ? list.ids : [];
  const head = optional ? [{ value: "", label: "Same as main model" }] : value ? [] : [{ value: "", label: "Choose a model", disabled: true }];
  const typed = value && !ids.includes(value) ? [{ value, label: `${value} (typed)` }] : [];
  return [...head, ...ids.map((m) => ({ value: m, label: m })), ...typed, { value: TYPE_MODEL, label: "Type a model name…" }];
}

/** The provider's name in sentences: a saved endpoint's name, "your endpoint", or the preset label. */
export function providerNameOf(s: AgentSettings): string {
  return endpointOf(s)?.name ?? (s.provider === "custom" ? "your endpoint" : presetOf(s.provider)?.label) ?? "the provider";
}

/** The one line under a model picker: what state the live list is in. */
export function modelListStatus(list: ModelList, providerName: string): string {
  switch (list.state) {
    case "loading":
      return "Loading models…";
    case "wait":
      return list.hint;
    case "error":
      return list.msg;
    case "ok":
      return list.ids.length ? `${list.ids.length} chat models from ${providerName}` : `${providerName} listed no chat models. Choose “Type a model name…”.`;
  }
}

/** An AI endpoint the user added (Fahh Local settings > Save a named endpoint). */
export interface CustomEndpoint {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  kind: AgentProviderKind;
}

/** A saved endpoint is selected with provider `ep:<id>`. */
export const endpointOf = (s: Pick<AgentSettings, "provider" | "endpoints">): CustomEndpoint | undefined =>
  s.provider.startsWith("ep:") ? s.endpoints.find((e) => `ep:${e.id}` === s.provider) : undefined;

export interface AgentSettings {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  mode: AgentMode;
  /** The fast model: /fast, and the Smart-mode judge. Empty = use the main model. */
  fastModel: string;
  /** Folders added with /add-dir. */
  extraDirs: string[];
  /** The user's own endpoints. */
  endpoints: CustomEndpoint[];
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  provider: "groq",
  baseUrl: PROVIDER_PRESETS[0].baseUrl,
  model: "",
  apiKey: "",
  mode: "ask",
  fastModel: "",
  extraDirs: [],
  endpoints: [],
};

/** Modes that can be the default (qa is only ever the one-shot /ask). */
const MODES: AgentMode[] = ["ask", "auto-edit", "smart", "plan", "bypass"];

/**
 * Parse persisted settings defensively. An older (pre-Fahh Local) AI config
 * (`fahh-ai-settings`: baseUrl, model, apiKey) is carried over as "custom".
 */
export function parseAgentSettings(raw: string | null, legacy: string | null = null): AgentSettings {
  const read = (s: string | null): Record<string, unknown> | null => {
    try {
      const v = s ? JSON.parse(s) : null;
      return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
  const cur = read(raw);
  if (cur) {
    const endpoints: CustomEndpoint[] = (Array.isArray(cur.endpoints) ? cur.endpoints : [])
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && typeof (e as Record<string, unknown>).id === "string" && typeof (e as Record<string, unknown>).baseUrl === "string")
      .map((e) => ({ id: e.id as string, name: str(e.name, "My endpoint"), baseUrl: e.baseUrl as string, apiKey: str(e.apiKey, ""), kind: e.kind === "anthropic" ? "anthropic" : "openai" }));
    const known = PROVIDER_PRESETS.some((p) => p.id === cur.provider) || endpoints.some((e) => `ep:${e.id}` === cur.provider);
    const provider = known ? (cur.provider as string) : "custom";
    return {
      provider,
      baseUrl: str(cur.baseUrl, "") || presetOf(provider)?.baseUrl || "",
      model: str(cur.model, ""), // empty: picked from the live list
      apiKey: str(cur.apiKey, ""),
      mode: MODES.includes(cur.mode as AgentMode) ? (cur.mode as AgentMode) : "ask",
      fastModel: str(cur.fastModel, ""),
      extraDirs: Array.isArray(cur.extraDirs) ? cur.extraDirs.filter((d): d is string => typeof d === "string") : [],
      endpoints,
    };
  }
  const old = read(legacy);
  if (old && typeof old.baseUrl === "string" && old.baseUrl) {
    return { provider: "custom", baseUrl: old.baseUrl, model: str(old.model, ""), apiKey: str(old.apiKey, ""), mode: "ask", fastModel: "", extraDirs: [], endpoints: [] };
  }
  return { ...DEFAULT_AGENT_SETTINGS };
}

/** Why a turn cannot start yet, or null. */
export function settingsProblem(s: AgentSettings): string | null {
  if (baseUrlProblem(s.baseUrl)) return "Set a provider base URL (http:// or https://).";
  if (!s.model.trim()) return "Set a model name.";
  const preset = presetOf(s.provider);
  if (preset?.needsKey && !s.apiKey.trim()) return `${preset.label} needs an API key.`;
  return null;
}

export function toProviderConfig(s: AgentSettings, modelOverride?: string): AgentProviderConfig {
  return {
    kind: endpointOf(s)?.kind ?? presetOf(s.provider)?.kind ?? "openai",
    base_url: s.baseUrl.trim(),
    model: (modelOverride ?? s.model).trim(),
    api_key: s.apiKey.trim() || null,
  };
}

/** The Smart-mode judge: the fast model when one is set, else the backend falls back to the main model. */
export function toJudgeConfig(s: AgentSettings): AgentProviderConfig | null {
  return s.fastModel.trim() ? toProviderConfig(s, s.fastModel) : null;
}
