import { useEffect, useState, type RefObject } from "react";
import { useFahhStore, type Impact } from "../../store/fahhStore";
import { useReducedMotion } from "../../hooks/useReducedMotion";

/**
 * The visual half of the fahh, drawn over the editor region only (never the
 * whole window) and never taking a click:
 *
 *   fahh   red edge glow; on Epic also a short shake of the editor region and
 *          a "FAHH ×n" chip in the corner
 *   clean  a gold/green edge glow; on Epic a "CLEAN" chip
 *
 * Everything is CSS animation on transform/opacity, so typing is never blocked.
 */
export function ImpactLayer({ targetRef }: { targetRef: RefObject<HTMLElement> }) {
  const impact = useFahhStore((s) => s.impact);
  const intensity = useFahhStore((s) => s.intensity);
  const reduced = useReducedMotion();
  const epic = intensity === "epic" && !reduced;
  const [shown, setShown] = useState<Impact | null>(null);

  useEffect(() => {
    if (!impact) return;
    setShown(impact);
    const el = targetRef.current;
    if (impact.kind === "fahh" && epic && el) {
      // Restart the animation even if the last shake has not finished.
      el.classList.remove("fahh-shake");
      void el.offsetWidth;
      el.classList.add("fahh-shake");
    }
    const t = window.setTimeout(() => {
      setShown((s) => (s?.seq === impact.seq ? null : s));
      el?.classList.remove("fahh-shake");
    }, 1400);
    return () => window.clearTimeout(t);
    // Only a new impact (a new seq) should replay the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impact?.seq]);

  if (!shown) return null;
  const isFahh = shown.kind === "fahh";
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden="true">
      <div key={`v${shown.seq}`} className={isFahh ? "fahh-vignette" : "fahh-clean-glow"} />
      {epic && (
        <div key={`c${shown.seq}`} className={`fahh-chip ${isFahh ? "is-fahh" : "is-clean"}`}>
          {isFahh ? "FAHH" : "CLEAN"}
          {isFahh && shown.combo > 1 && <span className="fahh-chip-x">×{shown.combo}</span>}
        </div>
      )}
    </div>
  );
}
