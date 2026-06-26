import { useEffect, useState } from "react";
import { getToolStatus, installTool } from "../../lib/tauri";
import type { ToolStatus } from "../../lib/types";

interface Props {
  onClose: () => void;
}

export function InstallerWizard({ onClose }: Props) {
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);

  useEffect(() => {
    getToolStatus().then(setTools).catch(console.error);
  }, []);

  const handleInstall = async (tool: string) => {
    setInstalling(tool);
    try {
      await installTool(tool);
      const updated = await getToolStatus();
      setTools(updated);
    } catch (err) {
      console.error("install failed:", err);
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-fahh-bg border border-fahh-surface rounded-lg p-6 w-[520px] max-h-[80vh] overflow-y-auto">
        <h2 className="text-fahh-accent text-lg font-semibold mb-1">
          Optional Tools
        </h2>
        <p className="text-fahh-muted text-sm mb-4">
          Enhance Fahh Editor with AI and automation tools. All run locally — no Docker.
        </p>
        <div className="space-y-3">
          {tools.map((t) => (
            <div
              key={t.tool}
              className="flex items-center justify-between p-3 bg-fahh-surface rounded-lg"
            >
              <div>
                <p className="text-fahh-text text-sm font-medium">{t.tool}</p>
                <p className="text-fahh-muted text-xs">
                  {t.installed ? `Installed${t.version ? ` (${t.version})` : ""}` : "Not installed"}
                </p>
              </div>
              {!t.installed && (
                <button
                  onClick={() => handleInstall(t.tool)}
                  disabled={installing === t.tool}
                  className="px-3 py-1 bg-fahh-accent text-fahh-bg text-xs rounded font-medium disabled:opacity-50"
                >
                  {installing === t.tool ? "Installing..." : "Install"}
                </button>
              )}
              {t.installed && (
                <span className="text-fahh-success text-xs">✓</span>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-5 w-full py-2 bg-fahh-surface hover:bg-fahh-surface/80 text-fahh-text text-sm rounded-lg transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}
