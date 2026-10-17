/** Fahh Local: IPC wrappers, provider presets and settings parsing. */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentDecision,
  AgentDiagFile,
  AgentEnvelope,
  AgentFileDiff,
  AgentMode,
  AgentProviderConfig,
  AgentProviderKind,
  AgentStartParams,
  AgentStartResult,
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

export const listenAgent = (cb: (e: AgentEnvelope) => void): Promise<UnlistenFn> =>
  listen<AgentEnvelope>("agent://event", (e) => cb(e.payload));

// ─── providers ────────────────────────────────────────────────────────────────

export interface ProviderPreset {
  id: string;
  label: string;
  kind: AgentProviderKind;
  baseUrl: string;
  needsKey: boolean;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: "groq", label: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", needsKey: true },
  { id: "nvidia", label: "NVIDIA NIM", kind: "openai", baseUrl: "https://integrate.api.nvidia.com/v1", needsKey: true },
  { id: "openrouter", label: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", needsKey: true },
  { id: "gemini", label: "Gemini", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", needsKey: true },
  { id: "ollama", label: "Ollama (local)", kind: "openai", baseUrl: "http://localhost:11434/v1", needsKey: false },
  { id: "anthropic", label: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", needsKey: true },
  { id: "custom", label: "Custom (OpenAI-compatible)", kind: "openai", baseUrl: "", needsKey: false },
];

export interface AgentSettings {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  mode: AgentMode;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  provider: "groq",
  baseUrl: PROVIDER_PRESETS[0].baseUrl,
  model: "",
  apiKey: "",
  mode: "ask",
};

const MODES: AgentMode[] = ["ask", "auto-edit", "plan"];

/**
 * Parse persisted settings defensively. An older AI Composer config
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
    const provider = PROVIDER_PRESETS.some((p) => p.id === cur.provider) ? (cur.provider as string) : "custom";
    return {
      provider,
      baseUrl: str(cur.baseUrl, ""),
      model: str(cur.model, ""),
      apiKey: str(cur.apiKey, ""),
      mode: MODES.includes(cur.mode as AgentMode) ? (cur.mode as AgentMode) : "ask",
    };
  }
  const old = read(legacy);
  if (old && typeof old.baseUrl === "string" && old.baseUrl) {
    return { provider: "custom", baseUrl: old.baseUrl, model: str(old.model, ""), apiKey: str(old.apiKey, ""), mode: "ask" };
  }
  return { ...DEFAULT_AGENT_SETTINGS };
}

/** Why a turn cannot start yet, or null. */
export function settingsProblem(s: AgentSettings): string | null {
  if (!/^https?:\/\//i.test(s.baseUrl.trim())) return "Set a provider base URL (http:// or https://).";
  if (!s.model.trim()) return "Set a model name.";
  const preset = PROVIDER_PRESETS.find((p) => p.id === s.provider);
  if (preset?.needsKey && !s.apiKey.trim()) return `${preset.label} needs an API key.`;
  return null;
}

export function toProviderConfig(s: AgentSettings): AgentProviderConfig {
  const preset = PROVIDER_PRESETS.find((p) => p.id === s.provider);
  return {
    kind: preset?.kind ?? "openai",
    base_url: s.baseUrl.trim(),
    model: s.model.trim(),
    api_key: s.apiKey.trim() || null,
  };
}
