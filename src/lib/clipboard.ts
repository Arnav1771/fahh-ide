/**
 * Copy text to the system clipboard. A failed copy (no clipboard API, permission denied,
 * window not focused) says so in a toast instead of failing silently. Resolves true on success.
 */
import { useToastStore } from "../store/toastStore";

export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("the clipboard is not available here");
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    useToastStore.getState().show(`Could not copy to the clipboard: ${why}`, "error");
    return false;
  }
}
