import { create } from "zustand";
import { DEFAULT_AI_SETTINGS, type AiSettings, type ChatMessage } from "../lib/ai";

/**
 * Settings live in `localStorage` under this key — the same persistence
 * mechanism `themeStore` already uses for the active theme. The API key is
 * stored there in plain text, exactly like a browser-based client would; the
 * panel says so, and leaving the field blank is fully supported for local
 * servers that need no key.
 */
const STORAGE_KEY = "fahh-ai-settings";

/** Parse persisted settings defensively — the shape can predate a release. */
export function parseSettings(raw: string | null): AiSettings {
  if (!raw) return { ...DEFAULT_AI_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    return {
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      systemPrompt:
        typeof parsed.systemPrompt === "string"
          ? parsed.systemPrompt
          : DEFAULT_AI_SETTINGS.systemPrompt,
      stream:
        typeof parsed.stream === "boolean"
          ? parsed.stream
          : DEFAULT_AI_SETTINGS.stream,
    };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

function readPersisted(): AiSettings {
  try {
    return parseSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    // localStorage unavailable (tests, restricted webview).
    return { ...DEFAULT_AI_SETTINGS };
  }
}

function persist(settings: AiSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Non-fatal: the panel still works for this session.
  }
}

interface AiStore {
  settings: AiSettings;
  messages: ChatMessage[];
  /** True while a request is in flight. */
  sending: boolean;
  /** Text of the assistant reply as it streams in. */
  streaming: string;
  error: string | null;

  updateSettings: (patch: Partial<AiSettings>) => void;
  resetSettings: () => void;
  appendMessage: (message: ChatMessage) => void;
  setStreaming: (text: string) => void;
  appendStreaming: (token: string) => void;
  setSending: (sending: boolean) => void;
  setError: (error: string | null) => void;
  clearConversation: () => void;
}

export const useAiStore = create<AiStore>((set) => ({
  settings: readPersisted(),
  messages: [],
  sending: false,
  streaming: "",
  error: null,

  updateSettings: (patch) =>
    set((state) => {
      const settings = { ...state.settings, ...patch };
      persist(settings);
      return { settings };
    }),

  resetSettings: () => {
    const settings = { ...DEFAULT_AI_SETTINGS };
    persist(settings);
    set({ settings });
  },

  appendMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  setStreaming: (text) => set({ streaming: text }),

  appendStreaming: (token) =>
    set((state) => ({ streaming: state.streaming + token })),

  setSending: (sending) => set({ sending }),

  setError: (error) => set({ error }),

  clearConversation: () => set({ messages: [], streaming: "", error: null }),
}));
