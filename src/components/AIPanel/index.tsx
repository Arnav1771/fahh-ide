/**
 * AI Assistant panel.
 *
 * Fahh Editor ships with NO AI provider and NO API key. This panel talks to
 * whatever OpenAI-compatible `/v1/chat/completions` endpoint the user points
 * it at — a local Ollama or LM Studio server, or a hosted provider. Until a
 * base URL and a model are configured it says so plainly and refuses to send.
 *
 * The request/response plumbing lives in `src/lib/ai.ts`; settings and
 * conversation state live in `useAiStore`.
 */

import { useEffect, useRef, useState } from "react";
import { Bot, CircleAlert, Send, Settings2, Square, Trash2 } from "lucide-react";

import { useAiStore } from "../../store/aiStore";
import { useEditorStore } from "../../store/editorStore";
import {
  configurationProblem,
  isConfigured,
  sendChat,
  type ChatMessage,
} from "../../lib/ai";

// ─── Settings form ────────────────────────────────────────────────────────────

function SettingsForm({ onDone }: { onDone: () => void }) {
  const { settings, updateSettings, resetSettings } = useAiStore();

  return (
    <div className="p-2 space-y-2 border-b border-fahh-surface text-xs">
      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-fahh-muted">
          Base URL
        </span>
        <input
          value={settings.baseUrl}
          onChange={(e) => updateSettings({ baseUrl: e.target.value })}
          placeholder="http://localhost:11434/v1"
          spellCheck={false}
          className="mt-0.5 w-full bg-fahh-bg border border-fahh-surface rounded px-2 py-1 text-xs text-fahh-text placeholder:text-fahh-muted focus:outline-none focus:border-fahh-accent"
        />
      </label>

      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-fahh-muted">
          Model
        </span>
        <input
          value={settings.model}
          onChange={(e) => updateSettings({ model: e.target.value })}
          placeholder="llama3.2"
          spellCheck={false}
          className="mt-0.5 w-full bg-fahh-bg border border-fahh-surface rounded px-2 py-1 text-xs text-fahh-text placeholder:text-fahh-muted focus:outline-none focus:border-fahh-accent"
        />
      </label>

      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-fahh-muted">
          API key (optional)
        </span>
        <input
          type="password"
          value={settings.apiKey}
          onChange={(e) => updateSettings({ apiKey: e.target.value })}
          placeholder="leave blank for local servers"
          spellCheck={false}
          className="mt-0.5 w-full bg-fahh-bg border border-fahh-surface rounded px-2 py-1 text-xs text-fahh-text placeholder:text-fahh-muted focus:outline-none focus:border-fahh-accent"
        />
      </label>

      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-fahh-muted">
          System prompt
        </span>
        <textarea
          value={settings.systemPrompt}
          onChange={(e) => updateSettings({ systemPrompt: e.target.value })}
          rows={2}
          className="mt-0.5 w-full resize-none bg-fahh-bg border border-fahh-surface rounded px-2 py-1 text-xs text-fahh-text focus:outline-none focus:border-fahh-accent"
        />
      </label>

      <label className="flex items-center gap-1.5 text-fahh-muted">
        <input
          type="checkbox"
          checked={settings.stream}
          onChange={(e) => updateSettings({ stream: e.target.checked })}
        />
        Stream the response
      </label>

      <p className="text-[10px] text-fahh-muted opacity-70 leading-relaxed">
        Stored in this machine&apos;s <code>localStorage</code>, including the
        key. Nothing is sent anywhere except the base URL above. For Ollama,
        start it with <code>OLLAMA_ORIGINS=*</code> so the desktop app&apos;s
        origin is allowed.
      </p>

      <div className="flex gap-2">
        <button
          onClick={onDone}
          className="flex-1 py-1 rounded text-xs bg-fahh-accent/90 text-white hover:bg-fahh-accent transition-colors"
        >
          Done
        </button>
        <button
          onClick={resetSettings}
          className="px-2 py-1 rounded text-xs text-fahh-muted hover:text-fahh-text transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className="px-2 py-1.5">
      <div
        className={`text-[10px] uppercase tracking-wider mb-0.5 ${
          isUser ? "text-fahh-muted" : "text-fahh-accent"
        }`}
      >
        {isUser ? "You" : "Assistant"}
      </div>
      <div className="text-xs text-fahh-text whitespace-pre-wrap break-words leading-relaxed">
        {message.content}
      </div>
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function AIPanel() {
  const {
    settings,
    messages,
    sending,
    streaming,
    error,
    appendMessage,
    setStreaming,
    appendStreaming,
    setSending,
    setError,
    clearConversation,
  } = useAiStore();

  const { activeTab, openTabs } = useEditorStore();
  const activeDoc = openTabs.find((t) => t.path === activeTab) ?? null;

  const [showSettings, setShowSettings] = useState(!isConfigured(settings));
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const problem = configurationProblem(settings);

  // Keep the transcript pinned to the bottom as tokens arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // Abort any in-flight request if the panel goes away.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || sending || problem) return;

    const userMessage: ChatMessage = { role: "user", content: text };
    const history = [...messages, userMessage];

    appendMessage(userMessage);
    setInput("");
    setError(null);
    setStreaming("");
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const reply = await sendChat(settings, history, {
        signal: controller.signal,
        onToken: (token) => appendStreaming(token),
      });
      if (reply.trim()) {
        appendMessage({ role: "assistant", content: reply });
      } else {
        setError("The endpoint returned an empty response.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStreaming("");
      setSending(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    <div className="flex flex-col h-full bg-fahh-sidebar overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-fahh-surface shrink-0">
        <span className="text-[10px] uppercase tracking-widest text-fahh-muted font-semibold">
          AI Assistant
        </span>
        <div className="flex-1" />
        <button
          onClick={() => clearConversation()}
          disabled={messages.length === 0}
          title="Clear conversation"
          className="text-fahh-muted hover:text-fahh-text disabled:opacity-40 transition-colors"
        >
          <Trash2 size={13} />
        </button>
        <button
          onClick={() => setShowSettings((s) => !s)}
          title="Provider settings"
          className={`transition-colors ${
            showSettings
              ? "text-fahh-accent"
              : "text-fahh-muted hover:text-fahh-text"
          }`}
        >
          <Settings2 size={13} />
        </button>
      </div>

      {showSettings && <SettingsForm onDone={() => setShowSettings(false)} />}

      {/* Not-configured state */}
      {problem && !showSettings && (
        <div className="px-3 py-3 space-y-2">
          <div className="flex items-start gap-2 text-xs text-fahh-muted">
            <Bot size={14} className="shrink-0 mt-[1px]" />
            <span>{problem}</span>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="w-full py-1 rounded text-xs bg-fahh-accent/90 text-white hover:bg-fahh-accent transition-colors"
          >
            Configure a provider
          </button>
          <p className="text-[10px] text-fahh-muted opacity-70 leading-relaxed">
            Any OpenAI-compatible endpoint works — Ollama, LM Studio,
            llama.cpp, vLLM, OpenRouter, OpenAI. No provider or key ships with
            this editor.
          </p>
        </div>
      )}

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        {!problem && messages.length === 0 && !streaming && (
          <p className="px-3 py-3 text-xs text-fahh-muted">
            Connected to{" "}
            <span className="text-fahh-text">{settings.model}</span>. Ask
            anything.
            {activeDoc && (
              <>
                {" "}
                The open file is{" "}
                <span className="text-fahh-text">
                  {activeDoc.path.split("/").pop()}
                </span>{" "}
                — paste the part you want help with.
              </>
            )}
          </p>
        )}

        {messages.map((message, i) => (
          <Bubble key={i} message={message} />
        ))}

        {streaming && (
          <Bubble message={{ role: "assistant", content: streaming }} />
        )}

        {sending && !streaming && (
          <p className="px-3 py-1.5 text-[11px] text-fahh-muted animate-pulse">
            Thinking…
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-1.5 flex items-start gap-1.5 text-[11px] text-fahh-error border-t border-fahh-surface shrink-0">
          <CircleAlert size={12} className="shrink-0 mt-[1px]" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      {/* Composer */}
      {!problem && (
        <div className="p-2 border-t border-fahh-surface shrink-0">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Ask… (Enter to send, Shift+Enter for a newline)"
            rows={3}
            disabled={sending}
            className="w-full resize-none bg-fahh-bg border border-fahh-surface rounded px-2 py-1 text-xs text-fahh-text placeholder:text-fahh-muted focus:outline-none focus:border-fahh-accent disabled:opacity-60"
          />
          <div className="flex gap-2 mt-1.5">
            <button
              onClick={() => void send()}
              disabled={sending || !input.trim()}
              className="flex-1 flex items-center justify-center gap-1.5 py-1 rounded text-xs font-medium bg-fahh-accent/90 text-white hover:bg-fahh-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={12} />
              Send
            </button>
            {sending && (
              <button
                onClick={stop}
                title="Stop"
                className="px-2 py-1 rounded text-xs text-fahh-muted hover:text-fahh-error transition-colors"
              >
                <Square size={12} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
