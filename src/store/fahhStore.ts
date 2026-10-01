import { create } from "zustand";
import { comboVoice, createFahhEngine, type FahhEvent } from "../lib/fahhEngine";
import { playChime, playFahh } from "../lib/fahh";

/**
 * The error HUD: live problem counts for the file on screen, the fahh combo,
 * the clean streak, and how loud the editor is allowed to be about it.
 *
 *   off     no sound, no effects (counts still show)
 *   subtle  the sound, a red edge glow and the status-bar flash
 *   epic    all of that plus the editor shake, the line pulse and the
 *           "FAHH ×n" chip (falls back to subtle under prefers-reduced-motion)
 */
export type Intensity = "off" | "subtle" | "epic";
export const INTENSITIES: readonly Intensity[] = ["off", "subtle", "epic"];

const INTENSITY_KEY = "fahh-intensity";
const MUTED_KEY = "fahh-muted";

function readIntensity(): Intensity {
  try {
    const v = localStorage.getItem(INTENSITY_KEY);
    if (v && (INTENSITIES as readonly string[]).includes(v)) return v as Intensity;
  } catch {
    // no storage (tests, locked-down WebView)
  }
  return "epic";
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

/** One visual beat for the effects layer to play; `seq` changes every time. */
export interface Impact {
  seq: number;
  kind: "fahh" | "clean";
  combo: number;
  /** 1-based line of the first error, for the line pulse. */
  line: number | null;
}

interface FahhStore {
  errors: number;
  warnings: number;
  /** fahhs this session */
  fahhCount: number;
  combo: number;
  /** When the last fahh landed, so the HUD can let the combo lapse. */
  lastFahhAt: number | null;
  cleanSince: number | null;
  intensity: Intensity;
  muted: boolean;
  impact: Impact | null;
  /** Settled counts for the file on screen. */
  report: (errors: number, warnings: number, firstErrorLine: number | null) => void;
  /** A different file is on screen: take its counts without a reaction. */
  rebase: (errors: number, warnings: number) => void;
  /** A build or language-server error arrived from the backend. */
  external: () => void;
  /** Ring it on purpose (the welcome screen, the command palette). */
  ringBell: () => void;
  setIntensity: (i: Intensity) => void;
  toggleMute: () => void;
}

const engine = createFahhEngine();
let seq = 0;

export const useFahhStore = create<FahhStore>((set, get) => {
  function react(event: FahhEvent, line: number | null): void {
    if (!event) return;
    const { intensity, muted } = get();
    if (event.type === "fahh") {
      if (intensity !== "off" && !muted) playFahh(comboVoice(event.combo));
      set((s) => ({
        fahhCount: s.fahhCount + 1,
        combo: event.combo,
        lastFahhAt: Date.now(),
        cleanSince: null,
        impact: intensity === "off" ? s.impact : { seq: ++seq, kind: "fahh", combo: event.combo, line },
      }));
    } else {
      if (intensity !== "off" && !muted) playChime();
      set((s) => ({
        combo: 0,
        cleanSince: event.streakStartedAt,
        impact: intensity === "off" ? s.impact : { seq: ++seq, kind: "clean", combo: 0, line: null },
      }));
    }
  }

  return {
    errors: 0,
    warnings: 0,
    fahhCount: 0,
    combo: 0,
    lastFahhAt: null,
    cleanSince: engine.cleanSince(),
    intensity: readIntensity(),
    muted: readMuted(),
    impact: null,

    report: (errors, warnings, firstErrorLine) => {
      set({ errors, warnings });
      react(engine.update(errors), firstErrorLine);
      if (errors > 0 && get().cleanSince !== null) set({ cleanSince: null });
    },
    rebase: (errors, warnings) => {
      engine.rebase(errors);
      set({ errors, warnings, cleanSince: engine.cleanSince() });
    },
    external: () => react(engine.external(), null),
    ringBell: () => {
      const combo = Math.max(1, engine.combo());
      if (get().intensity !== "off" && !get().muted) playFahh(comboVoice(combo));
      set((s) => ({ fahhCount: s.fahhCount + 1, lastFahhAt: Date.now(), impact: { seq: ++seq, kind: "fahh", combo, line: null } }));
    },
    setIntensity: (intensity) => {
      persist(INTENSITY_KEY, intensity);
      set({ intensity });
    },
    toggleMute: () => {
      const muted = !get().muted;
      persist(MUTED_KEY, muted ? "1" : "0");
      set({ muted });
    },
  };
});
