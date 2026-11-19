import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowUpCircle, Braces, CircleX, Sparkles, TriangleAlert, Volume2, VolumeX, Zap } from "lucide-react";
import { pendingUpdate, UPDATE_DISMISSED_KEY, UPDATE_EVENT, type UpdateCheck } from "../../lib/updates";
import { openExternal } from "../../lib/browser";
import { useEditorStore } from "../../store/editorStore";
import { useLspStore } from "../../store/lspStore";
import { useFahhStore, INTENSITIES } from "../../store/fahhStore";
import { problemCounts, useDiagnosticsStore } from "../../store/diagnosticsStore";
import { useFileStore } from "../../store/fileStore";
import { DEFAULT_COMBO_WINDOW_MS, formatStreak } from "../../lib/fahhEngine";
import { runEditorAction } from "../../lib/monacoBridge";

/** Left of the status bar: problems in this file, the clean streak, the combo. */
export function StatusHud() {
  const { errors: hudErrors, warnings: hudWarnings, combo, lastFahhAt, cleanSince, impact } = useFahhStore();
  const activeTab = useEditorStore((s) => s.activeTab);
  const root = useFileStore((s) => s.root);
  const diagnostics = useDiagnosticsStore((s) => s.diagnostics);
  // The same rows the Problems panel shows, for the file on screen; the HUD's own
  // (debounced, per-editor) count only for a file outside the open folder.
  const listed = problemCounts(diagnostics, activeTab, root);
  const errors = !activeTab ? 0 : listed ? listed.errors : hudErrors;
  const warnings = !activeTab ? 0 : listed ? listed.warnings : hudWarnings;
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
  const { intensity, muted, fahhCount, lifetime, setIntensity, toggleMute } = useFahhStore();
  const next = INTENSITIES[(INTENSITIES.indexOf(intensity) + 1) % INTENSITIES.length];
  return (
    <>
      {fahhCount > 0 && (
        <span className="tabular-nums" title={`Fahhs this session. ${lifetime} in all.`}>
          {fahhCount} fahh{fahhCount === 1 ? "" : "s"}
        </span>
      )}
      <button
        type="button"
        onClick={() => setIntensity(next)}
        title={`What happens when your code breaks. ${intensity === "epic" ? "Epic: the fahh sound, a shake, a line pulse and a glow" : intensity === "subtle" ? "Subtle: the fahh sound and a soft glow" : "Off: no visual effects"}. Click for ${next}.`}
        aria-label={`Effects intensity ${intensity}. Switch to ${next}`}
        className={`flex items-center gap-1 transition-colors hover:text-fahh-text ${intensity === "epic" ? "text-fahh-accent" : ""}`}
      >
        <Zap size={12} aria-hidden="true" />
        {intensity === "off" ? "Effects off" : intensity === "subtle" ? "Subtle effects" : "Epic effects"}
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

function readPending(): UpdateCheck | null {
  try {
    return pendingUpdate(localStorage, __APP_VERSION__);
  } catch {
    return null;
  }
}

/** A gold "Update" button in the status bar, only while a newer release exists; its card has the download. */
export function UpdatePill() {
  const [r, setR] = useState<UpdateCheck | null>(readPending);
  const [open, setOpen] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const on = () => setR(readPending());
    window.addEventListener(UPDATE_EVENT, on);
    return () => window.removeEventListener(UPDATE_EVENT, on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!r) return null;
  const later = () => {
    try {
      localStorage.setItem(UPDATE_DISMISSED_KEY, r.latest);
    } catch {
      /* storage blocked: hidden for this session only */
    }
    setOpen(false);
    setR(null);
  };
  const btn = "rounded-md px-2.5 py-1 text-[11.5px]";
  return (
    <span className="relative">
      <button
        type="button"
        ref={pillRef}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`Fahh ${r.latest} is out`}
        className="fahh-primary flex items-center gap-1 rounded-full bg-fahh-accent px-2 py-px text-[11px] font-semibold text-fahh-bg hover:opacity-90"
        data-testid="update-pill"
      >
        <ArrowUpCircle size={12} aria-hidden="true" />
        Update to v{r.latest}
      </button>
      {open && createPortal(
        // On <body>: the dock is its own stacking context and would cover a card drawn inside the status bar.
        <div
          role="dialog"
          aria-label={`Fahh ${r.latest}`}
          className="fahh-pop fixed z-[1000] w-80 rounded-lg border border-fahh-surface bg-fahh-sidebar p-3 text-left shadow-xl"
          style={cardPos(pillRef.current)}
        >
          <p className="text-[13px] font-semibold text-fahh-text">Fahh {r.latest} is out</p>
          <p className="mt-1 text-[11.5px] leading-snug text-fahh-muted">
            You have v{__APP_VERSION__}. {r.download ? "Download the installer and run it" : "Get it from the release page"}; your files and settings stay as they are.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button type="button" autoFocus onClick={() => void openExternal(r.download ?? r.url)} className={`${btn} fahh-primary bg-fahh-accent font-semibold text-fahh-bg hover:opacity-90`}>
              Download update
            </button>
            <button type="button" onClick={() => void openExternal(r.url)} className={`${btn} border border-fahh-surface text-fahh-text hover:bg-fahh-surface`}>
              What's new
            </button>
            <button type="button" onClick={later} className={`${btn} text-fahh-muted hover:text-fahh-text`}>
              Later
            </button>
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}

/** Above the pill, its right edge lined up with the pill, kept inside the window. */
function cardPos(el: HTMLElement | null): CSSProperties {
  if (!el) return { right: 8, bottom: 32 };
  const r = el.getBoundingClientRect();
  return { right: Math.max(8, window.innerWidth - r.right), bottom: window.innerHeight - r.top + 8 };
}
