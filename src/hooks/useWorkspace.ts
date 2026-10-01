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
    const tree = await getFileTree(path);
    setTree(tree);
    // Previews (Markdown images, pictures, HTML assets) may load from this folder.
    allowPreview(path).catch(() => {});
  }, [setRoot, setTree, setCwd]);

  const openFileInEditor = useCallback(async (path: string) => {
    // A picture is not text: it opens straight into its preview.
    if (isPreviewOnly(path)) {
      openFile({ path, language: "image", dirty: false }, "");
      return;
    }
    const content = await readFile(path);
    const ext = path.split(".").pop() ?? "";
    const langMap: Record<string, string> = {
      rs: "rust", ts: "typescript", tsx: "typescript",
      js: "javascript", jsx: "javascript", py: "python",
      json: "json", toml: "toml", md: "markdown",
      html: "html", htm: "html", css: "css", svg: "xml", csv: "plaintext", tsv: "plaintext",
    };
    openFile(
      { path, language: langMap[ext] ?? "plaintext", dirty: false },
      content
    );
  }, [openFile]);

  return { openFolder, openFileInEditor };
}
