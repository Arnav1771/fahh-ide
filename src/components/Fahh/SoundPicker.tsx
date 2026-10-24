import { useState } from "react";
import { Play } from "lucide-react";
import { useSettingsStore } from "../../store/settingsStore";
import { useFahhStore } from "../../store/fahhStore";
import { previewSound, soundDeps } from "../../lib/fahh";
import { chooseSound, resetSound } from "../../lib/sound";

const btn = "rounded bg-fahh-surface px-2.5 py-1 text-xs text-fahh-text hover:bg-fahh-surface/70 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-fahh-accent";

/**
 * The error sound: the default fahh or a file of your own, each with a preview.
 * Used by Settings > Fahh and the welcome tour. `onChange` hears every real change.
 */
export function SoundPicker({ onChange }: { onChange?: (what: "preview" | "custom" | "default") => void }) {
  const name = useSettingsStore((s) => s.fahhSound);
  const muted = useFahhStore((s) => s.muted);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  const preview = (which: "default" | "custom") => {
    if (muted) return setMsg({ text: "Sound is muted. Unmute to hear it.", error: true });
    previewSound(which);
    onChange?.("preview");
  };
  const change = async () => {
    setBusy(true);
    const r = await chooseSound(soundDeps);
    setBusy(false);
    if (!r) return;
    if (r.ok) {
      setMsg({ text: `Using ${r.name}. Every fahh plays it now.`, error: false });
      if (!muted) previewSound("custom");
      onChange?.("custom");
    } else setMsg({ text: r.error, error: true });
  };
  const reset = async () => {
    await resetSound(soundDeps);
    setMsg({ text: "Back to the default fahh.", error: false });
    onChange?.("default");
  };

  return (
    <div className="space-y-1.5 text-xs" data-testid="sound-picker">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-fahh-text">
          Now: <span className="font-medium text-fahh-accent" data-testid="sound-name">{name || "Default fahh"}</span>
        </span>
        <button type="button" className={btn} onClick={() => preview("default")} aria-label="Preview the default fahh">
          <Play size={11} className="mr-1 inline" aria-hidden="true" />Default
        </button>
        {name && (
          <button type="button" className={btn} onClick={() => preview("custom")} aria-label={`Preview ${name}`}>
            <Play size={11} className="mr-1 inline" aria-hidden="true" />Yours
          </button>
        )}
        <button type="button" className={btn} onClick={() => void change()} disabled={busy}>
          {busy ? "Checking…" : "Change sound…"}
        </button>
        {name && (
          <button type="button" className={btn} onClick={() => void reset()}>
            Reset to default
          </button>
        )}
      </div>
      <p className="text-[11px] text-fahh-muted">mp3, wav, ogg or m4a, up to 5 MB. Fahh keeps its own copy.</p>
      {msg && (
        <p role="status" className={`text-[11px] ${msg.error ? "text-fahh-error" : "text-fahh-success"}`} data-testid="sound-msg">
          {msg.text}
        </p>
      )}
    </div>
  );
}
