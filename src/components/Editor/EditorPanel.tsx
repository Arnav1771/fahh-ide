import { useEffect, useRef } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import type { IDockviewPanelProps } from "dockview-react";
import { useEditorStore } from "../../store/editorStore";
import { useFahhStore } from "../../store/fahhStore";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { useThemeStore } from "../../store/themeStore";
import { THEME_DEFINITIONS, defineMonacoThemes } from "../ThemePanel";
import {
  attachMonaco,
  detachMonaco,
  setActiveDocument,
  modelPathFor,
} from "../../lib/monacoBridge";
import { PreviewPane } from "../Preview/PreviewPane";
import { isPreviewOnly, previewKindFor } from "../../lib/preview";
import { usePreviewStore } from "../../store/previewStore";
import { runCommand } from "../../lib/commands";
import { ensureBaseline, isDirtyAt } from "../../lib/saveBaseline";

// Shape of the detail emitted by ThemePanel's fahh-theme-change event.
interface ThemeChangeDetail {
  monacoTheme: string;
}

/**
 * One editor tab in the dock. Several of these can show the same file (a split):
 * they share one Monaco model, because the model is looked up by path.
 */
export function EditorPanel({ api: panelApi, params }: IDockviewPanelProps<{ path: string }>) {
  const path = params.path;
  const activeTheme = useThemeStore((s) => s.activeTheme);
  const monacoTheme = THEME_DEFINITIONS.find((d) => d.id === activeTheme)?.monacoTheme ?? "vs-dark";
  const { fileContents, openTabs, setContent, markDirty } = useEditorStore();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const disposablesRef = useRef<{ dispose(): void }[]>([]);
  const settleRef = useRef<number | undefined>(undefined);
  /** Has the user typed in the file on screen since it became active? */
  const editedRef = useRef(false);

  const activeDoc = openTabs.find((t) => t.path === path);
  const content = path ? fileContents[path] ?? "" : "";
  // Which preview this file can have, and how it is shown (VS Code's editor resolver, in small).
  const kind = path ? previewKindFor(path) : null;
  const previewOnly = path ? isPreviewOnly(path) : false;
  const storedMode = usePreviewStore((s) => (path ? s.modes[path] : undefined));
  const setPreviewMode = usePreviewStore((s) => s.setMode);
  const mode = previewOnly ? "only" : kind ? storedMode ?? "off" : "off";

  // Listen for theme changes dispatched by ThemePanel so Monaco's internal
  // theme is updated even in the native Tauri build (CSS variables alone do
  // not reach Monaco's renderer).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ThemeChangeDetail>).detail;
      if (editorRef.current && monacoRef.current && detail?.monacoTheme) {
        monacoRef.current.editor.setTheme(detail.monacoTheme);
      }
    };
    window.addEventListener("fahh-theme-change", handler);
    return () => window.removeEventListener("fahh-theme-change", handler);
  }, []);
  
  // This editor is the one the diagnostics bridge, the status bar and Ctrl+S talk to
  // while its tab is the active one (or while the cursor is in it).
  const takeFocus = () => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (editor && monaco) attachMonaco(monaco, editor);
    setActiveDocument(path);
    if (useEditorStore.getState().activeTab !== path) useEditorStore.getState().setActiveTab(path);
  };
  const takeFocusRef = useRef(takeFocus);
  takeFocusRef.current = takeFocus;
  const isCurrent = () => panelApi.isActive && panelApi.isGroupActive;
  useEffect(() => {
    if (isCurrent()) takeFocusRef.current();
    const ds = [panelApi.onDidActiveChange(() => isCurrent() && takeFocusRef.current()), panelApi.onDidActiveGroupChange(() => isCurrent() && takeFocusRef.current())];
    return () => ds.forEach((d) => d.dispose());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelApi]);

  // Never let the bridge hold a reference to a disposed editor.
  useEffect(() => {
    return () => {
      if (editorRef.current) detachMonaco(editorRef.current);
      for (const d of disposablesRef.current) d.dispose();
      disposablesRef.current = [];
      window.clearTimeout(settleRef.current);
    };
  }, []);

  // The fahh moment, on the line itself: the first error line pulses once (Epic).
  const impact = useFahhStore((s) => s.impact);
  const intensity = useFahhStore((s) => s.intensity);
  const reduced = useReducedMotion();
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!impact || impact.kind !== "fahh" || !impact.line || !editor || !monaco) return;
    if (intensity !== "epic" || reduced || !isCurrent()) return;
    const ids: string[] = editor.deltaDecorations([], [
      {
        range: new monaco.Range(impact.line, 1, impact.line, 1),
        options: { isWholeLine: true, className: "fahh-line-hit", marginClassName: "fahh-line-hit-margin" },
      },
    ]);
    const t = window.setTimeout(() => editor.deltaDecorations(ids, []), 1100);
    return () => {
      window.clearTimeout(t);
      editor.deltaDecorations(ids, []);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impact?.seq]);

  const handleChange = (value: string | undefined) => {
    if (!path || value === undefined) return;
    setContent(path, value);
    // Dirty means "differs from the last save": undoing back to it clears the dot.
    const v = editorRef.current?.getModel()?.getAlternativeVersionId();
    markDirty(path, v === undefined ? true : isDirtyAt(path, v));
  };

  const handleEditorDidMount = (
    editor: Parameters<NonNullable<React.ComponentProps<typeof Editor>["onMount"]>>[0],
    monaco: Monaco
  ) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // Remember each model's version when it first appears, to know when it is back to its saved text.
    const baseline = () => {
      const { openTabs: tabs } = useEditorStore.getState();
      const p = path;
      const model = editor.getModel();
      if (p && model) ensureBaseline(p, model.getAlternativeVersionId(), !!tabs.find((t) => t.path === p)?.dirty);
    };
    baseline();
    // The custom themes are registered in beforeMount; apply the chosen one
    // again now, in case Monaco fell back while the editor was being created.
    monaco.editor.setTheme(monacoTheme);

    // Hand the live editor to the diagnostics bridge. Anything LSP published
    // before Monaco mounted is flushed onto the model immediately.
    if (isCurrent()) takeFocusRef.current();

    // Feed the HUD. Every checker's markers count (Monaco's own TypeScript,
    // JSON, CSS and HTML workers, and the language servers via the bridge),
    // once they have settled for 800 ms. A count only *reacts* (fahh / clean)
    // after you have typed in this file; opening or switching to a broken
    // file just shows its count.
    const countMarkers = () => {
      const model = editor.getModel();
      let errors = 0;
      let warnings = 0;
      let line: number | null = null;
      if (model) {
        for (const m of monaco.editor.getModelMarkers({ resource: model.uri })) {
          if (m.severity === monaco.MarkerSeverity.Error) {
            errors++;
            if (line === null || m.startLineNumber < line) line = m.startLineNumber;
          } else if (m.severity === monaco.MarkerSeverity.Warning) {
            warnings++;
          }
        }
      }
      return { errors, warnings, line };
    };
    const settle = () => {
      window.clearTimeout(settleRef.current);
      settleRef.current = window.setTimeout(() => {
        const c = countMarkers();
        const hud = useFahhStore.getState();
        if (editedRef.current) hud.report(c.errors, c.warnings, c.line);
        else hud.rebase(c.errors, c.warnings);
      }, 800);
    };
    for (const d of disposablesRef.current) d.dispose();
    disposablesRef.current = [
      monaco.editor.onDidChangeMarkers((uris) => {
        const current = editor.getModel()?.uri.toString();
        if (current && uris.some((u) => u.toString() === current)) settle();
      }),
      editor.onDidFocusEditorWidget(() => takeFocusRef.current()),
      editor.onDidChangeModel(() => {
        baseline();
        editedRef.current = false;
        settle();
      }),
      editor.onDidChangeModelContent((e) => {
        if (!e.isFlush) editedRef.current = true;
      }),
    ];
    // Previews: Ctrl+K V opens one to the side, Ctrl+Shift+V swaps in place.
    // Registered with Monaco so its own Ctrl+K chords keep working.
    editor.addCommand(monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyCode.KeyV), () => runCommand("preview.side"));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyV, () => runCommand("preview.toggle"));
    // Scroll sync: the preview follows the editor's top visible line.
    disposablesRef.current.push(
      editor.onDidScrollChange(() => {
        usePreviewStore.getState().setTopLine(editor.getVisibleRanges()[0]?.startLineNumber ?? 1);
      })
    );

    editedRef.current = false;
    settle();
  };

  return (
    <div className="flex h-full w-full min-h-0 relative">
      {/* The text editor stays mounted (hidden) when the preview replaces it,
          so the diagnostics bridge never holds a disposed editor. */}
      <div
        id="monaco-container"
        className="flex-1 flex flex-col min-h-0 min-w-0 relative"
        style={mode === "only" ? { display: "none" } : undefined}
      >
        <Editor
          height="100%"
          /* One model per file: TypeScript sees the real extension (so .tsx
             parses JSX) and each tab keeps its own undo history. */
          path={modelPathFor(path)}
          keepCurrentModel /* a split shows the same model; closing a tab disposes it (tabActions.forceClose) */
          language={activeDoc?.language ?? "plaintext"}
          value={content}
          onChange={handleChange}
          theme={monacoTheme}
          /* Themes must exist before the editor is created: Monaco reads the
             theme once at creation, so registering them in onMount left a
             saved custom theme (Gold, GitHub Dark, Dracula, Solarized)
             unapplied after a restart. */
          beforeMount={defineMonacoThemes}
          onMount={handleEditorDidMount}
          options={{
            fontSize: 14,
            fontFamily: "JetBrains Mono, Fira Code, monospace",
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            wordWrap: "off",
            tabSize: 2,
            automaticLayout: true,
            smoothScrolling: true,
            cursorBlinking: "phase",
            renderLineHighlight: "all",
            padding: { top: 8 },
            readOnly: previewOnly,
          }}
        />
      </div>

      {kind && mode !== "off" && (
        <div className={mode === "side" ? "flex w-1/2 min-w-0 border-l border-fahh-surface" : "flex flex-1 min-w-0"}>
          <PreviewPane
            path={path}
            content={content}
            kind={kind}
            onClose={mode === "side" ? () => setPreviewMode(path, "off") : undefined}
            onShowSource={mode === "only" && !previewOnly ? () => setPreviewMode(path, "off") : undefined}
          />
        </div>
      )}
    </div>
  );
}
