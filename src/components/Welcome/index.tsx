import { useEffect, useState } from "react";
import { useFahhStore } from "../../store/fahhStore";
import { UPDATES_URL } from "../../lib/welcome";

interface Props {
  onClose: () => void;
  onOpenFolder: () => void;
  onOpenAI: () => void;
}

const STEPS = [
  {
    title: "Errors make a sound now",
    body: "When your code breaks, Fahh plays a sound and shakes the screen. Try it before your first bug does.",
    action: "Ring the bell",
  },
  {
    title: "AI is optional",
    body: "Bring your own key in the AI panel if you want help. Everything else works without it, and nothing leaves your machine unless you ask.",
    action: "Open the AI panel",
  },
  {
    title: "Open a project",
    body: "Pick a folder to start. Files, git, the terminal and run all follow that folder.",
    action: "Open a folder",
  },
] as const;

export function Welcome({ onClose, onOpenFolder, onOpenAI }: Props) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const s = STEPS[step];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const act = () => {
    if (step === 0) useFahhStore.getState().ringBell();
    if (step === 1) { onOpenAI(); onClose(); }
    if (last) { onOpenFolder(); onClose(); }
  };

  const openUpdates = () => {
    import("@tauri-apps/plugin-shell").then(({ open }) => open(UPDATES_URL)).catch(() => window.open(UPDATES_URL, "_blank", "noopener"));
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="bg-fahh-bg border border-fahh-surface rounded-lg p-6 w-[480px]">
        <p className="text-fahh-muted text-xs mb-3">{step + 1} of {STEPS.length}</p>
        <h2 id="welcome-title" className="text-fahh-accent text-lg font-semibold mb-2">{s.title}</h2>
        <p className="text-fahh-text text-sm mb-5 leading-relaxed">{s.body}</p>

        <button onClick={act} className="px-4 py-2 bg-fahh-accent text-fahh-bg text-sm rounded font-medium mb-5">
          {s.action}
        </button>

        <div className="flex items-center justify-between border-t border-fahh-surface pt-4">
          <button onClick={onClose} className="text-fahh-muted text-xs hover:text-fahh-text">Skip</button>
          <div className="flex gap-2">
            {step > 0 && (
              <button onClick={() => setStep(step - 1)} className="px-3 py-1 bg-fahh-surface text-fahh-text text-xs rounded">Back</button>
            )}
            {!last && (
              <button onClick={() => setStep(step + 1)} className="px-3 py-1 bg-fahh-surface text-fahh-text text-xs rounded">Next</button>
            )}
          </div>
        </div>
        <p className="text-fahh-muted text-xs mt-4">
          No account needed. Everything stays on your machine.{" "}
          <button onClick={openUpdates} className="underline hover:text-fahh-text">Get update emails</button>
        </p>
      </div>
    </div>
  );
}
