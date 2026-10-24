/**
 * The error sound: the bundled fahh, or a file the user picked. The file is copied into
 * the app's data folder by the backend (core/setup.rs), so it survives the original moving.
 * Settings keep only its name ("" = the default fahh).
 */
export const SOUND_EXTENSIONS = ["mp3", "wav", "ogg", "m4a"];

export interface SoundDeps {
  /** Native file dialog; null when cancelled. */
  pick: () => Promise<string | null>;
  /** Validate and copy into the app data dir; resolves to the file's name. */
  store: (path: string) => Promise<string>;
  /** Decode the stored copy; false when it cannot be played. */
  load: () => Promise<boolean>;
  /** Forget the stored copy. */
  clear: () => Promise<void>;
  /** Save the choice in Settings. */
  setName: (name: string) => void;
}

export type ChooseResult = { ok: true; name: string } | { ok: false; error: string } | null;

/** Change sound…: pick, copy, decode, remember. null when the dialog was cancelled. */
export async function chooseSound(d: SoundDeps): Promise<ChooseResult> {
  const path = await d.pick();
  if (!path) return null;
  try {
    const name = await d.store(path);
    if (!(await d.load())) {
      await d.clear().catch(() => {});
      d.setName("");
      return { ok: false, error: `${name} could not be played. Try another mp3, wav, ogg or m4a file.` };
    }
    d.setName(name);
    return { ok: true, name };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Reset to default: the fahh again. */
export async function resetSound(d: Pick<SoundDeps, "clear" | "setName">): Promise<void> {
  await d.clear().catch(() => {});
  d.setName("");
}
