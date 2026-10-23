import { useRef, useState, type ReactNode } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useDialogStore, type DialogRequest } from "../../store/dialogStore";

/** A centred, focus-trapped modal: Tab stays inside, Esc (or a click on the backdrop) closes it. */
export function Modal({
  title,
  onClose,
  children,
  width = 420,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose);
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ width }}
        className="fahh-dialog max-w-[92vw] rounded-lg border border-fahh-surface bg-fahh-bg p-5 text-fahh-text shadow-2xl outline-none select-text"
      >
        <h2 className="mb-2 text-sm font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

const btn = (primary?: boolean, danger?: boolean) =>
  `rounded px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-fahh-accent ${
    danger
      ? "bg-fahh-error text-white hover:opacity-90"
      : primary
        ? "bg-fahh-accent text-white hover:opacity-90"
        : "bg-fahh-surface text-fahh-text hover:bg-fahh-surface/70"
  }`;
export const dialogButtonClass = btn;

function Dialog({ req }: { req: DialogRequest }) {
  const answer = useDialogStore((s) => s.answer);
  const [value, setValue] = useState(req.input?.value ?? "");
  const done = (button: string | null) => answer(req.id, { button, value });
  const primary = req.buttons.find((b) => b.primary)?.value ?? req.buttons[0]?.value ?? null;
  return (
    <Modal title={req.title} onClose={() => done(null)}>
      {req.message && <p className="mb-3 whitespace-pre-wrap text-xs text-fahh-muted">{req.message}</p>}
      {req.input && (
        <input
          autoFocus
          value={value}
          placeholder={req.input.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              done(primary);
            }
          }}
          spellCheck={false}
          className="mb-3 w-full rounded border border-fahh-surface bg-fahh-sidebar px-2 py-1 font-mono text-xs text-fahh-text outline-none focus:border-fahh-accent"
        />
      )}
      <div className="flex justify-end gap-2">
        {req.buttons.map((b) => (
          <button key={b.value} type="button" autoFocus={!req.input && b.value === primary} onClick={() => done(b.value)} className={btn(b.primary, b.danger)}>
            {b.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** Shows the queued dialogs, one at a time. Mounted once by App. */
export function DialogHost() {
  const req = useDialogStore((s) => s.queue[0]);
  return req ? <Dialog key={req.id} req={req} /> : null;
}
