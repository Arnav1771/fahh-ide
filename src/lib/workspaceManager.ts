import { useEditorStore } from "../store/editorStore";
import { useFileStore } from "../store/fileStore";
import { useThemeStore } from "../store/themeStore";
import { useToastStore } from "../store/toastStore";
import { readFile, writeFile } from "./tauri";

export interface FahhWorkspaceConfig {
  fahh: string;
  name?: string;
  root: string | null;
  folders: Array<{ path: string; name: string }>;
  openTabs: Array<{ path: string; language?: string; active?: boolean }>;
  settings: {
    autoSave: boolean;
    theme: string;
  };
}

/** Gather current state and export as a workspace object */
export function serializeWorkspace(): FahhWorkspaceConfig {
  const root = useFileStore.getState().root;
  const { openTabs, activeTab, autoSave } = useEditorStore.getState();
  const theme = useThemeStore.getState().activeTheme;

  const folderName = root ? root.split(/[\\/]/).filter(Boolean).pop() ?? "Workspace" : "Untitled Workspace";

  return {
    fahh: __APP_VERSION__,
    name: folderName,
    root,
    folders: root ? [{ path: root, name: folderName }] : [],
    openTabs: openTabs.map((t) => ({
      path: t.path,
      language: t.language,
      active: t.path === activeTab,
    })),
    settings: {
      autoSave,
      theme,
    },
  };
}

/** Prompt the user to save the current workspace configuration to disk */
export async function saveWorkspaceAs(): Promise<boolean> {
  const data = serializeWorkspace();
  const json = JSON.stringify(data, null, 2);
  const defaultFileName = `${(data.name || "workspace").replace(/[^\w.-]+/g, "_")}.fahh-workspace`;

  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const targetPath = await save({
      defaultPath: defaultFileName,
      filters: [
        { name: "Fahh Workspace", extensions: ["fahh-workspace", "code-workspace", "json"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (!targetPath) return false;

    await writeFile(targetPath, json);
    useToastStore.getState().show(`Workspace saved: ${targetPath.split(/[\\/]/).pop()}`);
    return true;
  } catch {
    // Web fallback: download as file
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = defaultFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      useToastStore.getState().show(`Workspace exported: ${defaultFileName}`);
      return true;
    } catch (err) {
      useToastStore.getState().show(`Failed to save workspace: ${String(err)}`, "error");
      return false;
    }
  }
}

/** Prompt the user to pick a workspace file and load its configuration */
export async function openWorkspaceFromFile(
  openFolderFn: (folder: string) => Promise<void>,
  openFileFn: (file: string) => Promise<void>
): Promise<boolean> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        { name: "Fahh Workspace", extensions: ["fahh-workspace", "code-workspace", "json"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (!selected || typeof selected !== "string") return false;

    const content = await readFile(selected);
    return await applyWorkspaceConfig(content, openFolderFn, openFileFn);
  } catch {
    // Web fallback: file input
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".fahh-workspace,.code-workspace,.json";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(false);
          return;
        }
        try {
          const text = await file.text();
          const ok = await applyWorkspaceConfig(text, openFolderFn, openFileFn);
          resolve(ok);
        } catch (e) {
          useToastStore.getState().show(`Error reading workspace file: ${String(e)}`, "error");
          resolve(false);
        }
      };
      input.click();
    });
  }
}

/** Parse and apply workspace settings, open folder, and restore open tabs */
export async function applyWorkspaceConfig(
  rawJson: string,
  openFolderFn: (folder: string) => Promise<void>,
  openFileFn: (file: string) => Promise<void>
): Promise<boolean> {
  try {
    const parsed = JSON.parse(rawJson);
    const root = parsed.root || parsed.folders?.[0]?.path;

    // Apply settings
    if (parsed.settings?.autoSave !== undefined) {
      useEditorStore.getState().setAutoSave(!!parsed.settings.autoSave);
    }
    if (parsed.settings?.theme) {
      useThemeStore.getState().setTheme(parsed.settings.theme);
    }

    // Open root folder if present
    if (root) {
      await openFolderFn(root);
    }

    // Restore tabs
    if (Array.isArray(parsed.openTabs)) {
      for (const tab of parsed.openTabs) {
        if (tab.path) {
          try {
            await openFileFn(tab.path);
          } catch {
            // Tab file might have moved
          }
        }
      }
      const active = parsed.openTabs.find((t: any) => t.active);
      if (active?.path) {
        useEditorStore.getState().setActiveTab(active.path);
      }
    }

    useToastStore.getState().show("Workspace loaded successfully");
    return true;
  } catch (err) {
    useToastStore.getState().show(`Failed to parse workspace config: ${String(err)}`, "error");
    return false;
  }
}
