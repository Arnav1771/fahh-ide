import { useEffect, useRef, useState } from "react";
import type { FileEntry } from "../../lib/types";
import { useFileStore } from "../../store/fileStore";
import { useEditorStore } from "../../store/editorStore";
import { useToastStore } from "../../store/toastStore";
import { confirmDialog } from "../../store/dialogStore";
import { useWorkspace } from "../../hooks/useWorkspace";
import { createDir, createFile, deleteFile, getFileTree, movePath, renameFile, revealPath } from "../../lib/tauri";
import { open } from "@tauri-apps/plugin-dialog";
import { closeTabsUnder, dirtyPaths, renameTabs } from "../../lib/tabActions";
import { canDrop } from "../../lib/tabs";
import { parentDir } from "../../lib/openRequest";
import { runCommand } from "../../lib/commands";
import { ChevronsDownUp, Copy, Edit2, ExternalLink, File, FilePlus, Folder, FolderOpen, FolderPlus, RefreshCw, Trash2 } from "lucide-react";
import { FileIcon, FolderIcon } from "../../lib/iconTheme";
import { ContextMenu, type MenuEntry } from "../ContextMenu";

type NewKind = "file" | "folder";
interface NewEntry {
  parent: string;
  kind: NewKind;
}

const toast = (text: string, kind: "ok" | "error" = "ok") => useToastStore.getState().show(text, kind);
const joinPath = (dir: string, name: string) => dir + (dir.includes("\\") && !dir.includes("/") ? "\\" : "/") + name;

// ─── Inline name input (New File / New Folder) ───────────────────────────────

function NewEntryInput({ kind, depth, onSubmit, onDismiss }: { kind: NewKind; depth: number; onSubmit: (name: string) => void; onDismiss: () => void }) {
  const [name, setName] = useState("");
  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5" style={{ paddingLeft: `${8 + depth * 12}px` }}>
      <span className="flex items-center justify-center shrink-0 w-4 text-fahh-muted">{kind === "folder" ? <Folder size={14} /> : <File size={14} />}</span>
      <input
        autoFocus
        value={name}
        aria-label={kind === "folder" ? "New folder name" : "New file name"}
        onChange={(e) => setName(e.target.value)}
        placeholder={kind === "folder" ? "folder name" : "filename.ts"}
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.stopPropagation();
            onSubmit(name.trim());
          } else if (e.key === "Escape") {
            e.stopPropagation();
            onDismiss();
          }
        }}
        onBlur={onDismiss}
        className="flex-1 bg-fahh-surface text-fahh-text text-xs px-1 py-0 rounded outline-none border border-fahh-accent font-mono"
      />
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
  newEntry: NewEntry | null;
  onNewSubmit: (parent: string, name: string, kind: NewKind) => void;
  onNewDismiss: () => void;
  /** Bumped by Collapse All. */
  collapseEpoch: number;
  /** The folder a drag is over (highlighted). */
  dropDir: string | null;
  onDragStart: (e: React.PointerEvent, entry: FileEntry) => void;
  /** True right after a drag ended on this row, so the click that follows does nothing. */
  dragJustEnded: () => boolean;
}

function FileNode(props: FileNodeProps) {
  const { entry, depth = 0, onContextMenu, renamingPath, onRenameSubmit, onRenameDismiss, newEntry, onNewSubmit, onNewDismiss, collapseEpoch, dropDir, onDragStart, dragJustEnded } = props;
  const [expanded, setExpanded] = useState(depth < 2);
  const [renameValue, setRenameValue] = useState(entry.name);
  const { openFileInEditor } = useWorkspace();
  const activeTab = useEditorStore((s) => s.activeTab);

  useEffect(() => {
    if (collapseEpoch) setExpanded(false);
  }, [collapseEpoch]);
  // A New File / New Folder inside this folder opens it.
  useEffect(() => {
    if (entry.is_dir && newEntry?.parent === entry.path) setExpanded(true);
  }, [entry.is_dir, entry.path, newEntry]);

  const isRenaming = renamingPath === entry.path;
  const handleClick = async () => {
    if (dragJustEnded()) return;
    try {
      if (entry.is_dir) setExpanded((p) => !p);
      else await openFileInEditor(entry.path);
    } catch (err) {
      console.error("Error opening file/dir:", err);
    }
  };

  const handleDoubleClick = () => {
    if (!entry.is_dir && entry.path === activeTab) {
      document.querySelector<HTMLTextAreaElement>(".monaco-editor textarea")?.focus();
    }
  };

  const icon = entry.is_dir ? <FolderIcon name={entry.name} open={expanded} /> : <FileIcon name={entry.name} />;
  const isDrop = entry.is_dir && dropDir === entry.path;

  return (
    <div>
      <div
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onPointerDown={(e) => !isRenaming && onDragStart(e, entry)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e, entry);
        }}
        data-drop-dir={entry.is_dir ? entry.path : parentDir(entry.path)}
        data-path={entry.path}
        className={`file-item flex items-center gap-1.5 px-2 py-0.5 cursor-pointer text-sm text-fahh-text rounded transition-colors ${
          isDrop ? "bg-fahh-accent/20 outline outline-1 outline-fahh-accent" : "hover:bg-fahh-surface"
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <span className="flex items-center justify-center shrink-0 w-4">{icon}</span>
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

      {entry.is_dir && expanded && newEntry?.parent === entry.path && (
        <NewEntryInput kind={newEntry.kind} depth={depth + 1} onSubmit={(name) => onNewSubmit(entry.path, name, newEntry.kind)} onDismiss={onNewDismiss} />
      )}

      {entry.is_dir && expanded && entry.children && (
        <div>
          {entry.children.map((child) => (
            <FileNode key={child.path} {...props} entry={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── FileTree root ────────────────────────────────────────────────────────────

export function FileTree() {
  const tree = useFileStore((s) => s.tree);
  const setTree = useFileStore((s) => s.setTree);
  const root = useFileStore((s) => s.root);
  const { openFolder, openFileInEditor } = useWorkspace();
  const [showPathInput, setShowPathInput] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const [isOpening, setIsOpening] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [newEntry, setNewEntry] = useState<NewEntry | null>(null);
  const [collapseEpoch, setCollapseEpoch] = useState(0);
  const [drag, setDrag] = useState<{ from: FileEntry; x: number; y: number; dir: string | null } | null>(null);
  const dragEndedAt = useRef(0);

  /** Read the folder again from disk (the toolbar button, and after every change made here). */
  const refresh = async () => {
    if (!tree) return;
    try {
      setTree(await getFileTree(tree.path));
    } catch (err) {
      toast(`Could not read ${tree.path}: ${String(err)}`, "error");
    }
  };

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
      // Native dialog unavailable (WSL, headless, etc.): show the path input
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

  // ── Rename, delete, new ────────────────────────────────────────────────────

  const handleRenameSubmit = async (entry: FileEntry, newName: string) => {
    setRenamingPath(null);
    if (!newName || newName === entry.name) return;
    const newPath = joinPath(parentDir(entry.path), newName);
    try {
      await renameFile(entry.path, newPath);
      renameTabs(entry.path, newPath);
      await refresh();
    } catch (err) {
      toast(`Could not rename ${entry.name}: ${String(err)}`, "error");
    }
  };

  const handleDelete = async (entry: FileEntry) => {
    const unsaved = dirtyPaths(entry.path).length;
    const ok = await confirmDialog({
      title: `Delete "${entry.name}"?`,
      message:
        "This cannot be undone." +
        (unsaved ? `\n\n${unsaved === 1 ? "An open tab has" : `${unsaved} open tabs have`} unsaved changes that will be lost.` : ""),
      ok: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteFile(entry.path);
      closeTabsUnder(entry.path);
      await refresh();
    } catch (err) {
      toast(`Could not delete ${entry.name}: ${String(err)}`, "error");
    }
  };

  /** New File / New Folder: in the folder itself, or next to the file. */
  const startNew = (entry: FileEntry | null, kind: NewKind) => {
    if (!tree) {
      if (kind === "file") runCommand("file.new"); // no folder open: an untitled buffer, like File > New File
      return;
    }
    setNewEntry({ parent: entry ? (entry.is_dir ? entry.path : parentDir(entry.path)) : tree.path, kind });
  };

  const handleNewSubmit = async (parent: string, name: string, kind: NewKind) => {
    setNewEntry(null);
    if (!name) return;
    if (/(^|[\\/])\.\.([\\/]|$)/.test(name)) return toast("A name cannot climb out of the folder (..)", "error");
    const path = joinPath(parent, name);
    try {
      if (kind === "folder") await createDir(path);
      else await createFile(path);
    } catch (err) {
      return toast(`Could not create ${name}: ${String(err)}`, "error");
    }
    await refresh();
    if (kind === "file") await openFileInEditor(path);
  };

  // ── Drag and drop (pointer events: the webview's HTML5 drag is taken by the OS file drop) ──

  const startDrag = (e: React.PointerEvent, entry: FileEntry) => {
    if (e.button !== 0 || !tree) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let dragging = false;
    let dir: string | null = null;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      dragging = true;
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-drop-dir]");
      const target = el?.dataset.dropDir ?? null;
      dir = target !== null && canDrop(entry.path, target) ? target : null;
      setDrag({ from: entry, x: ev.clientX, y: ev.clientY, dir });
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("keydown", esc, true);
      if (!dragging) return;
      dragEndedAt.current = Date.now();
      setDrag(null);
      if (dir) void moveInto(entry, dir);
    };
    const esc = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      dir = null;
      up();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("keydown", esc, true);
  };

  const moveInto = async (entry: FileEntry, dir: string) => {
    try {
      const to = await movePath(entry.path, dir);
      renameTabs(entry.path, to); // open tabs follow, like a rename
      await refresh();
      toast(`Moved ${entry.name} to ${dir.split(/[\\/]/).filter(Boolean).pop() ?? dir}`);
    } catch (err) {
      toast(`Could not move ${entry.name}: ${String(err)}`, "error");
    }
  };

  const menuItems = (entry: FileEntry): MenuEntry[] => {
    const isRoot = entry.path === tree?.path;
    return [
      ...(!entry.is_dir ? [{ label: "Open", icon: <FolderOpen size={14} />, action: () => void openFileInEditor(entry.path) }] : []),
      ...(!isRoot
        ? [
            { label: "Rename", icon: <Edit2 size={14} />, action: () => setRenamingPath(entry.path) },
            { label: "Delete", icon: <Trash2 size={14} />, action: () => void handleDelete(entry) },
          ]
        : []),
      { label: "Copy Path", icon: <Copy size={14} />, action: () => void navigator.clipboard.writeText(entry.path).catch(() => {}) },
      {
        label: "Copy Relative Path",
        action: () => void navigator.clipboard.writeText(root ? entry.path.slice(root.length).replace(/^[\\/]/, "") : entry.path).catch(() => {}),
      },
      { label: "Reveal in File Explorer", icon: <ExternalLink size={14} />, action: () => revealPath(entry.path).catch((e) => toast(String(e), "error")) },
      "separator",
      { label: "New File", icon: <FilePlus size={14} />, action: () => startNew(entry, "file") },
      { label: "New Folder", icon: <FolderPlus size={14} />, action: () => startNew(entry, "folder") },
      ...(isRoot ? ["separator" as const, { label: "Refresh", icon: <RefreshCw size={14} />, action: () => void refresh() }] : []),
    ];
  };

  const tool = "flex items-center text-fahh-muted hover:text-fahh-accent transition-colors disabled:opacity-40 px-1";

  return (
    <div className="flex flex-col h-full bg-fahh-sidebar overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold text-fahh-muted uppercase tracking-wider shrink-0">
        <span className="fahh-label truncate">Explorer</span>
        <div className="flex gap-0.5 shrink-0">
          <button type="button" onClick={() => startNew(null, "file")} className={tool} title="New File" aria-label="New file">
            <FilePlus size={14} />
          </button>
          <button type="button" onClick={() => startNew(null, "folder")} disabled={!tree} className={tool} title="New Folder" aria-label="New folder">
            <FolderPlus size={14} />
          </button>
          <button type="button" onClick={() => void refresh()} disabled={!tree} className={tool} title="Refresh Explorer" aria-label="Refresh explorer">
            <RefreshCw size={13} />
          </button>
          <button type="button" onClick={() => setCollapseEpoch((n) => n + 1)} disabled={!tree} className={tool} title="Collapse Folders" aria-label="Collapse all folders">
            <ChevronsDownUp size={14} />
          </button>
          <button type="button" onClick={handleOpenFolder} disabled={isOpening} className={tool} title="Open Folder" aria-label="Open folder">
            <FolderOpen size={14} />
          </button>
        </div>
      </div>

      {/* Path input fallback: shown when the native dialog is unavailable (WSL, etc.) */}
      {showPathInput && (
        <form onSubmit={handleManualPath} className="px-2 py-2 border-b border-fahh-surface shrink-0">
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
            <button type="submit" disabled={isOpening || !manualPath.trim()} className="px-2 py-1 bg-fahh-accent text-white text-xs rounded disabled:opacity-40">
              Open
            </button>
            <button type="button" onClick={() => setShowPathInput(false)} className="px-2 py-1 flex items-center text-fahh-muted hover:text-fahh-text text-xs">
              ✕
            </button>
          </div>
        </form>
      )}

      <div
        className={`flex-1 overflow-y-auto ${drag && drag.dir === tree?.path ? "bg-fahh-accent/10" : ""}`}
        data-drop-dir={tree?.path}
        onContextMenu={(e) => {
          if (!tree) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, entry: tree });
        }}
      >
        {tree ? (
          <>
            {newEntry?.parent === tree.path && (
              <NewEntryInput kind={newEntry.kind} depth={0} onSubmit={(name) => void handleNewSubmit(tree.path, name, newEntry.kind)} onDismiss={() => setNewEntry(null)} />
            )}
            {tree.children?.map((entry) => (
              <FileNode
                key={entry.path}
                entry={entry}
                depth={0}
                onContextMenu={(e, en) => setMenu({ x: e.clientX, y: e.clientY, entry: en })}
                renamingPath={renamingPath}
                onRenameSubmit={(en, name) => void handleRenameSubmit(en, name)}
                onRenameDismiss={() => setRenamingPath(null)}
                newEntry={newEntry}
                onNewSubmit={(parent, name, kind) => void handleNewSubmit(parent, name, kind)}
                onNewDismiss={() => setNewEntry(null)}
                collapseEpoch={collapseEpoch}
                dropDir={drag?.dir ?? null}
                onDragStart={startDrag}
                dragJustEnded={() => Date.now() - dragEndedAt.current < 300}
              />
            ))}
          </>
        ) : (
          <div className="px-3 py-4 text-xs text-fahh-muted text-center">
            <p>No folder open</p>
            <button onClick={handleOpenFolder} className="mt-2 text-fahh-accent hover:underline">
              Open Folder
            </button>
          </div>
        )}
      </div>

      {drag && (
        <div className="pointer-events-none fixed z-[1000] rounded border border-fahh-accent bg-fahh-sidebar px-2 py-0.5 text-xs text-fahh-text shadow-lg" style={{ left: drag.x + 12, top: drag.y + 8 }}>
          {drag.from.name}
          {drag.dir ? "" : " (drop on a folder)"}
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.entry)} onClose={() => setMenu(null)} />}
    </div>
  );
}
