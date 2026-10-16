interface Props {
  /** "col" sits between side-by-side panels; "row" sits above a bottom panel. */
  dir: "col" | "row";
  /** Current size of the panel being resized, in px. */
  size: number;
  /** Called with the wanted size; the parent clamps and persists it. */
  onResize: (size: number) => void;
  label: string;
  /** Does dragging toward the start (left/up) grow the panel? True for the bottom panel. */
  growsBackward?: boolean;
}

/** A thin draggable (and keyboard-adjustable) divider. */
export function ResizeHandle({ dir, size, onResize, label, growsBackward }: Props) {
  const sign = growsBackward ? -1 : 1;
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointer (tests): the listeners on the handle still get the events
    }
    const start = dir === "col" ? e.clientX : e.clientY;
    const startSize = size;
    const move = (m: PointerEvent) => onResize(startSize + sign * ((dir === "col" ? m.clientX : m.clientY) - start));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const grow = dir === "col" ? "ArrowRight" : "ArrowUp";
    const shrink = dir === "col" ? "ArrowLeft" : "ArrowDown";
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    onResize(size + (e.key === grow ? 1 : -1) * 16);
  };
  return (
    <div
      role="separator"
      aria-orientation={dir === "col" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={size}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={`group relative z-10 shrink-0 bg-fahh-surface outline-none transition-colors hover:bg-fahh-accent focus-visible:bg-fahh-accent ${
        dir === "col" ? "w-px cursor-col-resize" : "h-px cursor-row-resize"
      }`}
    >
      {/* a wider invisible grab area */}
      <span className={`absolute ${dir === "col" ? "-left-1.5 -right-1.5 inset-y-0" : "-top-1.5 -bottom-1.5 inset-x-0"}`} />
    </div>
  );
}
