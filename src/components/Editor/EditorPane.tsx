import Editor from "@monaco-editor/react";
import { useEditorStore } from "../../store/editorStore";
import { writeFile } from "../../lib/tauri";

export function EditorPane() {
  const { activeTab, fileContents, openTabs, setContent, markDirty } =
    useEditorStore();

  const activeDoc = openTabs.find((t) => t.path === activeTab);
  const content = activeTab ? fileContents[activeTab] ?? "" : "";

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

  return (
    <div className="flex-1 flex flex-col min-h-0" onKeyDown={(e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    }}>
      <Editor
        height="100%"
        language={activeDoc?.language ?? "plaintext"}
        value={content}
        onChange={handleChange}
        theme="vs-dark"
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
