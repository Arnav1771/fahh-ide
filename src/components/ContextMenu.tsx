import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type MenuEntry = { label: string; icon?: ReactNode; keys?: string; action: () => void; disabled?: boolean } | "separator";

/**
 * A right-click menu at (x, y), kept on screen. Closes on a click outside, Esc, or after an item runs.
 * Rendered into <body>, so a dock tab strip (which clips) cannot cut it off.
 */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
    ref.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  }, [x, y]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const list = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        list[(i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
      }
    };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={pos}
      className="fahh-menu fixed z-[1000] min-w-[190px] rounded border border-fahh-surface py-1 shadow-xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it === "separator" ? (
          <div key={i} className="my-1 border-t border-fahh-surface" />
        ) : (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.action();
            }}
            className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs text-fahh-text hover:bg-fahh-surface focus:bg-fahh-surface focus:outline-none disabled:opacity-40"
          >
            <span className="flex w-4 shrink-0 items-center justify-center text-fahh-muted">{it.icon}</span>
            <span className="flex-1">{it.label}</span>
            {it.keys && <span className="ml-4 text-[10px] text-fahh-muted">{it.keys}</span>}
          </button>
        )
      )}
    </div>,
    document.body
  );
}
