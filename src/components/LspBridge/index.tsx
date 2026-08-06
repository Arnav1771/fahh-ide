/**
 * LspBridge — non-rendering component that:
 *   1. Starts/stops LSP servers as the active file's language changes.
 *   2. Listens to `lsp://message` Tauri events.
 *   3. Turns `textDocument/publishDiagnostics` into Monaco markers via
 *      `lib/monacoBridge` — this is what puts the squiggles in the editor.
 *   4. On error-severity diagnostics, invokes `trigger_error_sound`
 *      (which fires the fahh://error event consumed by fahh.ts), throttled
 *      locally so one cascade of diagnostics is one sound.
 */

import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import { lspStart, lspStop, lspSend } from "../../lib/tauri";
import type { LspMessage } from "../../lib/types";
import {
  hasErrorDiagnostic,
  lspToMarkers,
  parsePublishDiagnostics,
  uriToPath,
} from "../../lib/diagnostics";
import { clearDiagnostics, publishDiagnostics } from "../../lib/monacoBridge";
import { createCooldown, DEFAULT_COOLDOWN_MS } from "../../lib/cooldown";

// ─── Language → LSP server detection ──────────────────────────────────────────

const LSP_SUPPORTED: ReadonlySet<string> = new Set([
  "python",
  "javascript",
  "typescript",
  "rust",
  "go",
  "cpp",
  "c",
  "java",
  "json",
  "html",
  "css",
]);

function hasLsp(language: string): boolean {
  return LSP_SUPPORTED.has(language.toLowerCase());
}

/**
 * One cooldown for the whole app lifetime, deliberately module-level: it must
 * survive React remounts, otherwise a re-render would let the sound retrigger
 * instantly. The Rust `ErrorDetector` enforces the same window independently.
 */
const sfxCooldown = createCooldown(DEFAULT_COOLDOWN_MS);

// ─── JSON-RPC helpers ─────────────────────────────────────────────────────────

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

function buildNotification(method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", method, params } satisfies JsonRpcNotification);
}

function buildInitialize(workspace: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      processId: null,
      rootUri: `file://${workspace}`,
      capabilities: {
        textDocument: {
          publishDiagnostics: { relatedInformation: true },
          completion: { completionItem: { snippetSupport: true } },
          hover: {},
          definition: {},
        },
        workspace: {
          workspaceFolders: true,
          didChangeWatchedFiles: { dynamicRegistration: true },
        },
      },
    },
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LspBridge() {
  const { activeTab, openTabs, fileContents } = useEditorStore();

  const activeDoc = openTabs.find((t) => t.path === activeTab) ?? null;
  const language = activeDoc?.language ?? null;

  // Track which language server is currently running
  const runningLangRef = useRef<string | null>(null);
  // Track which files we've sent didOpen for
  const openedPathsRef = useRef<Set<string>>(new Set());
  // Track the current workspace root
  const workspaceRef = useRef<string>("");

  // ── LSP server lifecycle ────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeDoc || !language || !hasLsp(language)) {
      return;
    }

    const workspace =
      activeDoc.path.replace(/[\\/][^\\/]+$/, "") || activeDoc.path;
    workspaceRef.current = workspace;

    // Stop the previous server if language changed
    if (runningLangRef.current && runningLangRef.current !== language) {
      const prev = runningLangRef.current;
      lspStop(prev).catch((err: unknown) => {
        console.warn(`[LspBridge] lsp_stop(${prev}) failed:`, err);
      });
      runningLangRef.current = null;
      openedPathsRef.current.clear();
    }

    if (runningLangRef.current === language) {
      // Server already running — just send didOpen for new file if needed
      if (!openedPathsRef.current.has(activeDoc.path)) {
        const content = fileContents[activeDoc.path] ?? "";
        const didOpen = buildNotification("textDocument/didOpen", {
          textDocument: {
            uri: `file://${activeDoc.path}`,
            languageId: language,
            version: 1,
            text: content,
          },
        });
        lspSend(language, didOpen).catch((err: unknown) =>
          console.warn("[LspBridge] lsp_send(didOpen) failed:", err)
        );
        openedPathsRef.current.add(activeDoc.path);
      }
      return;
    }

    // Start fresh server
    let mounted = true;

    lspStart(language, workspace)
      .then(() => {
        if (!mounted) return;
        runningLangRef.current = language;
        openedPathsRef.current.clear();

        // 1. initialize
        return lspSend(language, buildInitialize(workspace));
      })
      .then(() => {
        if (!mounted || !activeDoc) return;
        // 2. initialized notification
        return lspSend(
          language,
          buildNotification("initialized", {})
        );
      })
      .then(() => {
        if (!mounted || !activeDoc) return;
        // 3. textDocument/didOpen
        const content = fileContents[activeDoc.path] ?? "";
        const didOpen = buildNotification("textDocument/didOpen", {
          textDocument: {
            uri: `file://${activeDoc.path}`,
            languageId: language,
            version: 1,
            text: content,
          },
        });
        openedPathsRef.current.add(activeDoc.path);
        return lspSend(language, didOpen);
      })
      .catch((err: unknown) => {
        console.warn("[LspBridge] LSP startup sequence failed:", err);
      });

    return () => {
      mounted = false;
    };
  }, [language, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── textDocument/didChange ─────────────────────────────────────────────────
  // Send didChange whenever the content for the active file changes
  const changeVersionRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!activeDoc || !language || !hasLsp(language)) return;
    if (!openedPathsRef.current.has(activeDoc.path)) return;
    if (runningLangRef.current !== language) return;

    const content = fileContents[activeDoc.path];
    if (content === undefined) return;

    const ver = (changeVersionRef.current[activeDoc.path] ?? 1) + 1;
    changeVersionRef.current[activeDoc.path] = ver;

    const didChange = buildNotification("textDocument/didChange", {
      textDocument: { uri: `file://${activeDoc.path}`, version: ver },
      contentChanges: [{ text: content }],
    });

    lspSend(language, didChange).catch((err: unknown) =>
      console.warn("[LspBridge] lsp_send(didChange) failed:", err)
    );
  }, [fileContents, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── textDocument/didSave ────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeDoc || !language || !hasLsp(language)) return;
    // Only send if the file is no longer dirty (just saved)
    if (activeDoc.dirty) return;
    if (runningLangRef.current !== language) return;
    if (!openedPathsRef.current.has(activeDoc.path)) return;

    const didSave = buildNotification("textDocument/didSave", {
      textDocument: { uri: `file://${activeDoc.path}` },
    });

    lspSend(language, didSave).catch((err: unknown) =>
      console.warn("[LspBridge] lsp_send(didSave) failed:", err)
    );
  }, [activeDoc?.dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Inbound LSP messages from Tauri ────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | null = null;

    listen<LspMessage>("lsp://message", async (event) => {
      if (!mounted) return;
      const { language: msgLang, payload } = event.payload;

      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        console.warn("[LspBridge] Could not parse LSP message:", payload);
        return;
      }

      // textDocument/publishDiagnostics — the only inbound message that has a
      // visible effect today. Everything else is forwarded below.
      const params = parsePublishDiagnostics(parsed);
      if (params) {
        const path = uriToPath(params.uri);

        // 1. Squiggles. An empty array is meaningful: it clears the file.
        publishDiagnostics(path, lspToMarkers(params.diagnostics));

        // 2. The Fahh SFX, throttled here so a 40-diagnostic cascade is one
        //    sound even though it arrives as many notifications.
        if (hasErrorDiagnostic(params.diagnostics) && sfxCooldown.tryTrigger()) {
          invoke("trigger_error_sound", { source: msgLang }).catch(
            (err: unknown) =>
              console.warn("[LspBridge] trigger_error_sound failed:", err)
          );
        }
      }

      // Forward to Monaco's language client via a custom DOM event
      // Monaco's services listen for window events when configured to do so.
      window.dispatchEvent(
        new CustomEvent("lsp-message", {
          detail: { language: msgLang, message: parsed },
        })
      );
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  // ── Drop markers for files the user has closed ─────────────────────────────
  const knownPathsRef = useRef<string[]>([]);

  useEffect(() => {
    const current = openTabs.map((t) => t.path);
    for (const path of knownPathsRef.current) {
      if (!current.includes(path)) {
        clearDiagnostics(path);
        openedPathsRef.current.delete(path);
      }
    }
    knownPathsRef.current = current;
  }, [openTabs]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (runningLangRef.current) {
        lspStop(runningLangRef.current).catch(() => {});
        runningLangRef.current = null;
      }
    };
  }, []);

  // Non-rendering component
  return null;
}
