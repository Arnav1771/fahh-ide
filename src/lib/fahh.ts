import { listen } from "@tauri-apps/api/event";
import { resolveResource } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";
// The same file, bundled by Vite: used when the Tauri resource is unavailable
// (the browser preview, or a resource lookup that fails), so the bell still rings.
import bundledFahhUrl from "../../src-tauri/assets/fahh.mp3?url";

let audioCtx: AudioContext | null = null;
let audioBuffer: AudioBuffer | null = null;
let unlisten: (() => void) | null = null;

async function decode(url: string): Promise<AudioBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fahh sfx not found at ${url}`);
  return await audioCtx!.decodeAudioData(await response.arrayBuffer());
}

async function loadAudio(): Promise<void> {
  audioCtx = new AudioContext();
  try {
    const resourcePath = await resolveResource("assets/fahh.mp3");
    audioBuffer = await decode(convertFileSrc(resourcePath));
  } catch {
    try {
      audioBuffer = await decode(bundledFahhUrl);
    } catch (err) {
      console.warn("Failed to load fahh sfx:", err);
      audioBuffer = null;
    }
  }
}

/** Browsers start an AudioContext suspended until the user has interacted. */
function ready(): AudioContext | null {
  if (!audioCtx) return null;
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

/**
 * Play the fahh. `gain` and `rate` come from the combo (see comboVoice):
 * repeat offences sound heavier.
 */
export function playFahh(voice: { gain: number; rate: number } = { gain: 1, rate: 1 }): void {
  const ctx = ready();
  if (!ctx || !audioBuffer) return;
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.playbackRate.value = voice.rate;
  const gain = ctx.createGain();
  gain.gain.value = voice.gain;
  source.connect(gain).connect(ctx.destination);
  source.start(0);
}

/** The redemption cue: a soft two-note bell, synthesized so it needs no asset. */
export function playChime(): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  [
    [1318.5, 0],
    [1975.5, 0.09],
  ].forEach(([freq, delay]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t + delay);
    gain.gain.linearRampToValueAtTime(0.12, t + delay + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.7);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t + delay);
    osc.stop(t + delay + 0.75);
  });
}

/**
 * Load the sound and listen for `fahh://error`, which the Rust side emits for
 * build and language-server errors. `onError` decides what happens (the HUD
 * store applies the cooldown, combo and mute, then calls playFahh).
 */
export async function initFahhSfx(onError: () => void = () => playFahh()): Promise<void> {
  await loadAudio();
  try {
    unlisten = await listen("fahh://error", () => onError());
  } catch {
    // Not running inside Tauri (browser preview): there is no backend to listen to.
    unlisten = null;
  }
}

export function teardownFahhSfx(): void {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
}
