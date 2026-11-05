/**
 * LspBridge — non-rendering component that:
 *   1. Starts language servers for the languages of open tabs (the active tab's
 *      language first), plus ESLint / Ruff / Tailwind beside them when installed and
 *      the project uses them, and stops a server once no tab needs it.
 *   2. Feeds every `lsp://message` Tauri event to the shared LspService
 *      (`lib/lsp/monacoLsp`), which owns request/response correlation, document
 *      sync and the Monaco providers (completion, hover, definition, references,
 *      rename, signature help, code actions, inlay hints, highlights).
 *   3. Turns `textDocument/publishDiagnostics` into Monaco markers via
 *      `lib/monacoBridge`, one set per server, and on error-severity diagnostics
 *      invokes `trigger_error_sound` (throttled, so one cascade is one sound).
 */

import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import { useFileStore } from "../../store/fileStore";
import { useLspStore } from "../../store/lspStore";
import { useToastStore } from "../../store/toastStore";
import { createFile, lspSend, lspStart, lspStop, readFile, renameFile, writeFile } from "../../lib/tauri";
import type { LspMessage } from "../../lib/types";
import { hasErrorDiagnostic, lspToMarkers } from "../../lib/diagnostics";
import { clearDiagnostics, publishDiagnostics } from "../../lib/monacoBridge";
import { createCooldown, DEFAULT_COOLDOWN_MS } from "../../lib/cooldown";
import { languageFor } from "../../lib/tabs";
import { openAt } from "../../lib/navigation";
import { getLspService, LspService, setLspService } from "../../lib/lsp/monacoLsp";
import { detectProjectTools, extraServersFor, isExtraServer, languagesOf, primaryServerFor } from "../../lib/lsp/servers";
import { FILE_SAVED_EVENT } from "../../lib/tabActions";

/**
 * One cooldown for the whole app lifetime, deliberately module-level: it must
 * survive React remounts, otherwise a re-render would let the sound retrigger
 * instantly. The Rust `ErrorDetector` enforces the same window independently.
 */
const sfxCooldown = createCooldown(DEFAULT_COOLDOWN_MS);

/** typescript-language-server: inlay hints and auto-import completions are opt-in. */
const TS_INIT_OPTIONS = {
  preferences: {
    includeInlayParameterNameHints: "literals",
    includeInlayFunctionLikeReturnTypeHints: true,
    includeInlayPropertyDeclarationTypeHints: true,
    includeInlayEnumMemberValueHints: true,
    includeCompletionsForModuleExports: true,
    includeCompletionsWithInsertText: true,
  },
};

/** The one LspService, created on first use and kept across remounts of the bridge. */
function service(): LspService {
  const existing = getLspService();
  if (existing) return existing;
  const s: LspService = new LspService(
    monaco,
    { start: lspStart, send: lspSend, stop: lspStop },
    {
      openTabs: () => {
        const { openTabs, fileContents } = useEditorStore.getState();
        return openTabs.map((t) => ({ path: t.path, content: fileContents[t.path] }));
      },
      setTabContent: (path, text) => {
        const st = useEditorStore.getState();
        st.setContent(path, text);
        st.markDirty(path, true);
      },
      readFile,
      writeFile,
      createFile,
      renameFile,
      openAt,
      languageFor,
      toast: (text, kind) => useToastStore.getState().show(text, kind),
      windows: typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent),
      onStatus: (server, status, detail) => {
        if (isExtraServer(server)) return; // extras are quiet; Check Setup lists them
        for (const lang of languagesOf(server)) {
          if (status === "stopped") useLspStore.getState().clear(lang);
          else useLspStore.getState().set(lang, status as "starting" | "ready" | "failed", detail);
        }
      },
      onDiagnostics: (server, uri, diagnostics) => {
        const path = s.pathFor(uri);
        // An empty array is meaningful: it clears the file.
        publishDiagnostics(path, lspToMarkers(diagnostics as Parameters<typeof lspToMarkers>[0]), server);
        if (hasErrorDiagnostic(diagnostics as Parameters<typeof hasErrorDiagnostic>[0]) && sfxCooldown.tryTrigger()) {
          invoke("trigger_error_sound", { source: server }).catch((err: unknown) => console.warn("[LspBridge] trigger_error_sound failed:", err));
        }
      },
    }
  );
  setLspService(s);
  return s;
}

/** The opened folder is the workspace (as in VS Code); a file outside it uses its own folder. */
function workspaceFor(path: string): string {
  const root = useFileStore.getState().root;
  const r = root?.replace(/[\\/]+$/, "");
  const inRoot = !!r && (path === root || path.startsWith(r + "/") || path.startsWith(r + "\\"));
  return inRoot ? r! : path.replace(/[\\/][^\\/]+$/, "") || path;
}

export function LspBridge() {
  const openTabs = useEditorStore((s) => s.openTabs);
  const activeTab = useEditorStore((s) => s.activeTab);
  const root = useFileStore((s) => s.root);
  const tree = useFileStore((s) => s.tree);
  const toolsRef = useRef<{ eslint: boolean; tailwind: boolean }>({ eslint: false, tailwind: false });

  // ── What the project uses (decides ESLint / Tailwind) ──────────────────────
  useEffect(() => {
    if (!root) return;
    const files = (tree?.children ?? []).filter((c) => !c.is_dir).map((c) => c.name);
    const sep = root.includes("\\") ? "\\" : "/";
    readFile(root.replace(/[\\/]+$/, "") + sep + "package.json")
      .catch(() => null)
      .then((pkg) => {
        toolsRef.current = detectProjectTools(files, pkg);
      });
  }, [root, tree]);

  // ── Server lifecycle ────────────────────────────────────────────────────────
  useEffect(() => {
    const s = service();
    const active = openTabs.find((t) => t.path === activeTab);
    if (active) {
      const primary = primaryServerFor(active.language);
      if (primary) {
        const ws = workspaceFor(active.path);
        const uri = s.uriForPath(ws);
        void s.client.ensureServer(primary, ws, uri, primary === "typescript" ? TS_INIT_OPTIONS : undefined);
        for (const extra of extraServersFor(active.language, toolsRef.current)) {
          void s.client.ensureServer(extra, ws, uri);
        }
      }
    }
    // A server no open tab needs any more is stopped (frees its memory).
    const languages = new Set(openTabs.map((t) => t.language));
    for (const server of s.client.readyServers()) {
      if (!languagesOf(server).some((l) => languages.has(l))) void s.client.stopServer(server);
    }
  }, [openTabs, activeTab]);

  // ── Inbound LSP messages from Tauri ────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | null = null;
    listen<LspMessage>("lsp://message", (event) => {
      if (!mounted) return;
      const { language: server, payload } = event.payload;
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        console.warn("[LspBridge] Could not parse LSP message:", payload);
        return;
      }
      service().client.handleMessage(server, parsed);
    }).then((fn) => {
      if (mounted) unlisten = fn;
      else fn();
    }).catch(() => {});
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  // ── textDocument/didSave (the file on disk changed: some servers lint on save) ─
  useEffect(() => {
    const onSaved = (e: Event) => {
      const path = (e as CustomEvent<{ path: string }>).detail?.path;
      if (path) getLspService()?.didSave(path);
    };
    window.addEventListener(FILE_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(FILE_SAVED_EVENT, onSaved);
  }, []);

  // ── Drop markers for files the user has closed ─────────────────────────────
  const knownPathsRef = useRef<string[]>([]);
  useEffect(() => {
    const current = openTabs.map((t) => t.path);
    for (const path of knownPathsRef.current) {
      if (!current.includes(path)) clearDiagnostics(path);
    }
    knownPathsRef.current = current;
  }, [openTabs]);

  return null;
}
