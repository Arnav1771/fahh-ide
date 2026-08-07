/**
 * The rule that makes the Fahh SFX bearable: at most one play per cooldown
 * window, no queueing. A cascade of 40 diagnostics from one bad import must
 * produce exactly one sound, not forty.
 *
 * The Rust side enforces the same rule in `core/error_detector.rs` (it owns
 * the `fahh://error` emit). This is the front-end guard for error sources
 * that never round-trip through Rust — the in-editor LSP diagnostics path
 * dispatches locally, so without this the sound would fire per notification.
 *
 * The clock is injectable so the behaviour is testable without timers.
 */

/** The product's documented default, in milliseconds. */
export const DEFAULT_COOLDOWN_MS = 3000;

export interface Cooldown {
  /**
   * Consumes the cooldown. Returns `true` if the caller should fire, and in
   * that case starts a new cooldown window. Returns `false` while cooling
   * down, without extending the window.
   */
  tryTrigger(): boolean;
  /** Milliseconds until `tryTrigger()` would return `true` again. */
  remainingMs(): number;
  /** Forget the last trigger — the next call fires immediately. */
  reset(): void;
}

export interface CooldownOptions {
  /** Monotonic-ish clock in milliseconds. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * `cooldownMs <= 0` disables throttling entirely (every call fires), which is
 * what a user gets by setting `sfx_cooldown_secs: 0` in `~/.fahh/config.json`.
 * A negative or non-finite value is treated as 0 rather than throwing.
 */
export function createCooldown(
  cooldownMs: number = DEFAULT_COOLDOWN_MS,
  options: CooldownOptions = {}
): Cooldown {
  const now = options.now ?? (() => Date.now());
  const window = Number.isFinite(cooldownMs) && cooldownMs > 0 ? cooldownMs : 0;

  // `null` means "never triggered", which is distinct from "triggered at 0".
  let lastTrigger: number | null = null;

  return {
    tryTrigger(): boolean {
      const t = now();
      if (window === 0) {
        lastTrigger = t;
        return true;
      }
      if (lastTrigger !== null && t - lastTrigger < window) {
        return false;
      }
      lastTrigger = t;
      return true;
    },

    remainingMs(): number {
      if (window === 0 || lastTrigger === null) return 0;
      const elapsed = now() - lastTrigger;
      return elapsed >= window ? 0 : window - elapsed;
    },

    reset(): void {
      lastTrigger = null;
    },
  };
}

/** Convert the config's `sfx_cooldown_secs` into milliseconds, safely. */
export function cooldownMsFromSecs(secs: number | undefined | null): number {
  if (secs === undefined || secs === null || !Number.isFinite(secs) || secs < 0) {
    return DEFAULT_COOLDOWN_MS;
  }
  return Math.round(secs * 1000);
}
