import { useEffect } from "react";
import { ShieldAlert } from "lucide-react";
import { useFileStore } from "../store/fileStore";
import { useTrustStore } from "../store/trustStore";

/** Loads the answer for each folder that opens, and asks when there is none. */
export function WorkspaceTrustGate() {
  const root = useFileStore((s) => s.root);
  useEffect(() => {
    let live = true;
    void useTrustStore
      .getState()
      .load(root)
      .then(() => {
        const s = useTrustStore.getState();
        if (live && s.root === root && root && s.trusted === null) void s.ask();
      });
    return () => {
      live = false;
    };
  }, [root]);
  return null;
}

/** "Restricted" in the status bar while the open folder is not trusted; click to decide. */
export function RestrictedModeItem() {
  const { root, trusted, ask } = useTrustStore();
  if (!root || trusted === true) return null;
  return (
    <button
      type="button"
      onClick={() => void ask()}
      title="Restricted mode: Fahh runs none of this folder's code (language servers, its Python environments, tasks). Click to decide."
      className="flex items-center gap-1 text-fahh-warn hover:text-fahh-text transition-colors"
    >
      <ShieldAlert size={12} aria-hidden="true" />
      Restricted
    </button>
  );
}
