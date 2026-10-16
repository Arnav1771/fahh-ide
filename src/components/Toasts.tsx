import { useToastStore } from "../store/toastStore";

/** Small, non-blocking messages (a save confirmation, a failed save). */
export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-9 right-3 z-[60] flex flex-col items-end gap-1">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rounded border bg-fahh-sidebar px-3 py-1.5 text-xs shadow-lg ${
            t.kind === "error" ? "border-fahh-error text-fahh-error" : "border-fahh-surface text-fahh-text"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
