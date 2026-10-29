import { useEffect, useRef } from "react";
import { gitLineChanges } from "../../lib/tauri";
import { useFileStore } from "../../store/fileStore";
import { useGitStore } from "../../store/gitStore";

const CLASS = { added: "fahh-git-added", modified: "fahh-git-modified", deleted: "fahh-git-deleted" } as const;

/**
 * Git change bars in the gutter (added / modified / deleted against HEAD), like VS Code's.
 * Recomputed shortly after typing stops, on tab switch and after commits.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useGitGutter(editorRef: { current: any }, path: string | null, content: string, enabled: boolean) {
  const ids = useRef<string[]>([]);
  const root = useFileStore((s) => s.root);
  const isRepo = useGitStore((s) => s.status.is_repo);
  const head = useGitStore((s) => s.lastCommit);
  useEffect(() => {
    const editor = editorRef.current;
    const clear = () => {
      if (editor && ids.current.length) ids.current = editor.deltaDecorations(ids.current, []);
    };
    if (!editor || !enabled || !path || !root || !isRepo) return clear();
    let live = true;
    const t = window.setTimeout(() => {
      gitLineChanges(root, path, content)
        .then((changes) => {
          if (!live || editorRef.current !== editor) return;
          ids.current = editor.deltaDecorations(
            ids.current,
            changes.map((c) => ({
              range: { startLineNumber: c.start, startColumn: 1, endLineNumber: c.end, endColumn: 1 },
              options: { isWholeLine: true, linesDecorationsClassName: CLASS[c.kind] },
            }))
          );
        })
        .catch(() => clear());
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [editorRef, path, content, enabled, root, isRepo, head]);
}
