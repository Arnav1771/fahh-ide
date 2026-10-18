import { useCallback } from "react";
import { allowPreview, getFileTree, readFile } from "../lib/tauri";
import { isPreviewOnly } from "../lib/preview";
import { useFileStore } from "../store/fileStore";
import { useEditorStore } from "../store/editorStore";
import { useTerminalStore } from "../store/terminalStore";

export function useWorkspace() {
  const { setRoot, setTree } = useFileStore();
  const { openFile } = useEditorStore();
  const { setCwd } = useTerminalStore();

  const openFolder = useCallback(async (path: string) => {
    setRoot(path);
    setCwd(path);
    try {
      const tree = await getFileTree(path);
      setTree(tree);
      // Previews (Markdown images, pictures, HTML assets) may load from this folder.
      allowPreview(path).catch(() => {});
    } catch (err) {
      console.warn("getFileTree fallback for:", path, err);
      // Fallback single root entry so explorer still opens
      const folderName = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
      setTree({
        name: folderName,
        path,
        is_dir: true,
        children: [],
      });
    }
  }, [setRoot, setTree, setCwd]);

  const openFileInEditor = useCallback(async (path: string) => {
    // A picture is not text: it opens straight into its preview.
    if (isPreviewOnly(path)) {
      openFile({ path, language: "image", dirty: false }, "");
      return;
    }
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const langMap: Record<string, string> = {
      rs: "rust", ts: "typescript", tsx: "typescript",
      js: "javascript", jsx: "javascript", py: "python",
      json: "json", toml: "toml", md: "markdown",
      html: "html", htm: "html", css: "css", svg: "xml", csv: "plaintext", tsv: "plaintext",
      yml: "yaml", yaml: "yaml", c: "c", cpp: "cpp", h: "c", hpp: "cpp",
      sh: "shell", bat: "bat", ps1: "powershell", sql: "sql",
    };
    const language = langMap[ext] ?? "plaintext";

    try {
      const content = await readFile(path);
      openFile(
        { path, language, dirty: false },
        content ?? ""
      );
    } catch (err) {
      console.warn("Failed reading file content:", path, err);
      openFile(
        { path, language, dirty: false },
        ""
      );
    }
  }, [openFile]);

  return { openFolder, openFileInEditor };
}
