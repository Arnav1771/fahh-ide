export const clampSize = (v: number, min: number, max: number): number =>
  Math.round(Math.min(Math.max(v, min), Math.max(min, max)));

type Store = Pick<Storage, "getItem" | "setItem">;

export function loadSize(key: string, def: number, min: number, max: number, store?: Store): number {
  try {
    const n = Number(store?.getItem(key));
    return Number.isFinite(n) && n > 0 ? clampSize(n, min, max) : def;
  } catch {
    return def;
  }
}

export function saveSize(key: string, v: number, store?: Store): void {
  try {
    store?.setItem(key, String(v));
  } catch {
    // storage blocked: the size just will not persist
  }
}
