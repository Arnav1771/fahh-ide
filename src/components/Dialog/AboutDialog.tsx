import { useState } from "react";
import { Modal, dialogButtonClass } from ".";
import { openExternal } from "../../lib/browser";
import { RELEASES_URL, checkForUpdates, type UpdateCheck } from "../../lib/updates";

type State = { k: "idle" } | { k: "checking" } | { k: "done"; r: UpdateCheck } | { k: "error"; msg: string };

/** Help > About Fahh Editor: the version, the releases page, and a real update check. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<State>({ k: "idle" });
  const check = async () => {
    setSt({ k: "checking" });
    try {
      setSt({ k: "done", r: await checkForUpdates(__APP_VERSION__) });
    } catch (e) {
      setSt({ k: "error", msg: e instanceof Error ? e.message : String(e) });
    }
  };
  const link = "text-fahh-accent underline-offset-2 hover:underline";
  return (
    <Modal title="About Fahh Editor" onClose={onClose}>
      <p className="text-xs text-fahh-text">
        Version <span className="font-mono" data-testid="about-version">{__APP_VERSION__}</span>
      </p>
      <p className="mt-1 text-xs text-fahh-muted">A code editor that says fahh when you break the build. Tauri 2, Rust and Monaco.</p>
      <p className="mt-2 text-xs">
        <button type="button" className={link} onClick={() => void openExternal(RELEASES_URL)}>
          Release notes and downloads
        </button>
      </p>

      <div className="mt-4 min-h-[2.5rem] rounded border border-fahh-surface bg-fahh-sidebar px-3 py-2 text-xs" aria-live="polite" data-testid="update-result">
        {st.k === "idle" && <span className="text-fahh-muted">Not checked yet.</span>}
        {st.k === "checking" && <span className="text-fahh-muted">Checking GitHub…</span>}
        {st.k === "error" && <span className="text-fahh-error">Could not check: {st.msg}</span>}
        {st.k === "done" && !st.r.newer && <span className="text-fahh-success">You have the latest version ({st.r.latest}).</span>}
        {st.k === "done" && st.r.newer && (
          <span className="text-fahh-text">
            Version {st.r.latest} is out.{" "}
            <button type="button" className={link} onClick={() => void openExternal(st.r.download ?? st.r.url)}>
              {st.r.download ? "Download it" : "Get it from the release page"}
            </button>
            {st.r.download && (
              <>
                {" "}or{" "}
                <button type="button" className={link} onClick={() => void openExternal(st.r.url)}>
                  read what changed
                </button>
              </>
            )}
            .
          </span>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={() => void check()} disabled={st.k === "checking"} className={`${dialogButtonClass(true)} disabled:opacity-50`}>
          Check for updates
        </button>
        <button type="button" autoFocus onClick={onClose} className={dialogButtonClass()}>
          Close
        </button>
      </div>
    </Modal>
  );
}
