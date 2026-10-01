import { useEffect, useState } from "react";
import { Braces, CircleX, Sparkles, TriangleAlert, Volume2, VolumeX, Zap } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { useLspStore } from "../../store/lspStore";
import { useFahhStore, INTENSITIES } from "../../store/fahhStore";
import { DEFAULT_COMBO_WINDOW_MS, formatStreak } from "../../lib/fahhEngine";
import { runEditorAction } from "../../lib/monacoBridge";

/** Left of the status bar: problems in this file, the clean streak, the combo. */
export function StatusHud() {
  const { errors, warnings, combo, lastFahhAt, cleanSince, impact } = useFahhStore();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const flash = impact?.kind === "fahh" ? impact.seq : 0;
  const comboLive = combo >= 2 && lastFahhAt !== null && now - lastFahhAt < DEFAULT_COMBO_WINDOW_MS;
  const label = `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"} in this file`;

  return (
    <>
      <button
        type="button"
        onClick={() => runEditorAction("editor.action.marker.next")}
        title={`${label}. Go to the next problem (F8)`}
        aria-label={`${label}. Go to the next problem`}
        className="fahh-hud-problems flex items-center gap-2 hover:text-fahh-text transition-colors"
      >
        <span key={flash} className={`flex items-center gap-1 tabular-nums ${errors ? "text-fahh-error" : ""} ${flash ? "fahh-flash" : ""}`}>
          <CircleX size={12} aria-hidden="true" />
          {errors}
        </span>
        <span className={`flex items-center gap-1 tabular-nums ${warnings ? "text-fahh-warn" : ""}`}>
          <TriangleAlert size={12} aria-hidden="true" />
          {warnings}
        </span>
      </button>

      {errors === 0 && cleanSince !== null && (
        <span className="flex items-center gap-1 text-fahh-success tabular-nums" title="Time since your last error">
          <Sparkles size={12} aria-hidden="true" />
          clean {formatStreak(now - cleanSince)}
        </span>
      )}

      {comboLive && (
        <span key={`combo${combo}`} className="fahh-combo" title="Errors in a row">
          FAHH ×{combo}
        </span>
      )}

      <span className="sr-only" aria-live="polite">
        {label}
      </span>
    </>
  );
}

/**
 * The language server for the file on screen, like VS Code's language status
 * item: "rust …" while it starts, "rust ✓" when it is up, "rust ✕" (hover for
 * why) when it could not start or died.
 */
export function LspStatusItem() {
  const language = useEditorStore((s) => s.openTabs.find((t) => t.path === s.activeTab)?.language ?? null);
  const status = useLspStore((s) => (language ? s.servers[language] : undefined));
  if (!language || !status) return null;
  const mark = status.state === "ready" ? "✓" : status.state === "starting" ? "…" : "✕";
  const title =
    status.state === "ready"
      ? `${language} language server is running (${status.detail ?? ""})`
      : status.state === "starting"
        ? `Starting the ${language} language server…`
        : `No ${language} language server: ${status.detail ?? "it could not start"}`;
  return (
    <span
      className={`fahh-lsp-status flex items-center gap-1 ${status.state === "failed" ? "text-fahh-warn" : ""}`}
      title={title}
      data-state={status.state}
    >
      <Braces size={12} aria-hidden="true" />
      {language} {mark}
    </span>
  );
}

/** Right of the status bar: how loud the editor is allowed to be. */
export function HudControls() {
  const { intensity, muted, fahhCount, setIntensity, toggleMute } = useFahhStore();
  const next = INTENSITIES[(INTENSITIES.indexOf(intensity) + 1) % INTENSITIES.length];
  return (
    <>
      {fahhCount > 0 && (
        <span className="tabular-nums" title="Fahhs this session">
          {fahhCount} fahh{fahhCount === 1 ? "" : "s"}
        </span>
      )}
      <button
        type="button"
        onClick={() => setIntensity(next)}
        title={`Effects: ${intensity}. Click for ${next}.`}
        aria-label={`Effects intensity ${intensity}. Switch to ${next}`}
        className={`flex items-center gap-1 transition-colors hover:text-fahh-text ${intensity === "epic" ? "text-fahh-accent" : ""}`}
      >
        <Zap size={12} aria-hidden="true" />
        {intensity}
      </button>
      <button
        type="button"
        onClick={toggleMute}
        title={muted ? "Sound is off. Click to unmute." : "Sound is on. Click to mute."}
        aria-label={muted ? "Unmute the fahh" : "Mute the fahh"}
        aria-pressed={muted}
        className="flex items-center transition-colors hover:text-fahh-text"
      >
        {muted ? <VolumeX size={13} aria-hidden="true" /> : <Volume2 size={13} aria-hidden="true" />}
      </button>
    </>
  );
}

/** A gold light sweeping along the status bar when the last error is fixed. */
export function CleanSweep() {
  const impact = useFahhStore((s) => s.impact);
  const intensity = useFahhStore((s) => s.intensity);
  if (!impact || impact.kind !== "clean" || intensity === "off") return null;
  return <span key={impact.seq} className="fahh-sweep" aria-hidden="true" />;
}
