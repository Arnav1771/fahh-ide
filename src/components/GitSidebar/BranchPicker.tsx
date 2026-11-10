import { useEffect, useState } from "react";
import { CommandPalette } from "../Fahh/CommandPalette";
import type { PaletteCommand } from "../../lib/palette";
import type { GitBranchInfo } from "../../lib/types";
import { gitBranches } from "../../lib/tauri";
import { friendlyGitError } from "../../lib/git";
import { useGitStore } from "../../store/gitStore";
import { useToastStore } from "../../store/toastStore";
import { confirmDialog, promptDialog } from "../../store/dialogStore";
import { revealView } from "../../lib/workbench";

/**
 * VS Code's "Select a ref to checkout": switch, create, publish and delete branches.
 * Opened from the status-bar branch, the Source Control branch chip or the palette.
 */
export function BranchPicker() {
  const open = useGitStore((s) => s.branchPickerOpen);
  const setOpen = useGitStore((s) => s.setBranchPickerOpen);
  const path = useGitStore((s) => s.repo ?? s.root);
  const status = useGitStore((s) => s.status);
  const [branches, setBranches] = useState<GitBranchInfo[] | null>(null);
  const [mode, setMode] = useState<"switch" | "delete">("switch");

  useEffect(() => {
    if (!open || !path) return;
    let live = true;
    setBranches(null);
    gitBranches(path)
      .then((b) => live && setBranches(b))
      .catch((err) => {
        if (!live) return;
        setBranches([]);
        useToastStore.getState().show("Couldn't list branches: " + friendlyGitError(err), "error");
      });
    return () => {
      live = false;
    };
  }, [open, path]);

  const close = () => {
    setOpen(false);
    setMode("switch");
  };
  const git = useGitStore.getState;
  const detached = !status.branch || status.branch.startsWith("detached");

  const switchItems: PaletteCommand[] = [
    {
      id: "git.branch.create",
      group: "Branch",
      label: "Create new branch…",
      keywords: "new add checkout -b",
      run: async () => {
        const name = await promptDialog({
          title: "Create branch",
          message: "Made from the current commit, then checked out. Your uncommitted changes come along.",
          placeholder: "feature/my-change",
          ok: "Create branch",
        });
        if (name) await git().checkout(name, true);
      },
    },
    ...(!detached && !status.unborn && !status.upstream
      ? [{ id: "git.branch.publish", group: "Branch", label: `Publish ${status.branch} to the remote`, keywords: "push upstream", run: () => void git().push() }]
      : []),
    {
      id: "git.branch.delete",
      group: "Branch",
      label: "Delete branch…",
      keywords: "remove",
      run: () => {
        setMode("delete");
        setOpen(true);
      },
    },
    { id: "git.branch.scm", group: "View", label: "Open Source Control", run: () => revealView("git") },
    ...(branches ?? []).map((b) => ({
      id: `${b.remote ? "r" : "b"}:${b.name}`,
      group: b.remote ? "Remote" : b.current ? "Current" : "Local",
      label: b.name,
      keywords: b.upstream ?? undefined,
      run: () => {
        if (!b.current) void git().checkout(b.name);
      },
    })),
  ];

  const deleteItems: PaletteCommand[] = (branches ?? [])
    .filter((b) => !b.remote && !b.current)
    .map((b) => ({
      id: `d:${b.name}`,
      group: "Delete",
      label: b.name,
      run: async () => {
        const ok = await confirmDialog({
          title: `Delete branch ${b.name}?`,
          message: "Commits that are only on this branch become unreachable. This can't be undone from Fahh.",
          ok: "Delete branch",
          danger: true,
        });
        if (ok) await git().deleteBranch(b.name);
      },
    }));

  return (
    <CommandPalette
      open={open}
      onClose={close}
      commands={mode === "switch" ? switchItems : deleteItems}
      placeholder={mode === "switch" ? "Switch to a branch, or create one" : "Pick a branch to delete"}
      label={mode === "switch" ? "Branches" : "Delete a branch"}
      recentKey="fahh-branch-recent"
      emptyText={branches === null ? "Loading branches…" : "No other local branches."}
    />
  );
}
