import { listen } from "@tauri-apps/api/event";
import { resolveResource } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";

let audioCtx: AudioContext | null = null;
let audioBuffer: AudioBuffer | null = null;
let unlisten: (() => void) | null = null;

async function loadAudio(): Promise<void> {
  audioCtx = new AudioContext();
  try {
    const resourcePath = await resolveResource("assets/fahh.mp3");
    const assetUrl = convertFileSrc(resourcePath);
    const response = await fetch(assetUrl);
    if (!response.ok) throw new Error("asset not found");
    const arrayBuffer = await response.arrayBuffer();
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch (err) {
    console.warn("Failed to load fahh sfx:", err);
    audioBuffer = null;
  }
}

function playFahh(): void {
  if (!audioCtx || !audioBuffer) return;
  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioCtx.destination);
  source.start(0);
}

export async function initFahhSfx(): Promise<void> {
  await loadAudio();

  unlisten = await listen("fahh://error", () => {
    playFahh();
  });
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
