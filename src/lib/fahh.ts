import { listen } from "@tauri-apps/api/event";
import { resolveResource } from "@tauri-apps/api/path";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
// The same file, bundled by Vite: used when the Tauri resource is unavailable
// (the browser preview, or a resource lookup that fails), so the bell still rings.
import bundledFahhUrl from "../../src-tauri/assets/fahh.mp3?url";
import { useSettingsStore } from "../store/settingsStore";
import { SOUND_EXTENSIONS, type SoundDeps } from "./sound";

/** Settings > Fahh > Volume, 0 to 1. */
const volume = () => useSettingsStore.getState().fahhVolume / 100;

let audioCtx: AudioContext | null = null;
let audioBuffer: AudioBuffer | null = null;
/** The user's own error sound (Settings > Fahh > Error sound), when one is set. */
let customBuffer: AudioBuffer | null = null;
let unlisten: (() => void) | null = null;
let unsubscribeSettings: (() => void) | null = null;

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

/** Decode the stored custom sound (core/setup.rs keeps a copy); false when it cannot be played. */
export async function loadCustomSound(): Promise<boolean> {
  customBuffer = null;
  if (!audioCtx) return false;
  try {
    const bytes = await invoke<ArrayBuffer>("load_custom_sound");
    customBuffer = await audioCtx.decodeAudioData(bytes);
    return true;
  } catch (err) {
    console.warn("custom fahh sound unavailable:", err);
    return false;
  }
}

/** Change sound… in Settings and the welcome tour, wired to the backend. */
export const soundDeps: SoundDeps = {
  pick: async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ multiple: false, directory: false, filters: [{ name: "Audio", extensions: SOUND_EXTENSIONS }] });
    return typeof r === "string" ? r : null;
  },
  store: (path) => invoke<string>("set_custom_sound", { path }),
  load: loadCustomSound,
  clear: async () => {
    customBuffer = null;
    await invoke("clear_custom_sound");
  },
  setName: (name) => useSettingsStore.getState().set("fahhSound", name),
};

/** Browsers start an AudioContext suspended until the user has interacted. */
function ready(): AudioContext | null {
  if (!audioCtx) return null;
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

function play(buffer: AudioBuffer | null, voice: { gain: number; rate: number }): void {
  if (volume() === 0) return;
  const ctx = ready();
  if (!ctx || !buffer) return;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = voice.rate;
  const gain = ctx.createGain();
  gain.gain.value = voice.gain * volume();
  source.connect(gain).connect(ctx.destination);
  source.start(0);
}

/**
 * Play the fahh: the user's own sound when one is set. `gain` and `rate` come from the
 * combo (see comboVoice): repeat offences sound heavier.
 */
export function playFahh(voice: { gain: number; rate: number } = { gain: 1, rate: 1 }): void {
  play(customBuffer ?? audioBuffer, voice);
}

/** Preview one of the two sounds at the Settings volume (callers check mute). */
export function previewSound(which: "default" | "custom"): void {
  play(which === "custom" ? customBuffer : audioBuffer, { gain: 1, rate: 1 });
}

/** The redemption cue: a soft two-note bell, synthesized so it needs no asset. */
export function playChime(): void {
  if (volume() === 0) return;
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
    gain.gain.linearRampToValueAtTime(Math.max(0.0002, 0.12 * volume()), t + delay + 0.012);
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
  if (useSettingsStore.getState().fahhSound) await loadCustomSound();
  // Settings > Reset to defaults drops the custom sound too.
  unsubscribeSettings = useSettingsStore.subscribe((s, prev) => {
    if (!s.fahhSound && prev.fahhSound) customBuffer = null;
  });
  try {
    unlisten = await listen("fahh://error", () => onError());
  } catch {
    // Not running inside Tauri (browser preview): there is no backend to listen to.
    unlisten = null;
  }
}

export function teardownFahhSfx(): void {
  unsubscribeSettings?.();
  unsubscribeSettings = null;
  customBuffer = null;
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
}
