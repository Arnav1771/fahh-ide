import { listen } from "@tauri-apps/api/event";

let audioCtx: AudioContext | null = null;
let audioBuffer: AudioBuffer | null = null;
let unlisten: (() => void) | null = null;

async function loadAudio(): Promise<void> {
  audioCtx = new AudioContext();
  try {
    const response = await fetch("/assets/fahhhh.mp3");
    if (!response.ok) throw new Error("asset not found");
    const arrayBuffer = await response.arrayBuffer();
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch {
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
