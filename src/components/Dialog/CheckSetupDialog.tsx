import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { Modal, dialogButtonClass } from ".";
import { checkSetup, sortChecks, summarize, type SetupCheck } from "../../lib/doctor";

type State = { k: "checking" } | { k: "done"; checks: SetupCheck[] } | { k: "error"; msg: string };

/** Run Check Setup now and on `run()`; shared by the dialog and the welcome tour. */
export function useSetupCheck(onDone?: (checks: SetupCheck[]) => void) {
  const [st, setSt] = useState<State>({ k: "checking" });
  const run = async () => {
    setSt({ k: "checking" });
    try {
      const checks = sortChecks(await checkSetup());
      setSt({ k: "done", checks });
      onDone?.(checks);
    } catch (e) {
      setSt({ k: "error", msg: e instanceof Error ? e.message : String(e) });
    }
  };
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { st, run };
}

/** The results: a tick and version for each tool found, a cross and the install line for the rest. */
export function SetupList({ st }: { st: State }) {
  if (st.k === "checking") return <p className="text-xs text-fahh-muted" aria-live="polite">Checking your tools…</p>;
  if (st.k === "error") return <p className="text-xs text-fahh-error">Could not check: {st.msg}</p>;
  return (
    <div aria-live="polite">
      <p className="mb-2 text-xs text-fahh-text" data-testid="setup-summary">{summarize(st.checks)}</p>
      <ul className="space-y-1 text-xs" data-testid="setup-list">
        {st.checks.map((c, i) => (
          <li key={c.name} className="fahh-setup-row flex items-start gap-2" style={{ animationDelay: `${i * 70}ms` }}>
            {c.found ? (
              <Check size={14} className="mt-px shrink-0 text-fahh-success" aria-label="found" />
            ) : (
              <X size={14} className="mt-px shrink-0 text-fahh-error" aria-label="missing" />
            )}
            <div className="min-w-0">
              <span className="text-fahh-text">{c.name}</span>
              {c.kind === "language server" && <span className="text-fahh-muted"> · language server</span>}
              {c.found && <span className="ml-1 font-mono text-fahh-muted">{c.version ?? "found"}</span>}
              {!c.found && <div className="break-words font-mono text-[11px] text-fahh-muted select-text">{c.hint}</div>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Help > Check Setup (and "Fahh: Check Setup" in the palette). */
export function CheckSetupDialog({ onClose }: { onClose: () => void }) {
  const { st, run } = useSetupCheck();
  return (
    <Modal title="Check Setup" onClose={onClose} width={520}>
      <p className="mb-3 text-xs text-fahh-muted">What Fahh uses to run, debug and understand your code. Everything is optional; missing pieces only turn off the feature that needs them.</p>
      <div className="max-h-[55vh] overflow-y-auto">
        <SetupList st={st} />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={() => void run()} disabled={st.k === "checking"} className={`${dialogButtonClass(true)} disabled:opacity-50`}>
          Check again
        </button>
        <button type="button" autoFocus onClick={onClose} className={dialogButtonClass()}>
          Close
        </button>
      </div>
    </Modal>
  );
}
