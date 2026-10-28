import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { useFileStore } from "../../store/fileStore";
import { useGitStore } from "../../store/gitStore";
import { gitFileCommitDiff, gitFileLog } from "../../lib/tauri";
import { friendlyGitError } from "../../lib/git";
import { ago } from "../../lib/agentSessionsList";
import type { GitCommitInfo } from "../../lib/types";
import { DiffView } from "../GitSidebar";

/** Timeline: the commits that changed the active file. Click one for what it changed. */
export function Timeline() {
  const path = useEditorStore((s) => s.activeTab);
  const root = useFileStore((s) => s.root);
  // Re-read after a commit or sync moves HEAD.
  const head = useGitStore((s) => `${s.status.branch}:${s.status.ahead}:${s.status.behind}:${s.lastCommit}`);
  const [commits, setCommits] = useState<GitCommitInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ file: string; text: string } | null>(null);

  useEffect(() => {
    setDiff(null);
    if (!root || !path) return setCommits(null);
    let live = true;
    gitFileLog(root, path)
      .then((c) => live && (setCommits(c), setError(null)))
      .catch((e) => live && (setCommits([]), setError(friendlyGitError(e))));
    return () => {
      live = false;
    };
  }, [root, path, head]);

  const show = async (c: GitCommitInfo) => {
    if (!root || !path) return;
    try {
      const text = await gitFileCommitDiff(root, c.oid, path);
      setDiff({ file: `${c.short} ${c.summary}`, text: text.trim() ? text : "(no textual changes)" });
    } catch (e) {
      setDiff({ file: c.short, text: friendlyGitError(e) });
    }
  };

  return (
    <div className="h-full flex flex-col text-xs">
      <div className="px-3 py-2 border-b border-fahh-surface shrink-0 fahh-label text-[10px] uppercase tracking-widest text-fahh-muted font-semibold">Timeline</div>
      <div className="flex-1 overflow-auto py-1">
        {!path ? (
          <p className="px-3 py-2 text-fahh-muted">Open a file to see its history.</p>
        ) : error ? (
          <p className="px-3 py-2 text-fahh-error">{error}</p>
        ) : commits === null ? null : commits.length === 0 ? (
          <p className="px-3 py-2 text-fahh-muted">No commits for this file (not committed yet, or not in a git repository).</p>
        ) : (
          commits.map((c) => (
            <button
              key={c.oid}
              onClick={() => void show(c)}
              title={`${c.short} by ${c.author}, ${new Date(c.time * 1000).toLocaleString()}`}
              className="w-full flex items-start gap-1.5 px-3 py-1 text-left hover:bg-fahh-surface/60"
            >
              <History size={11} className="mt-0.5 shrink-0 text-fahh-muted" />
              <span className="flex-1 min-w-0">
                <span className="block truncate text-fahh-text">{c.summary || c.short}</span>
                <span className="block truncate text-[10px] text-fahh-muted">{c.author} · {ago(c.time)}</span>
              </span>
            </button>
          ))
        )}
      </div>
      {diff && <DiffView file={diff.file} text={diff.text} onClose={() => setDiff(null)} />}
    </div>
  );
}
