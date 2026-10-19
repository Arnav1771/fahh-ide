import { useEffect, useRef } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import { useEditorStore } from "../../store/editorStore";
import { useFahhStore } from "../../store/fahhStore";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { TitleScreen } from "../Fahh/TitleScreen";
import { defineMonacoThemes } from "../ThemePanel";
import { registerGhostTextProvider } from "../../lib/inlineCompletions";
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

interface EditorPaneProps {
  /** Monaco editor theme name — pass from themeStore to keep in sync */
  monacoTheme?: string;
  /** Custom base font size in pixels (e.g. 17 for canvas mode) */
  fontSize?: number;
  /** Word wrap mode */
  wordWrap?: "on" | "off" | "wordWrapColumn" | "bounded";
  /** Font weight */
  fontWeight?: string;
  /** Line height */
  lineHeight?: number;
  /** Toggle minimap visibility */
  minimapEnabled?: boolean;
}

// Shape of the detail emitted by ThemePanel's fahh-theme-change event.
interface ThemeChangeDetail {
  monacoTheme: string;
}

export function EditorPane({
  monacoTheme = "vs-dark",
  fontSize = 14,
  wordWrap = "off",
  fontWeight = "500",
  lineHeight,
  minimapEnabled = true,
}: EditorPaneProps) {
  const { activeTab, fileContents, openTabs, setContent, markDirty } =
    useEditorStore();
    

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const disposablesRef = useRef<{ dispose(): void }[]>([]);
  const settleRef = useRef<number | undefined>(undefined);
  const errorLensRef = useRef<string[]>([]);
  /** Has the user typed in the file on screen since it became active? */
  const editedRef = useRef(false);

  const activeDoc = openTabs.find((t) => t.path === activeTab);
  const content = activeTab ? fileContents[activeTab] ?? "" : "";
  // Which preview this file can have, and how it is shown (VS Code's editor resolver, in small).
  const kind = activeTab ? previewKindFor(activeTab) : null;
  const previewOnly = activeTab ? isPreviewOnly(activeTab) : false;
  const storedMode = usePreviewStore((s) => (activeTab ? s.modes[activeTab] : undefined));
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
  
  // Tell the diagnostics bridge which file the shared Monaco model is showing,
  // so LSP markers for the wrong file never end up on screen.
  useEffect(() => {
    setActiveDocument(activeTab);
  }, [activeTab]);

  // Synchronize Monaco model content with store content when switching tabs or when content loads asynchronously
  useEffect(() => {
    if (!editorRef.current || !activeTab) return;
    const model = editorRef.current.getModel();
    if (model) {
      const currentVal = model.getValue();
      if (currentVal !== content) {
        model.setValue(content);
      }
    }
    editorRef.current.layout?.();
  }, [activeTab, content]);

  // Dynamically update Monaco editor options on prop changes without remounting
  useEffect(() => {
    if (!editorRef.current) return;
    editorRef.current.updateOptions({
      fontSize,
      wordWrap,
      fontWeight,
      lineHeight: lineHeight ?? Math.round(fontSize * 1.55),
      minimap: { enabled: minimapEnabled },
    });
    editorRef.current.layout?.();
  }, [fontSize, wordWrap, fontWeight, lineHeight, minimapEnabled]);

  // Never let the bridge hold a reference to a disposed editor.
  useEffect(() => {
    const handleResize = () => {
      editorRef.current?.layout?.();
    };
    window.addEventListener("resize", handleResize);
    window.addEventListener("fahh-layout", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("fahh-layout", handleResize);
      detachMonaco();
      for (const d of disposablesRef.current) d.dispose();
      disposablesRef.current = [];
      window.clearTimeout(settleRef.current);
      if (editorRef.current && errorLensRef.current.length > 0) {
        editorRef.current.deltaDecorations(errorLensRef.current, []);
      }
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
    if (intensity !== "epic" || reduced) return;
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

  if (!activeTab) {
    return <TitleScreen />;
  }

  const handleChange = (value: string | undefined) => {
    if (!activeTab || value === undefined) return;
    setContent(activeTab, value);
    // Dirty means "differs from the last save": undoing back to it clears the dot.
    const v = editorRef.current?.getModel()?.getAlternativeVersionId();
    markDirty(activeTab, v === undefined ? true : isDirtyAt(activeTab, v));
  };

  const handleEditorDidMount = (
    editor: Parameters<NonNullable<React.ComponentProps<typeof Editor>["onMount"]>>[0],
    monaco: Monaco
  ) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // Remember each model's version when it first appears, to know when it is back to its saved text.
    const baseline = () => {
      const { activeTab: p, openTabs: tabs } = useEditorStore.getState();
      const model = editor.getModel();
      if (p && model) ensureBaseline(p, model.getAlternativeVersionId(), !!tabs.find((t) => t.path === p)?.dirty);
    };
    baseline();
    // The custom themes are registered in beforeMount; apply the chosen one
    // again now, in case Monaco fell back while the editor was being created.
    monaco.editor.setTheme(monacoTheme);

    // Hand the live editor to the diagnostics bridge. Anything LSP published
    // before Monaco mounted is flushed onto the model immediately.
    attachMonaco(monaco, editor);
    setActiveDocument(activeTab);

    // Ensure model content is populated if loaded before onMount
    const model = editor.getModel();
    if (model && content && model.getValue() !== content) {
      model.setValue(content);
    }
    setTimeout(() => {
      editor.layout?.();
    }, 100);

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
    const updateErrorLens = () => {
      const model = editor.getModel();
      if (!model) return;
      const markers = monaco.editor.getModelMarkers({ resource: model.uri });
      const decs: Parameters<typeof editor.deltaDecorations>[1] = [];
      for (const m of markers) {
        if (m.severity === monaco.MarkerSeverity.Error || m.severity === monaco.MarkerSeverity.Warning) {
          const isErr = m.severity === monaco.MarkerSeverity.Error;
          const cleanMsg = m.message.split("\n")[0].slice(0, 90);
          decs.push({
            range: new monaco.Range(m.startLineNumber, 1, m.startLineNumber, 1),
            options: {
              isWholeLine: false,
              after: {
                content: `   ${isErr ? "●" : "▲"} ${cleanMsg}`,
                inlineClassName: isErr ? "fahh-error-lens-error" : "fahh-error-lens-warn",
              },
            },
          });
        }
      }
      errorLensRef.current = editor.deltaDecorations(errorLensRef.current, decs);
    };

    const settle = () => {
      window.clearTimeout(settleRef.current);
      settleRef.current = window.setTimeout(() => {
        const c = countMarkers();
        updateErrorLens();
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
      editor.onDidChangeModel(() => {
        baseline();
        editedRef.current = false;
        errorLensRef.current = editor.deltaDecorations(errorLensRef.current, []);
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

    // Register Copilot/Cursor Ghost Text inline completions
    const ghostDisposable = registerGhostTextProvider(monaco);
    disposablesRef.current.push(ghostDisposable);

    editedRef.current = false;
    settle();
  };

  return (
    <div className="flex-1 flex min-h-0 relative w-full h-full">
      {/* The text editor stays mounted (hidden) when the preview replaces it,
          so the diagnostics bridge never holds a disposed editor. */}
      <div
        id="monaco-container"
        className="flex-1 flex flex-col min-h-0 min-w-0 relative w-full h-full"
        style={mode === "only" ? { display: "none" } : undefined}
      >
        <Editor
          height="100%"
          width="100%"
          /* One model per file: TypeScript sees the real extension (so .tsx
             parses JSX) and each tab keeps its own undo history. */
          path={modelPathFor(activeTab)}
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
            fontSize,
            fontFamily: "JetBrains Mono, Fira Code, Menlo, Monaco, Consolas, monospace",
            fontWeight,
            lineHeight: lineHeight ?? Math.round(fontSize * 1.55),
            letterSpacing: 0.3,
            minimap: { enabled: minimapEnabled },
            scrollBeyondLastLine: false,
            wordWrap,
            tabSize: 2,
            automaticLayout: true,
            smoothScrolling: true,
            cursorBlinking: "phase",
            renderLineHighlight: "all",
            padding: { top: 8 },
            readOnly: previewOnly,
            inlineSuggest: {
              enabled: true,
              mode: "prefix",
            },
            suggest: {
              preview: true,
            },
          }}
        />
      </div>

      {kind && mode !== "off" && (
        <div className={mode === "side" ? "flex w-1/2 min-w-0 border-l border-fahh-surface" : "flex flex-1 min-w-0"}>
          <PreviewPane
            path={activeTab}
            content={content}
            kind={kind}
            onClose={mode === "side" ? () => setPreviewMode(activeTab, "off") : undefined}
            onShowSource={mode === "only" && !previewOnly ? () => setPreviewMode(activeTab, "off") : undefined}
          />
        </div>
      )}
    </div>
  );
}
