import { useEffect, useRef, useCallback } from "react";
import { useSpatialStore } from "../../store/spatialStore";
import { CanvasNode } from "./CanvasNode";
import { EditorNodeView } from "./Nodes/EditorNodeView";
import { TerminalNodeView } from "./Nodes/TerminalNodeView";
import { AgentNodeView } from "./Nodes/AgentNodeView";
import { BrowserNodeView } from "./Nodes/BrowserNodeView";
import { DiagnosticsNodeView } from "./Nodes/DiagnosticsNodeView";
import { StickyNoteNodeView } from "./Nodes/StickyNoteNodeView";
import { ReaNodeView } from "./Nodes/ReaNodeView";
import { FilesNodeView } from "./Nodes/FilesNodeView";
import { ExtensionsNodeView } from "./Nodes/ExtensionsNodeView";
import { SpatialHud } from "./SpatialHud";
import { SpatialMinimap } from "./SpatialMinimap";
import { LayoutGrid } from "lucide-react";

export function SpatialCanvas() {
  const {
    nodes,
    pan,
    zoom,
    setPan,
    zoomBy,
    focusNode,
    toggleSpatialMode,
  } = useSpatialStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Pan canvas when clicking and dragging on canvas background
  const onMouseDownCanvas = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only pan if clicking canvas background directly, not a window
      if (e.target !== containerRef.current && !(e.target as HTMLElement).classList.contains("canvas-bg-layer")) {
        return;
      }
      isPanning.current = true;
      panStart.current = {
        x: e.clientX,
        y: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };

      const onMouseMove = (ev: MouseEvent) => {
        if (!isPanning.current) return;
        const dx = ev.clientX - panStart.current.x;
        const dy = ev.clientY - panStart.current.y;
        setPan({
          x: Math.round(panStart.current.panX + dx),
          y: Math.round(panStart.current.panY + dy),
        });
      };

      const onMouseUp = () => {
        isPanning.current = false;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [pan.x, pan.y, setPan]
  );

  // Wheel handling: pinch/ctrl-wheel zooms; normal wheel pans
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Zoom centered around mouse
        const zoomDelta = -e.deltaY * 0.0015;
        zoomBy(zoomDelta);
      } else {
        // Pan
        setPan((prev) => ({
          x: Math.round(prev.x - e.deltaX),
          y: Math.round(prev.y - e.deltaY),
        }));
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setPan, zoomBy]);

  // Prevent any ancestor/child scroll events from displacing the canvas viewport
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = 0;
    el.scrollLeft = 0;

    const preventScroll = () => {
      if (el.scrollTop !== 0) el.scrollTop = 0;
      if (el.scrollLeft !== 0) el.scrollLeft = 0;
    };

    el.addEventListener("scroll", preventScroll, { passive: true });
    if (window.scrollY !== 0 || window.scrollX !== 0) {
      window.scrollTo(0, 0);
    }
    return () => el.removeEventListener("scroll", preventScroll);
  }, []);

  // Global shortcuts: Ctrl+Shift+C (toggle spatial mode), Alt+1 / Alt+F (focus editor 1:1)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "C" || e.key === "c")) {
        e.preventDefault();
        toggleSpatialMode();
        return;
      }
      if (e.altKey && (e.key === "1" || e.key === "f" || e.key === "F")) {
        e.preventDefault();
        focusNode("spatial-editor");
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSpatialMode, focusNode]);

  return (
    <div
      ref={containerRef}
      onMouseDown={onMouseDownCanvas}
      className="relative w-full h-full overflow-hidden bg-[#141311] select-none cursor-default"
      style={{
        // 80px grid lines + 22px dot grid matching cate.cero-ai.com
        backgroundImage: `
          radial-gradient(rgba(255, 255, 255, 0.12) 1.2px, transparent 1.2px),
          linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
        `,
        backgroundSize: `
          ${22 * zoom}px ${22 * zoom}px,
          ${80 * zoom}px ${80 * zoom}px,
          ${80 * zoom}px ${80 * zoom}px
        `,
        backgroundPosition: `
          ${pan.x}px ${pan.y}px,
          ${pan.x}px ${pan.y}px,
          ${pan.x}px ${pan.y}px
        `,
      }}
    >
      {/* ── Top Ambient Hero Glow ── */}
      <div
        className="canvas-bg-layer absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(60% 40% at 50% 0%, rgba(255,255,255,0.06) 0%, transparent 70%)",
        }}
      />

      {/* ── Top Floating Navigation Pill ── */}
      <div className="absolute top-4 left-4 z-40 flex items-center gap-2 select-none">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#181816]/90 border border-white/10 shadow-xl backdrop-blur-xl">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#e8e6e3]">
            <span className="w-2 h-2 rounded-full bg-[#4a9eff] animate-pulse" />
            <span>CATE · Canvas Spatial Mode</span>
          </div>
          <span className="text-[10px] text-white/40 font-mono">v0.6.1</span>
        </div>

        <button
          type="button"
          onClick={toggleSpatialMode}
          title="Switch to classic docked IDE layout (Ctrl+Shift+C)"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#181816]/90 border border-white/10 shadow-xl backdrop-blur-xl text-xs text-[#a8a49e] hover:text-[#e8e6e3] hover:border-white/25 transition-all"
        >
          <LayoutGrid size={13} className="text-[#4a9eff]" />
          <span>Exit to Docked IDE</span>
        </button>
      </div>

      {/* ── Transformed Canvas World ── */}
      <div
        className="canvas-bg-layer absolute inset-0 origin-top-left"
        style={{
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          width: "10000px",
          height: "10000px",
          willChange: "transform",
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
          textRendering: "optimizeLegibility",
        }}
      >
        {nodes.map((node) => (
          <CanvasNode key={node.id} node={node}>
            {node.type === "editor" && <EditorNodeView />}
            {node.type === "terminal" && <TerminalNodeView />}
            {node.type === "agent" && <AgentNodeView />}
            {node.type === "browser" && <BrowserNodeView node={node} />}
            {node.type === "diagnostics" && <DiagnosticsNodeView />}
            {node.type === "note" && <StickyNoteNodeView node={node} />}
            {node.type === "rea" && <ReaNodeView />}
            {node.type === "files" && <FilesNodeView />}
            {node.type === "extensions" && <ExtensionsNodeView />}
          </CanvasNode>
        ))}
      </div>

      {/* ── Floating HUD Controls ── */}
      <SpatialHud />

      {/* ── Interactive Minimap Radar ── */}
      <SpatialMinimap />
    </div>
  );
}
