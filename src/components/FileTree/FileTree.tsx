import { useEffect, useRef, useState } from "react";
import type { FileEntry } from "../../lib/types";
import { useFileStore } from "../../store/fileStore";
import { useEditorStore } from "../../store/editorStore";
import { useWorkspace } from "../../hooks/useWorkspace";
import { deleteFile, renameFile, createFile } from "../../lib/tauri";
import { open } from "@tauri-apps/plugin-dialog";

// ─── Context menu ─────────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

interface ContextMenuProps {
  menu: ContextMenuState;
  onClose: () => void;
  onOpen: (entry: FileEntry) => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onCopyPath: (entry: FileEntry) => void;
  onNewFile: (entry: FileEntry) => void;
}

function ContextMenu({
  menu,
  onClose,
  onOpen,
  onRename,
  onDelete,
  onCopyPath,
  onNewFile,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss on click outside or Escape
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const item = (icon: string, label: string, onClick: () => void) => (
    <button
      key={label}
      onClick={() => { onClick(); onClose(); }}
      className="flex items-center gap-2 px-3 py-1.5 text-xs text-[#cdd6f4] hover:bg-[#313244] cursor-pointer w-full text-left transition-colors"
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );

  return (
    <div
      ref={ref}
      style={{ left: menu.x, top: menu.y }}
      className="fixed bg-[#1e1e2e] border border-[#313244] rounded shadow-xl py-1 z-50 min-w-[160px]"
    >
      {item("📂", "Open", () => onOpen(menu.entry))}
      {item("✏️", "Rename", () => onRename(menu.entry))}
      {item("🗑️", "Delete", () => onDelete(menu.entry))}
      {item("📋", "Copy Path", () => onCopyPath(menu.entry))}
      <div className="border-t border-[#313244] my-1" />
      {item("➕", "New File", () => onNewFile(menu.entry))}
    </div>
  );
}

// ─── File node ────────────────────────────────────────────────────────────────

interface FileNodeProps {
  entry: FileEntry;
  depth?: number;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  renamingPath: string | null;
  onRenameSubmit: (entry: FileEntry, newName: string) => void;
  onRenameDismiss: () => void;
  newFileParentPath: string | null;
  onNewFileSubmit: (parentPath: string, name: string) => void;
  onNewFileDismiss: () => void;
}

function FileNode({
  entry,
  depth = 0,
  onContextMenu,
  renamingPath,
  onRenameSubmit,
  onRenameDismiss,
  newFileParentPath,
  onNewFileSubmit,
  onNewFileDismiss,
}: FileNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [renameValue, setRenameValue] = useState(entry.name);
  const [newFileName, setNewFileName] = useState("");
  const { openFileInEditor } = useWorkspace();
  const { activeTab } = useEditorStore();

  const isRenaming = renamingPath === entry.path;
  const isNewFileTarget =
    newFileParentPath !== null &&
    (entry.is_dir
      ? newFileParentPath === entry.path
      : newFileParentPath === entry.path);

  const handleClick = async () => {
    if (entry.is_dir) {
      setExpanded((p) => !p);
    } else {
      await openFileInEditor(entry.path);
    }
  };

  const handleDoubleClick = () => {
    if (!entry.is_dir && entry.path === activeTab) {
      // Focus Monaco editor textarea
      const container = document.getElementById("monaco-container");
      if (container) {
        const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
        textarea?.focus();
      } else {
        // Fallback: find any monaco textarea on the page
        const textarea = document.querySelector<HTMLTextAreaElement>(
          ".monaco-editor textarea"
        );
        textarea?.focus();
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, entry);
  };

  const icon = entry.is_dir ? (expanded ? "▾" : "▸") : fileIcon(entry.name);

  return (
    <div>
      <div
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        className="file-item flex items-center gap-1 px-2 py-0.5 cursor-pointer text-sm text-fahh-text hover:bg-fahh-surface rounded transition-colors"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <span className="text-xs opacity-60 w-3 shrink-0">{icon}</span>

        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                onRenameSubmit(entry, renameValue.trim());
              } else if (e.key === "Escape") {
                e.stopPropagation();
                onRenameDismiss();
              }
            }}
            onBlur={() => onRenameDismiss()}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-fahh-surface text-fahh-text text-xs px-1 py-0 rounded outline-none border border-fahh-accent font-mono"
          />
        ) : (
          <span className="file-name truncate">{entry.name}</span>
        )}
      </div>

      {/* Inline new file input (shown under a directory) */}
      {entry.is_dir && isNewFileTarget && expanded && (
        <div
          className="flex items-center gap-1 px-2 py-0.5"
          style={{ paddingLeft: `${8 + (depth + 1) * 12}px` }}
        >
          <span className="text-xs opacity-60 w-3 shrink-0">📄</span>
          <input
            autoFocus
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            placeholder="filename.ts"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                onNewFileSubmit(entry.path, newFileName.trim());
                setNewFileName("");
              } else if (e.key === "Escape") {
                e.stopPropagation();
                onNewFileDismiss();
                setNewFileName("");
              }
            }}
            onBlur={() => {
              onNewFileDismiss();
              setNewFileName("");
            }}
            className="flex-1 bg-fahh-surface text-fahh-text text-xs px-1 py-0 rounded outline-none border border-fahh-accent font-mono"
          />
        </div>
      )}

      {entry.is_dir && expanded && entry.children && (
        <div>
          {entry.children.map((child) => (
            <FileNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              onRenameSubmit={onRenameSubmit}
              onRenameDismiss={onRenameDismiss}
              newFileParentPath={newFileParentPath}
              onNewFileSubmit={onNewFileSubmit}
              onNewFileDismiss={onNewFileDismiss}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── FileTree root ────────────────────────────────────────────────────────────

export function FileTree() {
  const { tree, setTree } = useFileStore();
  const { openFolder, openFileInEditor } = useWorkspace();
  const [showPathInput, setShowPathInput] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const [isOpening, setIsOpening] = useState(false);

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Rename state
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  // New-file inline input state
  const [newFileParentPath, setNewFileParentPath] = useState<string | null>(null);
  const [newFileInput, setNewFileInput] = useState("");

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

  // ── Context menu handlers ──────────────────────────────────────────────────

  const handleContextMenu = (e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const handleContextOpen = async (entry: FileEntry) => {
    if (entry.is_dir) {
      // Directories expand on click in the node; nothing extra needed here
    } else {
      await openFileInEditor(entry.path);
    }
  };

  const handleContextRename = (entry: FileEntry) => {
    setRenamingPath(entry.path);
  };

  const handleRenameSubmit = async (entry: FileEntry, newName: string) => {
    if (!newName || newName === entry.name) {
      setRenamingPath(null);
      return;
    }
    const dir = entry.path.substring(0, entry.path.lastIndexOf("/") + 1) ||
                entry.path.substring(0, entry.path.lastIndexOf("\\") + 1);
    const newPath = dir + newName;
    try {
      await renameFile(entry.path, newPath);
      // Refresh the tree from the root
      if (tree) {
        const { getFileTree } = await import("../../lib/tauri");
        const newTree = await getFileTree(tree.path);
        setTree(newTree);
      }
    } catch (err) {
      console.error("Rename failed:", err);
    }
    setRenamingPath(null);
  };

  const handleContextDelete = async (entry: FileEntry) => {
    const confirmed = window.confirm(
      `Delete "${entry.name}"? This cannot be undone.`
    );
    if (!confirmed) return;
    try {
      await deleteFile(entry.path);
      if (tree) {
        const { getFileTree } = await import("../../lib/tauri");
        const newTree = await getFileTree(tree.path);
        setTree(newTree);
      }
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleContextCopyPath = (entry: FileEntry) => {
    navigator.clipboard.writeText(entry.path).catch(console.error);
  };

  const handleContextNewFile = (entry: FileEntry) => {
    // If it's a file, create in the same directory; if dir, create inside it
    const parentPath = entry.is_dir
      ? entry.path
      : entry.path.substring(
          0,
          Math.max(
            entry.path.lastIndexOf("/"),
            entry.path.lastIndexOf("\\")
          )
        );
    setNewFileParentPath(parentPath);
  };

  const handleNewFileSubmit = async (parentPath: string, name: string) => {
    if (!name) {
      setNewFileParentPath(null);
      return;
    }
    const sep = parentPath.includes("/") ? "/" : "\\";
    const newPath = parentPath ? parentPath + sep + name : name;

    // Optimistically add to tree state so UI updates immediately
    // (works in browser-preview and native; disk write via Tauri may fail in browser)
    const newEntry: FileEntry = { name, path: newPath, is_dir: false };

    if (tree) {
      // Insert into the correct parent in the tree
      const insertInto = (node: FileEntry): FileEntry => {
        if (node.path === parentPath && node.is_dir) {
          return { ...node, children: [...(node.children ?? []), newEntry] };
        }
        return { ...node, children: node.children?.map(insertInto) };
      };
      setTree(parentPath ? insertInto(tree) : { ...tree, children: [...(tree.children ?? []), newEntry] });
    } else {
      // No open folder — create a virtual root so the file appears
      setTree({ name: "workspace", path: "", is_dir: true, children: [newEntry] });
    }

    // Attempt actual disk write (fails gracefully in browser-preview)
    try {
      await createFile(newPath);
      // If write succeeded, refresh from disk for accurate state
      if (tree) {
        const { getFileTree } = await import("../../lib/tauri");
        const newTree = await getFileTree(tree.path);
        setTree(newTree);
      }
      await openFileInEditor(newPath);
    } catch {
      // Browser-preview: disk write unavailable — tree still updated optimistically above
      await openFileInEditor(newPath).catch(() => {});
    }
    setNewFileParentPath(null);
  };

  return (
    <div className="flex flex-col h-full bg-fahh-sidebar overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold text-fahh-muted uppercase tracking-wider shrink-0">
        <span>Explorer</span>
        <div className="flex gap-1">
          <button
            onClick={() => setNewFileParentPath(tree?.path ?? "")}
            className="text-fahh-muted hover:text-fahh-accent transition-colors px-1"
            title="New file"
          >
            📄
          </button>
          <button
            onClick={handleOpenFolder}
            disabled={isOpening}
            className="text-fahh-muted hover:text-fahh-accent transition-colors disabled:opacity-40 px-1"
            title="Open Folder"
          >
            {isOpening ? "…" : "📁"}
          </button>
        </div>
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
            <FileNode
              key={entry.path}
              entry={entry}
              depth={0}
              onContextMenu={handleContextMenu}
              renamingPath={renamingPath}
              onRenameSubmit={handleRenameSubmit}
              onRenameDismiss={() => setRenamingPath(null)}
              newFileParentPath={newFileParentPath}
              onNewFileSubmit={handleNewFileSubmit}
              onNewFileDismiss={() => setNewFileParentPath(null)}
            />
          ))
        ) : (
          <div className="px-3 py-4 text-xs text-fahh-muted text-center">
            {/* Inline new-file input when no folder is open */}
            {newFileParentPath !== null && (
              <form
                onSubmit={(e) => { e.preventDefault(); handleNewFileSubmit("", newFileInput); setNewFileInput(""); setNewFileParentPath(null); }}
                className="mb-3 flex gap-1"
              >
                <input
                  type="text"
                  value={newFileInput}
                  onChange={(e) => setNewFileInput(e.target.value)}
                  placeholder="filename.ts"
                  autoFocus
                  spellCheck={false}
                  onKeyDown={(e) => { if(e.key==="Escape") { setNewFileParentPath(null); setNewFileInput(""); }}}
                  className="flex-1 bg-fahh-surface text-fahh-text text-xs px-2 py-1 rounded outline-none border border-fahh-accent font-mono"
                />
                <button type="submit" className="px-2 py-1 bg-fahh-accent text-white text-xs rounded">✓</button>
              </form>
            )}
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

      {/* Context menu portal */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onOpen={handleContextOpen}
          onRename={handleContextRename}
          onDelete={handleContextDelete}
          onCopyPath={handleContextCopyPath}
          onNewFile={handleContextNewFile}
        />
      )}
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
