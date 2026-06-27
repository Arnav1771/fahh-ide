import { useEffect, useRef } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import { useEditorStore } from "../../store/editorStore";
import { writeFile } from "../../lib/tauri";
import { defineMonacoThemes } from "../ThemePanel";

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

  const activeDoc = openTabs.find((t) => t.path === activeTab);
  const content = activeTab ? fileContents[activeTab] ?? "" : "";

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

  if (!activeTab) {
    return (
      <div className="flex-1 flex items-center justify-center text-fahh-muted select-none">
        <div className="text-center">
          <p className="text-4xl mb-3">🤙</p>
          <p className="text-lg font-mono">Open a file to start editing</p>
          <p className="text-sm mt-1 opacity-60">fahh editor — make code, hear the vibe</p>
        </div>
      </div>
    );
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
    // Register custom Monaco themes so GitHub Dark, Dracula, Solarized
    // are available for setTheme() calls from the theme switcher
    defineMonacoThemes(monaco);
  };

  return (
    <div
      id="monaco-container"
      className="flex-1 flex flex-col min-h-0"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
          e.preventDefault();
          handleSave();
        }
      }}
    >
      <Editor
        height="100%"
        language={activeDoc?.language ?? "plaintext"}
        value={content}
        onChange={handleChange}
        theme={monacoTheme}
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
        }}
      />
    </div>
  );
}
