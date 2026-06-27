import { useState } from "react";
import type { FileEntry } from "../../lib/types";
import { useFileStore } from "../../store/fileStore";
import { useWorkspace } from "../../hooks/useWorkspace";
import { open } from "@tauri-apps/plugin-dialog";

function FileNode({
  entry,
  depth = 0,
}: {
  entry: FileEntry;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const { openFileInEditor } = useWorkspace();

  const handleClick = async () => {
    if (entry.is_dir) {
      setExpanded((p) => !p);
    } else {
      await openFileInEditor(entry.path);
    }
  };

  const icon = entry.is_dir ? (expanded ? "▾" : "▸") : fileIcon(entry.name);

  return (
    <div>
      <div
        onClick={handleClick}
        className="flex items-center gap-1 px-2 py-0.5 cursor-pointer text-sm text-fahh-text hover:bg-fahh-surface rounded transition-colors"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <span className="text-xs opacity-60 w-3 shrink-0">{icon}</span>
        <span className="truncate">{entry.name}</span>
      </div>
      {entry.is_dir && expanded && entry.children && (
        <div>
          {entry.children.map((child) => (
            <FileNode key={child.path} entry={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree() {
  const { tree } = useFileStore();
  const { openFolder } = useWorkspace();
  const [showPathInput, setShowPathInput] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const [isOpening, setIsOpening] = useState(false);

  const handleOpenFolder = async () => {
    setIsOpening(true);
    try {
      const selected = await open({ directory: true, multiple: false });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (path) {
        await openFolder(path);
        setShowPathInput(false);
      }
    } catch {
      // Native dialog unavailable (WSL, headless, etc.) — show path input
      setShowPathInput(true);
    } finally {
      setIsOpening(false);
    }
  };

  const handleManualPath = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = manualPath.trim();
    if (!p) return;
    setIsOpening(true);
    try {
      await openFolder(p);
      setShowPathInput(false);
      setManualPath("");
    } catch (err) {
      console.error("Failed to open folder:", err);
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-fahh-sidebar overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold text-fahh-muted uppercase tracking-wider shrink-0">
        <span>Explorer</span>
        <button
          onClick={handleOpenFolder}
          disabled={isOpening}
          className="text-fahh-muted hover:text-fahh-accent transition-colors disabled:opacity-40"
          title="Open Folder"
        >
          {isOpening ? "…" : "+"}
        </button>
      </div>

      {/* Path input fallback — shown when native dialog is unavailable (WSL, etc.) */}
      {showPathInput && (
        <form
          onSubmit={handleManualPath}
          className="px-2 py-2 border-b border-fahh-surface shrink-0"
        >
          <p className="text-xs text-fahh-muted mb-1">Enter folder path:</p>
          <div className="flex gap-1">
            <input
              type="text"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="/home/user/project"
              className="flex-1 bg-fahh-surface text-fahh-text text-xs px-2 py-1 rounded outline-none border border-fahh-surface focus:border-fahh-accent font-mono"
              autoFocus
              spellCheck={false}
            />
            <button
              type="submit"
              disabled={isOpening || !manualPath.trim()}
              className="px-2 py-1 bg-fahh-accent text-white text-xs rounded disabled:opacity-40"
            >
              Open
            </button>
            <button
              type="button"
              onClick={() => setShowPathInput(false)}
              className="px-2 py-1 text-fahh-muted hover:text-fahh-text text-xs"
            >
              ✕
            </button>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-y-auto">
        {tree ? (
          tree.children?.map((entry) => (
            <FileNode key={entry.path} entry={entry} depth={0} />
          ))
        ) : (
          <div className="px-3 py-4 text-xs text-fahh-muted text-center">
            <p>No folder open</p>
            <button
              onClick={handleOpenFolder}
              className="mt-2 text-fahh-accent hover:underline"
            >
              Open Folder
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function fileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const icons: Record<string, string> = {
    rs: "🦀", ts: "📘", tsx: "⚛", js: "📜", jsx: "⚛",
    py: "🐍", json: "📋", toml: "⚙", md: "📝",
    html: "🌐", css: "🎨", sh: "💻", yaml: "📄", yml: "📄",
  };
  return icons[ext] ?? "📄";
}
