import { useCallback } from "react";
import { getFileTree, readFile } from "../lib/tauri";
import { useFileStore } from "../store/fileStore";
import { useEditorStore } from "../store/editorStore";

export function useWorkspace() {
  const { setRoot, setTree } = useFileStore();
  const { openFile } = useEditorStore();

  const openFolder = useCallback(async (path: string) => {
    setRoot(path);
    const tree = await getFileTree(path);
    setTree(tree);
  }, [setRoot, setTree]);

  const openFileInEditor = useCallback(async (path: string) => {
    const content = await readFile(path);
    const ext = path.split(".").pop() ?? "";
    const langMap: Record<string, string> = {
      rs: "rust", ts: "typescript", tsx: "typescript",
      js: "javascript", jsx: "javascript", py: "python",
      json: "json", toml: "toml", md: "markdown",
      html: "html", css: "css",
    };
    openFile(
      { path, language: langMap[ext] ?? "plaintext", dirty: false },
      content
    );
  }, [openFile]);

  return { openFolder, openFileInEditor };
}
