import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, Check, FolderOpen, History, FileJson, Volume2, VolumeX } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useFahhStore } from "../../store/fahhStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useThemeStore } from "../../store/themeStore";
import { useFileStore } from "../../store/fileStore";
import { useAgentStore } from "../../store/agentStore";
import { agentListModels, PROVIDER_PRESETS, toProviderConfig } from "../../lib/agent";
import { runCommand } from "../../lib/commands";
import { loadRecent } from "../../lib/recent";
import { moveView, revealView } from "../../lib/workbench";
import { openExternal } from "../../lib/browser";
import { UPDATES_URL, WELCOME_STEPS, syntaxError, type WelcomeStep } from "../../lib/welcome";
import { SoundPicker } from "../Fahh/SoundPicker";
import { SetupList, useSetupCheck } from "../Dialog/CheckSetupDialog";
import { THEME_DEFINITIONS } from "../ThemePanel";

const btn = "rounded px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-fahh-accent disabled:opacity-40";
const primary = `${btn} bg-fahh-accent text-fahh-bg hover:opacity-90`;
const secondary = `${btn} bg-fahh-surface text-fahh-text hover:bg-fahh-surface/70`;
const field = "w-full rounded border border-fahh-surface bg-fahh-sidebar px-2 py-1 text-xs text-fahh-text outline-none focus:border-fahh-accent";

// The three house themes; the rest are one click away in View > Colour Theme.
const THEMES = THEME_DEFINITIONS.filter((d) => ["fahh-gold", "fahh-dark", "fahh-light"].includes(d.id));

const isWindows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

/**
 * The first-run tour: five short steps over the real app, each one something to do
 * (ring the bell, open code, pick a look, connect Fahh Local, check your tools). Every
 * step can be skipped, and so can the whole tour. Help > Welcome brings it back.
 */
export function Welcome({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<Set<WelcomeStep>>(new Set());
  const mark = (s: WelcomeStep) => setDone((d) => (d.has(s) ? d : new Set(d).add(s)));
  const id = WELCOME_STEPS[step].id;
  const last = step === WELCOME_STEPS.length - 1;

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, onClose);

  // Left / Right move between steps when the focus is not in a field.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as Element).closest("input, select, textarea")) return;
    if (e.key === "ArrowRight" && !last) setStep(step + 1);
    else if (e.key === "ArrowLeft" && step > 0) setStep(step - 1);
  };

  return (
    // A light veil, so a theme picked here shows on the app behind it.
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/30 p-3" role="dialog" aria-modal="true" aria-labelledby="welcome-title" data-testid="welcome">
      <div
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="fahh-dialog flex max-h-[92vh] w-[560px] max-w-full flex-col rounded-lg border border-fahh-surface bg-fahh-bg text-fahh-text shadow-2xl outline-none"
      >
        {/* Progress: one dot per step, a tick once its action is done. */}
        <nav aria-label="Welcome steps" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-fahh-surface px-5 pt-4 pb-3">
          {WELCOME_STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStep(i)}
              aria-current={i === step ? "step" : undefined}
              aria-label={`Step ${i + 1}: ${s.label}${done.has(s.id) ? " (done)" : ""}`}
              className={`flex items-center gap-1.5 rounded px-1 text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-fahh-accent ${i === step ? "text-fahh-text" : "text-fahh-muted hover:text-fahh-text"}`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full border text-[9px] ${
                  done.has(s.id) ? "border-fahh-success bg-fahh-success text-fahh-bg" : i === step ? "border-fahh-accent text-fahh-accent" : "border-fahh-surface"
                }`}
                aria-hidden="true"
              >
                {done.has(s.id) ? <Check size={10} strokeWidth={3} /> : i + 1}
              </span>
              <span className="max-[520px]:hidden">{s.label}</span>
            </button>
          ))}
          <span className="ml-auto text-[11px] text-fahh-muted" data-testid="welcome-progress">
            {step + 1} of {WELCOME_STEPS.length}
          </span>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <h2 id="welcome-title" className="mb-1 text-lg font-semibold text-fahh-accent">{WELCOME_STEPS[step].title}</h2>
          {id === "sound" && <SoundStep onDone={() => mark("sound")} />}
          {id === "code" && <CodeStep onDone={() => mark("code")} />}
          {id === "look" && <LookStep onDone={() => mark("look")} />}
          {id === "agent" && <AgentStep onDone={() => mark("agent")} />}
          {id === "setup" && <SetupStep onDone={() => mark("setup")} onClose={onClose} />}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-fahh-surface px-5 py-3">
          <button type="button" onClick={onClose} className="rounded px-1 text-xs text-fahh-muted hover:text-fahh-text focus:outline-none focus-visible:ring-2 focus-visible:ring-fahh-accent">
            Skip tour
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} className={secondary}>Back</button>
            )}
            {last ? (
              <button type="button" onClick={onClose} className={primary}>Start coding</button>
            ) : (
              <button type="button" onClick={() => setStep(step + 1)} className={done.has(id) ? primary : secondary}>
                {done.has(id) ? "Next" : "Skip step"}
              </button>
            )}
          </div>
        </div>
        <p className="px-5 pb-3 text-[11px] text-fahh-muted">
          No account needed. Everything stays on your machine.{" "}
          <button type="button" onClick={() => void openExternal(UPDATES_URL)} className="underline hover:text-fahh-text">Get update emails</button>
        </p>
      </div>
    </div>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-sm leading-relaxed text-fahh-text">{children}</p>;
}

function Done({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;
  return (
    <p role="status" className="mt-3 flex items-center gap-1.5 text-xs text-fahh-success">
      <Check size={13} aria-hidden="true" /> {children}
    </p>
  );
}

// ─── 1. Sound ─────────────────────────────────────────────────────────────────

function SoundStep({ onDone }: { onDone: () => void }) {
  const ring = useFahhStore((s) => s.ringBell);
  const muted = useFahhStore((s) => s.muted);
  const toggleMute = useFahhStore((s) => s.toggleMute);
  const fahhs = useFahhStore((s) => s.fahhCount);
  const volume = useSettingsStore((s) => s.fahhVolume);
  const set = useSettingsStore((s) => s.set);
  const [rang, setRang] = useState(false);
  return (
    <>
      <Lead>When your code breaks, Fahh plays a sound and shakes the screen. Hear it now, before your first bug does.</Lead>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={`${primary} flex items-center gap-1.5`} onClick={() => { ring(); setRang(true); onDone(); }}>
          <Bell size={13} aria-hidden="true" /> Ring the bell
        </button>
        <label className="flex items-center gap-2 text-xs text-fahh-muted">
          Volume
          <input type="range" min={0} max={100} value={volume} onChange={(e) => set("fahhVolume", Number(e.target.value))} className="w-28 accent-[var(--fahh-accent)]" aria-label="Fahh volume" />
          <span className="w-7 tabular-nums text-fahh-text">{volume}</span>
        </label>
        <button type="button" className={`${secondary} flex items-center gap-1`} onClick={toggleMute} aria-pressed={muted}>
          {muted ? <VolumeX size={13} aria-hidden="true" /> : <Volume2 size={13} aria-hidden="true" />} {muted ? "Unmute" : "Mute"}
        </button>
      </div>
      <Done show={rang}>{muted ? "Rang, silently: sound is muted." : `Fahh! (${fahhs} this session)`}</Done>

      <h3 className="mt-5 mb-1.5 text-xs font-semibold text-fahh-text">Want your own error sound?</h3>
      <SoundPicker onChange={onDone} />
    </>
  );
}

// ─── 2. Code ──────────────────────────────────────────────────────────────────

function CodeStep({ onDone }: { onDone: () => void }) {
  const root = useFileStore((s) => s.root);
  const recent = loadRecent().slice(0, 3);
  const [code, setCode] = useState('const greeting = "hello";');
  const err = syntaxError(code);
  const wasBroken = useRef(false);
  useEffect(() => {
    if (root) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);
  // Breaking the line rings the real fahh, once per break.
  useEffect(() => {
    if (err && !wasBroken.current) {
      useFahhStore.getState().ringBell();
      onDone();
    }
    wasBroken.current = !!err;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [err]);
  return (
    <>
      <Lead>Open a project. Files, git, the terminal and Run all follow that folder.</Lead>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${primary} flex items-center gap-1.5`} onClick={() => runCommand("folder.open")}>
          <FolderOpen size={13} aria-hidden="true" /> Open Folder…
        </button>
        <button type="button" className={`${secondary} flex items-center gap-1.5`} onClick={() => runCommand("workspace.open")} title="A VS Code .code-workspace or a .fahh-workspace file">
          <FileJson size={13} aria-hidden="true" /> Open a .code-workspace…
        </button>
      </div>
      {recent.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-1 text-[11px] text-fahh-muted"><History size={11} aria-hidden="true" /> Open Recent</div>
          <ul className="space-y-0.5">
            {recent.map((r, i) => (
              <li key={r.path}>
                <button type="button" onClick={() => runCommand(`file.recent.${i}`)} className="w-full truncate rounded px-2 py-1 text-left font-mono text-[11px] text-fahh-text hover:bg-fahh-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-fahh-accent" title={r.path}>
                  {r.path}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {isWindows && (
        <p className="mt-3 text-[11px] text-fahh-muted">
          WSL folders work too: open <span className="font-mono">\\wsl.localhost\Ubuntu\home\you\project</span> and the terminal, git and Run go through WSL.
        </p>
      )}
      <Done show={!!root}>Opened {root?.split(/[\\/]/).filter(Boolean).pop()}.</Done>

      <h3 className="mt-5 mb-1 text-xs font-semibold text-fahh-text">Or try it here: break this line</h3>
      <p className="mb-1.5 text-[11px] text-fahh-muted">Delete the closing quote, say. A real JavaScript parser checks it as you type.</p>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        aria-label="Try-it line of JavaScript"
        aria-invalid={!!err}
        className={`${field} font-mono ${err ? "border-fahh-error" : ""}`}
        data-testid="welcome-sandbox"
      />
      <p className={`mt-1 text-[11px] ${err ? "text-fahh-error" : "text-fahh-success"}`} role="status">
        {err ? `${err} (fahh!) Fix it to make it quiet again.` : "Valid. Now break it."}
      </p>
    </>
  );
}

// ─── 3. Look and layout ───────────────────────────────────────────────────────

function LookStep({ onDone }: { onDone: () => void }) {
  const { activeTheme, setTheme } = useThemeStore();
  const [moved, setMoved] = useState(false);
  const move = () => {
    moveView("explorer", moved ? "primary" : "secondary");
    setMoved(!moved);
    onDone();
  };
  return (
    <>
      <Lead>Pick a look. The editor behind this card changes as you click.</Lead>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={activeTheme === t.id}
            onClick={() => { setTheme(t.id); onDone(); }}
            className={`flex items-center gap-2 rounded border px-3 py-1.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-fahh-accent ${activeTheme === t.id ? "border-fahh-accent text-fahh-text" : "border-fahh-surface text-fahh-muted hover:text-fahh-text"}`}
          >
            <span className="flex h-4 w-6 overflow-hidden rounded-sm border border-fahh-surface" aria-hidden="true">
              <span className="flex-1" style={{ background: t.swatches[0] }} />
              <span className="w-2" style={{ background: t.swatches[3] }} />
            </span>
            {t.name}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-fahh-muted">More themes: View &gt; Colour Theme.</p>

      <h3 className="mt-5 mb-1 text-xs font-semibold text-fahh-text">Make the layout yours</h3>
      <p className="mb-2 text-[11px] text-fahh-muted">Drag any tab or view anywhere: side bars, the panel, beside your code. View &gt; Reset Layout puts everything back.</p>
      <button type="button" className={secondary} onClick={move} data-testid="welcome-move-explorer">
        {moved ? "Put Explorer back on the left" : "Move Explorer to the right"}
      </button>
    </>
  );
}

// ─── 4. Fahh Local (optional) ─────────────────────────────────────────────────

function AgentStep({ onDone }: { onDone: () => void }) {
  const settings = useAgentStore((s) => s.settings);
  const update = useAgentStore((s) => s.updateSettings);
  const preset = PROVIDER_PRESETS.find((p) => p.id === settings.provider);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const pick = (id: string) => {
    const p = PROVIDER_PRESETS.find((x) => x.id === id);
    if (p) update({ provider: id, baseUrl: p.baseUrl || settings.baseUrl, model: p.defaultModel, fastModel: "" });
    setResult(null);
  };
  const test = async () => {
    setTesting(true);
    try {
      const models = await agentListModels(toProviderConfig(settings));
      setResult({ ok: true, text: models.length ? `Connected: ${models.length} models (e.g. ${models.slice(0, 2).join(", ")}).` : "Connected, but the provider listed no models." });
      onDone();
    } catch (e) {
      setResult({ ok: false, text: `Could not connect: ${e instanceof Error ? e.message : String(e)}` });
    }
    setTesting(false);
  };
  return (
    <>
      <Lead>Fahh Local is the built-in coding agent. It is optional: everything else works without it. Bring your own key, or use Ollama on this machine.</Lead>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-[11px] text-fahh-muted">
          Provider
          <select value={settings.provider} onChange={(e) => pick(e.target.value)} className={`${field} mt-0.5`}>
            {PROVIDER_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="block text-[11px] text-fahh-muted">
          API key {preset && !preset.needsKey && "(not needed)"}
          <input type="password" value={settings.apiKey} onChange={(e) => { update({ apiKey: e.target.value }); setResult(null); }} disabled={!!preset && !preset.needsKey} placeholder={preset?.needsKey ? "paste your key" : "none"} spellCheck={false} className={`${field} mt-0.5`} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={primary} onClick={() => void test()} disabled={testing}>{testing ? "Testing…" : "Test connection"}</button>
        <button type="button" className={secondary} onClick={() => revealView("agent")}>Open Fahh Local</button>
      </div>
      {result && <p role="status" className={`mt-2 break-words text-xs ${result.ok ? "text-fahh-success" : "text-fahh-error"}`} data-testid="agent-test">{result.text}</p>}
      <p className="mt-3 text-[11px] text-fahh-muted">The key stays in this machine&apos;s storage and goes only to the provider you pick. Ctrl+L opens the agent any time.</p>
    </>
  );
}

// ─── 5. Check setup and updates ───────────────────────────────────────────────

function SetupStep({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const { st, run } = useSetupCheck(() => onDone());
  const auto = useSettingsStore((s) => s.checkUpdatesOnLaunch);
  const set = useSettingsStore((s) => s.set);
  return (
    <>
      <Lead>Fahh is checking the tools it can use. Missing ones only switch off the feature that needs them.</Lead>
      <div className="rounded border border-fahh-surface bg-fahh-sidebar p-3">
        <SetupList st={st} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={secondary} onClick={() => void run()} disabled={st.k === "checking"}>Check again</button>
      </div>
      <p className="mt-1 text-[11px] text-fahh-muted">Run it again later from Help &gt; Check Setup.</p>

      <h3 className="mt-5 mb-1.5 text-xs font-semibold text-fahh-text">Updates</h3>
      <label className="flex items-center gap-2 text-xs text-fahh-text">
        <input type="checkbox" checked={auto} onChange={(e) => set("checkUpdatesOnLaunch", e.target.checked)} className="h-4 w-4 shrink-0 accent-[var(--fahh-accent)]" />
        Look for a new version when Fahh starts (once a day, a small note, never a popup)
      </label>
      <button type="button" className={`${secondary} mt-2`} onClick={() => { onClose(); runCommand("help.about"); }}>Check for updates now</button>
      <p className="mt-3 text-[11px] text-fahh-muted">See this tour again from Help &gt; Welcome.</p>
    </>
  );
}
