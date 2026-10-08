/**
 * The built-in browser: a web address opens as an editor tab whose preview is the
 * page (see PreviewPane's BrowserPreview). Pages that refuse to be framed
 * (X-Frame-Options / frame-ancestors) open in their own Fahh window instead.
 */
import { useEditorStore } from "../store/editorStore";
import { usePreviewStore } from "../store/previewStore";
import { findLocalUrls, normalizeUrl } from "./preview";

/** Open (or focus) a browser tab for what was typed: "5173", "localhost:3000", a full URL. */
export function openBrowser(input: string): string {
  // No trailing slash on a bare origin, so the tab is labelled "localhost:5173".
  const url = normalizeUrl(input).replace(/^(https?:\/\/[^/]+)\/$/i, "$1");
  useEditorStore.getState().openFile({ path: url, language: "browser", dirty: false }, "");
  return url;
}

/** Remember the latest local dev-server address seen in terminal or run output. */
export function noteLocalUrls(text: string): void {
  const urls = findLocalUrls(text);
  if (urls.length) usePreviewStore.getState().setLocalUrl(urls[urls.length - 1]);
}

/** The page in its own Fahh window: for sites that will not show inside a frame. */
export async function openInWindow(url: string): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  new WebviewWindow(`browser-${Date.now()}`, { url, title: url, width: 1100, height: 760 });
}

/** The page in the system browser. */
export async function openExternal(url: string): Promise<void> {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}
