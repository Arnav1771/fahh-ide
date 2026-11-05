/**
 * The one model picker. Every place a Fahh Local model is chosen (settings Model and
 * Fast model, the panel header, the Welcome step) renders `<ModelPicker>` over the list
 * from `useModelList()`, so they share one live list, one set of loading / error /
 * empty states and one "Type a model name…" escape hatch. `modelPicker.test.ts`
 * fails if a picker grows its own <select> again.
 */
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { agentListModels, chatModels, defaultModelFor, modelListStatus, modelOptions, modelsError, modelsWait, toProviderConfig, TYPE_MODEL, type ModelList } from "../lib/agent";
import { useAgentStore } from "../store/agentStore";

export const modelField =
  "mt-0.5 w-full bg-fahh-bg border border-fahh-surface rounded px-2 py-1 text-xs text-fahh-text placeholder:text-fahh-muted focus:outline-none focus:border-fahh-accent focus-visible:ring-1 focus-visible:ring-fahh-accent disabled:opacity-60";
const compactField = "text-[10px] bg-fahh-bg border border-fahh-surface rounded px-1.5 py-0.5 text-fahh-accent shrink-0 w-[88px] truncate focus:outline-none focus:border-fahh-accent";

/**
 * The chat models for the current provider/endpoint/key, fetched live (debounced while
 * typing) and again on reload. Once a list loads and no model is set, it picks the
 * provider's preferred one.
 */
export function useModelList(): [ModelList, () => void] {
  const settings = useAgentStore((s) => s.settings);
  const updateSettings = useAgentStore((s) => s.updateSettings);
  const [list, setList] = useState<ModelList>({ state: "loading" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const hint = modelsWait(settings);
    if (hint) return void setList({ state: "wait", hint });
    setList({ state: "loading" });
    let live = true;
    const t = setTimeout(() => {
      agentListModels(toProviderConfig(settings, "")).then(
        (ids) => live && setList({ state: "ok", ids: chatModels(ids) }),
        (e) => live && setList({ state: "error", msg: modelsError(e) }),
      );
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [settings.provider, settings.baseUrl, settings.apiKey, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const s = useAgentStore.getState().settings;
    if (list.state === "ok" && list.ids.length && !s.model) updateSettings({ model: defaultModelFor(list.ids, s.provider) });
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps
  return [list, () => setNonce((n) => n + 1)];
}

interface Props {
  id: string;
  value: string;
  onChange: (v: string) => void;
  list: ModelList;
  /** The Fast model: adds "Same as main model" (the empty value). */
  optional?: boolean;
  /** The panel header's small variant. */
  compact?: boolean;
  /** Shows the list's state under the picker, with Retry on errors and a refresh button. */
  status?: { providerName: string; reload: () => void };
}

/** A model dropdown over the live list, with a "Type a model name…" escape hatch. */
export function ModelPicker({ id, value, onChange, list, optional, compact, status }: Props) {
  const [typing, setTyping] = useState(false);
  const cls = compact ? compactField : modelField;
  const name = optional ? "Fast model" : "Model";
  const picker =
    list.state === "loading" ? (
      <div className={compact ? "h-[18px] w-[88px] shrink-0 rounded bg-fahh-surface animate-pulse motion-reduce:animate-none" : "mt-0.5 h-[26px] rounded bg-fahh-surface animate-pulse motion-reduce:animate-none"} aria-label="Loading models" data-testid={`${id}-skeleton`} />
    ) : typing ? (
      <input
        id={id}
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTyping(false)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && (e.stopPropagation(), setTyping(false))}
        placeholder="Exact model id from the provider"
        aria-label={`${name} name`}
        spellCheck={false}
        className={cls}
        data-testid={`${id}-typed`}
      />
    ) : (
      <select
        id={id}
        value={value}
        onChange={(e) => (e.target.value === TYPE_MODEL ? setTyping(true) : onChange(e.target.value))}
        aria-label={compact ? name : undefined}
        title={compact ? `${name}: ${value || "none"}${list.state === "error" ? ` (${list.msg})` : list.state === "wait" ? ` (${list.hint})` : ""}` : undefined}
        className={cls}
        data-testid={id}
      >
        {modelOptions(list, value, optional).map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>
    );
  if (!status) return picker;
  return (
    <>
      <div className="flex items-center gap-1">
        <div className="flex-1 min-w-0">{picker}</div>
        <button
          type="button"
          onClick={status.reload}
          disabled={list.state === "loading" || list.state === "wait"}
          aria-label="Refresh models"
          title="Refresh models"
          className="mt-0.5 p-1 rounded text-fahh-muted hover:text-fahh-text disabled:opacity-40 focus-visible:outline focus-visible:outline-1 focus-visible:outline-fahh-accent"
        >
          <RefreshCw size={12} className={list.state === "loading" ? "animate-spin motion-reduce:animate-none" : ""} />
        </button>
      </div>
      <p className={`mt-1 flex items-start gap-2 text-[11px] ${list.state === "error" ? "text-fahh-error" : "text-fahh-muted"}`} aria-live="polite" data-testid="models-msg">
        <span className="flex-1 break-words" data-testid={list.state === "error" ? "models-error" : undefined}>{modelListStatus(list, status.providerName)}</span>
        {list.state === "error" && (
          <button type="button" onClick={status.reload} className="shrink-0 underline hover:text-fahh-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-fahh-accent">Retry</button>
        )}
      </p>
    </>
  );
}
