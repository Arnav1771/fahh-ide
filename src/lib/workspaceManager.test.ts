import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyWorkspaceConfig, serializeWorkspace } from "./workspaceManager";
import { useEditorStore } from "../store/editorStore";
import { useFileStore } from "../store/fileStore";
import { useThemeStore } from "../store/themeStore";

describe("workspaceManager", () => {
  beforeEach(() => {
    useEditorStore.setState({ openTabs: [], activeTab: null, fileContents: {}, autoSave: false });
    useFileStore.setState({ root: "C:/projects/my-app" });
    useThemeStore.setState({ activeTheme: "fahh-dark" });
  });

  it("serializes current workspace state accurately", () => {
    useEditorStore.setState({
      openTabs: [
        { path: "C:/projects/my-app/index.ts", language: "typescript", dirty: false },
        { path: "C:/projects/my-app/package.json", language: "json", dirty: false },
      ],
      activeTab: "C:/projects/my-app/index.ts",
      autoSave: true,
    });

    const data = serializeWorkspace();
    expect(data.name).toBe("my-app");
    expect(data.root).toBe("C:/projects/my-app");
    expect(data.openTabs).toHaveLength(2);
    expect(data.openTabs[0].active).toBe(true);
    expect(data.openTabs[1].active).toBe(false);
    expect(data.settings.autoSave).toBe(true);
    expect(data.settings.theme).toBe("fahh-dark");
  });

  it("applies workspace configuration and restores tabs & settings", async () => {
    const openFolderFn = vi.fn().mockResolvedValue(undefined);
    const openFileFn = vi.fn().mockResolvedValue(undefined);

    const config = {
      fahh: "0.6.2",
      root: "C:/projects/demo",
      folders: [{ path: "C:/projects/demo", name: "demo" }],
      openTabs: [
        { path: "C:/projects/demo/app.tsx", language: "typescript", active: true },
      ],
      settings: {
        autoSave: true,
        theme: "dracula",
      },
    };

    const success = await applyWorkspaceConfig(JSON.stringify(config), openFolderFn, openFileFn, undefined, async () => true);
    expect(success).toBe(true);
    expect(openFolderFn).toHaveBeenCalledWith("C:/projects/demo");
    expect(openFileFn).toHaveBeenCalledWith("C:/projects/demo/app.tsx");
    expect(useEditorStore.getState().autoSave).toBe(true);
    expect(useThemeStore.getState().activeTheme).toBe("dracula");
  });
});
