/**
 * Monaco bumps a model's "alternative version id" on every edit, and undo
 * restores the id the text had before. So a file is dirty exactly when its
 * current id differs from the id at the last save/load: undoing back to the
 * saved text makes it clean again.
 */

/** Marks a baseline that can never match: the tab already held unsaved text when its model was made. */
export const ALWAYS_DIRTY = -1;

const baselines = new Map<string, number>();

export const setBaseline = (path: string, versionId: number) => void baselines.set(path, versionId);
export const clearBaseline = (path: string) => void baselines.delete(path);

/** First sight of a model: remember its version (or ALWAYS_DIRTY if the tab already holds unsaved text). */
export function ensureBaseline(path: string, versionId: number, alreadyDirty: boolean): void {
  if (!baselines.has(path)) baselines.set(path, alreadyDirty ? ALWAYS_DIRTY : versionId);
}

/** Unknown baseline counts as dirty: better a false "unsaved" than a lost edit. */
export function isDirtyAt(path: string, versionId: number): boolean {
  const base = baselines.get(path);
  return base === undefined ? true : base !== versionId;
}
