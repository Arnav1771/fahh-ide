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

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === "string") {
      await openFolder(selected);
    }
  };

  return (
    <div className="flex flex-col h-full bg-fahh-sidebar overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold text-fahh-muted uppercase tracking-wider shrink-0">
        <span>Explorer</span>
        <button
          onClick={handleOpenFolder}
          className="text-fahh-muted hover:text-fahh-accent transition-colors"
          title="Open Folder"
        >
          +
        </button>
      </div>
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
