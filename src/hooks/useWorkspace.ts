import { useCallback } from "react";
import { allowPreview, getFileTree, readFile } from "../lib/tauri";
import { isPreviewOnly } from "../lib/preview";
import { languageFor } from "../lib/tabs";
import { addRecent } from "../lib/recent";
import { useFileStore } from "../store/fileStore";
import { useEditorStore } from "../store/editorStore";
import { useTerminalStore } from "../store/terminalStore";

export function useWorkspace() {
  const setRoot = useFileStore((s) => s.setRoot);
  const setTree = useFileStore((s) => s.setTree);
  const setCwd = useTerminalStore((s) => s.setCwd);

  const openFolder = useCallback(async (path: string) => {
    setRoot(path);
    setCwd(path);
    const folderName = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
    import("@tauri-apps/api/webviewWindow")
      .then(({ getCurrentWebviewWindow }) => {
        getCurrentWebviewWindow().setTitle(`Fahh Editor — ${folderName}`).catch(() => {});
      })
      .catch(() => {});

    try {
      const tree = await getFileTree(path);
      setTree(tree);
      addRecent({ path, kind: "folder" }); // File > Open Recent, and what the next launch reopens
      // Previews (Markdown images, pictures, HTML assets) may load from this folder.
      allowPreview(path).catch(() => {});
    } catch (err) {
      console.warn("getFileTree fallback for:", path, err);
      // Fallback single root entry so explorer still opens
      setTree({
        name: folderName,
        path,
        is_dir: true,
        children: [],
      });
    }
  }, [setRoot, setTree, setCwd]);

  return { openFolder, openFileInEditor: openFilePath };
}

/**
 * Open a file in the editor, or switch to its tab when it is already open (re-reading it
 * would replace unsaved changes with what is on disk).
 */
export async function openFilePath(path: string): Promise<void> {
  const { openTabs, openFile, setActiveTab } = useEditorStore.getState();
  if (openTabs.some((t) => t.path === path)) return setActiveTab(path);
  // A picture is not text: it opens straight into its preview.
  if (isPreviewOnly(path)) return openFile({ path, language: "image", dirty: false }, "");
  const language = languageFor(path);
  try {
    openFile({ path, language, dirty: false }, (await readFile(path)) ?? "");
  } catch (err) {
    console.warn("Failed reading file content:", path, err);
    openFile({ path, language, dirty: false }, "");
  }
}
