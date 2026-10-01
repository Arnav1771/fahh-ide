/**
 * When the editor should go "fahh" and when it has earned a "clean".
 *
 * The rule follows VS Code's accessibility signals: react to *transitions*,
 * never to every diagnostics update. The caller feeds in the active file's
 * error count once the markers have settled; the engine answers with at most
 * one event:
 *
 *   - "fahh"  the error count went up (and the cooldown allows a play).
 *             `combo` counts fahhs that land within `comboWindowMs` of each
 *             other, Power Mode style, so the HUD can escalate.
 *   - "clean" the count dropped from something to zero: the redemption cue.
 *
 * Switching files is not a transition: `rebase()` records the new file's
 * count without firing, so opening a broken file does not shout at you and
 * leaving one does not award a fake "clean".
 *
 * Free of React, Monaco and timers (the clock is injectable) so it can be
 * unit-tested in plain Node.
 */

import { createCooldown, DEFAULT_COOLDOWN_MS, type Cooldown } from "./cooldown";

export const DEFAULT_COMBO_WINDOW_MS = 12_000;

export type FahhEvent =
  | { type: "fahh"; errors: number; combo: number }
  | { type: "clean"; streakStartedAt: number }
  | null;

export interface FahhEngineOptions {
  cooldownMs?: number;
  comboWindowMs?: number;
  now?: () => number;
}

export interface FahhEngine {
  /** Feed the settled error count for the file on screen. */
  update(errors: number): FahhEvent;
  /** A new file is on screen: adopt its count silently. */
  rebase(errors: number): void;
  /** Something outside the editor failed (a build, a run): fahh if allowed. */
  external(): FahhEvent;
  /** Current combo (0 when it has lapsed). */
  combo(): number;
  /** When the current error-free stretch began, or null while there are errors. */
  cleanSince(): number | null;
}

export function createFahhEngine(options: FahhEngineOptions = {}): FahhEngine {
  const now = options.now ?? (() => Date.now());
  const comboWindow = options.comboWindowMs ?? DEFAULT_COMBO_WINDOW_MS;
  const cooldown: Cooldown = createCooldown(options.cooldownMs ?? DEFAULT_COOLDOWN_MS, { now });

  let errors = 0;
  let comboCount = 0;
  let lastFahhAt: number | null = null;
  let clean: number | null = now();

  function fire(count: number): FahhEvent {
    if (!cooldown.tryTrigger()) return null;
    const t = now();
    comboCount = lastFahhAt !== null && t - lastFahhAt <= comboWindow ? comboCount + 1 : 1;
    lastFahhAt = t;
    return { type: "fahh", errors: count, combo: comboCount };
  }

  return {
    update(next) {
      const count = Math.max(0, Math.floor(next) || 0);
      const prev = errors;
      errors = count;
      if (count > prev) {
        clean = null;
        return fire(count);
      }
      if (count === 0 && prev > 0) {
        const started = now();
        clean = started;
        comboCount = 0;
        return { type: "clean", streakStartedAt: started };
      }
      return null;
    },
    rebase(next) {
      errors = Math.max(0, Math.floor(next) || 0);
      if (errors > 0) clean = null;
      else if (clean === null) clean = now();
    },
    external() {
      clean = null;
      return fire(errors);
    },
    combo() {
      if (lastFahhAt === null || now() - lastFahhAt > comboWindow) return 0;
      return comboCount;
    },
    cleanSince() {
      return clean;
    },
  };
}

/** "4s", "12m", "3h 05m": how long the clean streak has lasted. */
export function formatStreak(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Bigger combos sound heavier: a little louder and a little lower, capped. */
export function comboVoice(combo: number): { gain: number; rate: number } {
  const step = Math.min(Math.max(combo, 1) - 1, 5);
  return { gain: 1 + step * 0.12, rate: 1 - step * 0.04 };
}
