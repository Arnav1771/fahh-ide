import { useEffect, useRef } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import type { DockviewPanelApi } from "dockview-react";
import { useEditorStore } from "../../store/editorStore";
import { useFahhStore } from "../../store/fahhStore";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { TitleScreen } from "../Fahh/TitleScreen";
import { defineMonacoThemes } from "../ThemePanel";
import { attachSyntaxCheck } from "../../lib/syntaxCheck";
import {
  attachMonaco,
  detachMonaco,
  setActiveDocument,
  modelPathFor,
} from "../../lib/monacoBridge";
import { PreviewPane } from "../Preview/PreviewPane";
import { isPreviewOnly, previewKindFor } from "../../lib/preview";
import { modeOf, usePreviewStore } from "../../store/previewStore";
import { runCommand } from "../../lib/commands";
import { ensureBaseline, isDirtyAt } from "../../lib/saveBaseline";
import { saveActive } from "../../lib/tabActions";
import { recordCursor } from "../../lib/navigation";
import { useSettingsStore } from "../../store/settingsStore";
import { useDebugStore } from "../../store/debugStore";
import { samePath, toggleBreakpointAt } from "../../lib/debugSession";
import { seeWiki } from "../../store/deepwikiStore";

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
  /** Docked: this editor always shows this file (one per dock tab; splits share the model). */
  path?: string;
  /** Docked: the dock tab, so only the current one talks to the diagnostics bridge. */
  dock?: DockviewPanelApi;
}

// Shape of the detail emitted by ThemePanel's fahh-theme-change event.
interface ThemeChangeDetail {
  monacoTheme: string;
}

export function EditorPane({
  monacoTheme = "vs-dark",
  fontSize: fontSizeProp,
  wordWrap: wordWrapProp,
  fontWeight = "500",
  lineHeight,
  minimapEnabled: minimapProp,
  path,
  dock,
}: EditorPaneProps) {
  const { activeTab: storeActive, fileContents, openTabs, setContent, markDirty } =
    useEditorStore();
  // View > Settings, applied live; the canvas passes its own size, wrap and minimap.
  const settings = useSettingsStore();
  const fontSize = fontSizeProp ?? settings.fontSize;
  const wordWrap = wordWrapProp ?? (settings.wordWrap ? "on" : "off");
  const minimapEnabled = minimapProp ?? settings.minimap;
  const { fontFamily, tabSize, insertSpaces, lineNumbers, relativeLineNumbers, stickyScroll, bracketPairs, fontLigatures, multiCursorModifier } = settings;
  const lineNumbersOpt = !lineNumbers ? "off" : relativeLineNumbers ? "relative" : "on";
  const extraOptions = {
    stickyScroll: { enabled: stickyScroll },
    bracketPairColorization: { enabled: bracketPairs },
    guides: { bracketPairs: bracketPairs ? ("active" as const) : false, indentation: true },
    fontLigatures,
    multiCursorModifier,
  };
  const activeTab = path ?? storeActive;
  /** Undocked there is one editor, always current; docked, the active tab of the active group is. */
  const isCurrent = () => !dock || (dock.isActive && dock.isGroupActive);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const disposablesRef = useRef<{ dispose(): void }[]>([]);
  const settleRef = useRef<number | undefined>(undefined);
  const errorLensRef = useRef<string[]>([]);
  /** Has the user typed in the file on screen since it became active? */
  const editedRef = useRef(false);

  const activeDoc = openTabs.find((t) => t.path === activeTab);
  /**
   * Docked, and the file was just closed: the store already dropped its text, but this editor
   * lives until the dock removes the tab. Writing "" into the model now would shrink it to one
   * line under its markers and decorations ("Illegal value for lineNumber"), so leave it alone.
   */
  const closed = !!path && !activeDoc;
  const lastContent = useRef("");
  if (!closed) lastContent.current = activeTab ? fileContents[activeTab] ?? "" : "";
  const content = lastContent.current;
  const modelOpts = useRef({ tabSize, insertSpaces });
  modelOpts.current = { tabSize, insertSpaces };
  // Which preview this file can have, and how it is shown (VS Code's editor resolver, in small).
  const kind = activeTab ? previewKindFor(activeTab) : null;
  const previewOnly = activeTab ? isPreviewOnly(activeTab) : false;
  const storedMode = usePreviewStore((s) => (activeTab ? modeOf(s.modes, activeTab) : "off"));
  const setPreviewMode = usePreviewStore((s) => s.setMode);
  const mode = previewOnly ? "only" : kind ? storedMode : "off";
  const autoSave = useEditorStore((s) => s.autoSave);

  // Debounced auto-save when user types and autoSave is active
  useEffect(() => {
    if (!autoSave || !activeTab || !activeDoc?.dirty || activeTab !== storeActive) return;
    const timer = window.setTimeout(() => {
      void saveActive(true);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [autoSave, activeTab, storeActive, content, activeDoc?.dirty]);

  // Auto-save on window blur
  useEffect(() => {
    if (!autoSave || (dock && activeTab !== storeActive)) return;
    const handleBlur = () => {
      if (useEditorStore.getState().openTabs.some((t) => t.dirty)) {
        void saveActive(true);
      }
    };
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [autoSave, dock, activeTab, storeActive]);

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
    if (isCurrent()) setActiveDocument(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Docked: the tab that becomes current takes the bridge, the status bar and Ctrl+S.
  const takeFocus = () => {
    if (editorRef.current && monacoRef.current) attachMonaco(monacoRef.current, editorRef.current);
    setActiveDocument(activeTab);
    if (path && useEditorStore.getState().activeTab !== path) useEditorStore.getState().setActiveTab(path);
  };
  const takeFocusRef = useRef(takeFocus);
  takeFocusRef.current = takeFocus;
  useEffect(() => {
    if (!dock) return;
    const on = () => isCurrent() && takeFocusRef.current();
    const ds = [dock.onDidActiveChange(on), dock.onDidActiveGroupChange(on)];
    return () => ds.forEach((d) => d.dispose());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dock]);

  // Synchronize Monaco model content with store content when switching tabs or when content loads asynchronously
  useEffect(() => {
    if (!editorRef.current || !activeTab || closed) return;
    const model = editorRef.current.getModel();
    if (model && !model.isDisposed?.()) {
      const currentVal = model.getValue();
      if (currentVal !== content) {
        model.setValue(content);
      }
    }
    editorRef.current.layout?.();
  }, [activeTab, content, closed]);

  // Settings changes reach every open editor without remounting it.
  useEffect(() => {
    if (!editorRef.current) return;
    editorRef.current.updateOptions({
      fontSize,
      fontFamily,
      wordWrap,
      fontWeight,
      lineHeight: lineHeight ?? Math.round(fontSize * 1.55),
      minimap: { enabled: minimapEnabled },
      lineNumbers: lineNumbersOpt,
      ...extraOptions,
    });
    const model = editorRef.current.getModel();
    if (model && !model.isDisposed?.()) model.updateOptions({ tabSize, insertSpaces });
    editorRef.current.layout?.();
  }, [fontSize, fontFamily, wordWrap, fontWeight, lineHeight, minimapEnabled, lineNumbersOpt, tabSize, insertSpaces, stickyScroll, bracketPairs, fontLigatures, multiCursorModifier]); // eslint-disable-line react-hooks/exhaustive-deps

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
      detachMonaco(editorRef.current);
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

  if (!activeTab) {
    return <TitleScreen />;
  }

  const handleChange = (value: string | undefined) => {
    if (!activeTab || value === undefined || closed) return;
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
    if (isCurrent()) {
      attachMonaco(monaco, editor);
      setActiveDocument(activeTab);
    }

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
      editor.onDidFocusEditorWidget(() => {
        if (dock) takeFocusRef.current();
      }),
      editor.onDidChangeModel(() => {
        editor.getModel()?.updateOptions(modelOpts.current);
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
    // Ctrl+K Ctrl+W: close all tabs (App lets the second key through to Monaco when the chord started here).
    editor.addCommand(
      monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW),
      () => runCommand("file.closeAll")
    );
    editor.getModel()?.updateOptions(modelOpts.current);
    // Scroll sync: the preview follows the editor's top visible line.
    disposablesRef.current.push(
      editor.onDidScrollChange(() => {
        usePreviewStore.getState().setTopLine(editor.getVisibleRanges()[0]?.startLineNumber ?? 1);
      })
    );

    // Breakpoints: click the glyph margin (left of the line numbers) or press F9.
    // The paused line is highlighted with an arrow in the same margin.
    const fileHere = () => path ?? useEditorStore.getState().activeTab;
    let debugDecorations: string[] = [];
    const paintDebug = () => {
      const model = editor.getModel();
      const file = fileHere();
      if (!model || model.isDisposed?.() || !file) return;
      const { breakpoints, currentFile, currentLine, isPaused } = useDebugStore.getState();
      const lines = Object.entries(breakpoints).find(([f]) => samePath(f, file))?.[1] ?? [];
      const max = model.getLineCount();
      const decs: Parameters<typeof editor.deltaDecorations>[1] = lines
        .filter((l) => l <= max)
        .map((l) => ({
          range: new monaco.Range(l, 1, l, 1),
          options: { glyphMarginClassName: "fahh-bp-glyph", glyphMarginHoverMessage: { value: "Breakpoint (click to remove)" }, stickiness: 1 },
        }));
      if (isPaused && currentFile && currentLine && currentLine <= max && samePath(currentFile, file)) {
        decs.push({
          range: new monaco.Range(currentLine, 1, currentLine, 1),
          options: { isWholeLine: true, className: "fahh-debug-line", glyphMarginClassName: "fahh-debug-glyph" },
        });
      }
      debugDecorations = editor.deltaDecorations(debugDecorations, decs);
    };
    paintDebug();
    disposablesRef.current.push(
      editor.onMouseDown((e) => {
        if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
        toggleBreakpointAt(fileHere(), e.target.position?.lineNumber ?? null);
      }),
      editor.onDidChangeModel(() => {
        debugDecorations = [];
        paintDebug();
      }),
      { dispose: useDebugStore.subscribe(paintDebug) }
    );

    // DeepWiki: right-click a symbol, See Wiki (also in the palette).
    disposablesRef.current.push(
      editor.addAction({
        id: "fahh.seeWiki",
        label: "See Wiki",
        contextMenuGroupId: "navigation",
        contextMenuOrder: 0.5,
        run: (ed) => {
          const pos = ed.getPosition();
          const word = pos ? ed.getModel()?.getWordAtPosition(pos)?.word : undefined;
          if (word) void seeWiki(word);
        },
      })
    );

    // Python and Rust have no built-in Monaco linter: check their syntax so errors underline and fahh.
    disposablesRef.current.push(attachSyntaxCheck(monaco, editor));

    // Track cursor position for the status bar
    const updateCursor = () => {
      const pos = editor.getPosition();
      const m = editor.getModel();
      if (pos && m) {
        useEditorStore.getState().setCursorPosition(pos.lineNumber, pos.column, m.getLineCount());
      }
    };
    updateCursor();
    disposablesRef.current.push(
      editor.onDidChangeCursorPosition((e) => {
        updateCursor();
        // Back / forward history; a content flush or marker recovery is not the user moving.
        const file = path ?? useEditorStore.getState().activeTab;
        if (file && e.reason !== 1 && e.reason !== 2 && isCurrent()) recordCursor(file, e.position.lineNumber, e.position.column);
      })
    );

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
          /* Docked splits share one model; tabActions.forceClose disposes it when the file closes. */
          keepCurrentModel={!!dock}
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
            fontFamily,
            fontWeight,
            lineHeight: lineHeight ?? Math.round(fontSize * 1.55),
            letterSpacing: 0.3,
            minimap: { enabled: minimapEnabled },
            scrollBeyondLastLine: false,
            wordWrap,
            lineNumbers: lineNumbersOpt,
            ...extraOptions,
            tabSize,
            insertSpaces,
            automaticLayout: true,
            smoothScrolling: true,
            cursorBlinking: "phase",
            renderLineHighlight: "all",
            glyphMargin: true,
            padding: { top: 8 },
            readOnly: previewOnly,
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
