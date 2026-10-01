import { useEffect, useRef } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import { useEditorStore } from "../../store/editorStore";
import { useFahhStore } from "../../store/fahhStore";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { TitleScreen } from "../Fahh/TitleScreen";
import { writeFile } from "../../lib/tauri";
import { defineMonacoThemes } from "../ThemePanel";
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

interface EditorPaneProps {
  /** Monaco editor theme name — pass from themeStore to keep in sync */
  monacoTheme?: string;
}

// Shape of the detail emitted by ThemePanel's fahh-theme-change event.
interface ThemeChangeDetail {
  monacoTheme: string;
}

export function EditorPane({ monacoTheme = "vs-dark" }: EditorPaneProps) {
  const { activeTab, fileContents, openTabs, setContent, markDirty } =
    useEditorStore();
    

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const disposablesRef = useRef<{ dispose(): void }[]>([]);
  const settleRef = useRef<number | undefined>(undefined);
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

  // Never let the bridge hold a reference to a disposed editor.
  useEffect(() => {
    return () => {
      detachMonaco();
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
    markDirty(activeTab, true);
  };

  const handleSave = async () => {
    if (!activeTab) return;
    try {
      await writeFile(activeTab, content);
      markDirty(activeTab, false);
    } catch (err) {
      console.error("save failed:", err);
    }
  };

  const handleEditorDidMount = (
    editor: Parameters<NonNullable<React.ComponentProps<typeof Editor>["onMount"]>>[0],
    monaco: Monaco
  ) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // The custom themes are registered in beforeMount; apply the chosen one
    // again now, in case Monaco fell back while the editor was being created.
    monaco.editor.setTheme(monacoTheme);

    // Hand the live editor to the diagnostics bridge. Anything LSP published
    // before Monaco mounted is flushed onto the model immediately.
    attachMonaco(monaco, editor);
    setActiveDocument(activeTab);

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
      editor.onDidChangeModel(() => {
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
    <div className="flex-1 flex min-h-0 relative">
      {/* The text editor stays mounted (hidden) when the preview replaces it,
          so the diagnostics bridge never holds a disposed editor. */}
      <div
        id="monaco-container"
        className="flex-1 flex flex-col min-h-0 min-w-0 relative"
        style={mode === "only" ? { display: "none" } : undefined}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            handleSave();
          }
        }}
      >
        <Editor
          height="100%"
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
