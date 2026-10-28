import { useEffect } from "react";
import { ArrowDown, ArrowUp, CloudUpload, GitBranch, RefreshCw } from "lucide-react";
import { useFileStore } from "../../store/fileStore";
import { useGitStore } from "../../store/gitStore";
import { revealView } from "../../lib/workbench";

/** Status bar: the branch (opens Source Control) and Sync Changes / Publish Branch. */
export function GitStatusItem() {
  const root = useFileStore((s) => s.root);
  const { status, syncing, setRoot, refresh, sync } = useGitStore();

  useEffect(() => {
    setRoot(root);
    void refresh();
    // Catch commits and checkouts made outside Fahh when the window comes back.
    const onFocus = () => void useGitStore.getState().refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [root, setRoot, refresh]);

  if (!status.is_repo || !status.branch) return null;
  const detached = status.branch.startsWith("detached");
  return (
    <>
      <button
        onClick={() => revealView("git")}
        title={`${status.branch}${status.upstream ? ` (tracking ${status.upstream})` : ""}: open Source Control`}
        className="flex items-center gap-1 hover:text-fahh-text transition-colors max-w-[180px]"
        data-testid="status-git-branch"
      >
        <GitBranch size={12} className="shrink-0" />
        <span className="truncate">{status.branch}</span>
        {status.staged.length + status.unstaged.length > 0 && <span className="text-fahh-warn">*</span>}
      </button>
      {!detached && (
        <button
          onClick={() => void sync()}
          disabled={syncing}
          title={status.upstream ? `Sync Changes: pull ${status.behind}, push ${status.ahead} (${status.upstream})` : "Publish Branch"}
          className="flex items-center gap-1 hover:text-fahh-text transition-colors disabled:opacity-60"
          data-testid="status-git-sync"
        >
          {!status.upstream ? (
            <CloudUpload size={12} />
          ) : (
            <>
              <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
              {status.behind > 0 && <span className="flex items-center">{status.behind}<ArrowDown size={10} /></span>}
              {status.ahead > 0 && <span className="flex items-center">{status.ahead}<ArrowUp size={10} /></span>}
            </>
          )}
        </button>
      )}
    </>
  );
}
