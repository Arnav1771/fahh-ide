/**
 * Quick Open (Ctrl+P): every file in the opened folder as a flat list, the way
 * VS Code's file picker sees it. Build output and dependency folders are left
 * out (VS Code's search.exclude / files.exclude defaults do the same).
 */

export interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: TreeNode[] | null;
}

export interface QuickOpenFile {
  path: string;
  name: string;
  /** Folder relative to the root, "" for files at the top level. */
  folder: string;
}

export const QUICK_OPEN_SKIP = new Set(["node_modules", ".git", "target", "dist", "build", ".next", "__pycache__", ".venv", "venv"]);

export function flattenTree(root: TreeNode | null, limit = 10_000): QuickOpenFile[] {
  if (!root) return [];
  const out: QuickOpenFile[] = [];
  const rootPath = root.path.replace(/[\\/]+$/, "");
  const walk = (node: TreeNode) => {
    for (const child of node.children ?? []) {
      if (out.length >= limit) return;
      if (child.is_dir) {
        if (!QUICK_OPEN_SKIP.has(child.name)) walk(child);
      } else {
        const rel = child.path.startsWith(rootPath) ? child.path.slice(rootPath.length).replace(/^[\\/]/, "") : child.path;
        const cut = Math.max(rel.lastIndexOf("/"), rel.lastIndexOf("\\"));
        out.push({ path: child.path, name: child.name, folder: cut > 0 ? rel.slice(0, cut) : "" });
      }
    }
  };
  walk(root);
  return out;
}
