import { useMemo } from "react";
import { useSpatialStore } from "../../store/spatialStore";

export function SpatialMinimap() {
  const { nodes, pan, zoom, setPan } = useSpatialStore();

  const bounds = useMemo(() => {
    let minX = 0;
    let minY = 0;
    let maxX = 2000;
    let maxY = 1400;

    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    }
    // Add margin
    minX -= 200;
    minY -= 200;
    maxX += 200;
    maxY += 200;

    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }, [nodes]);

  // Minimap dimensions
  const mapW = 160;
  const mapH = 100;
  const scale = Math.min(mapW / bounds.w, mapH / bounds.h);

  // Viewport box in canvas coordinates
  const viewW = window.innerWidth || 1200;
  const viewH = window.innerHeight || 800;
  const viewCanvasX = -pan.x / zoom;
  const viewCanvasY = -pan.y / zoom;
  const viewCanvasW = viewW / zoom;
  const viewCanvasH = viewH / zoom;

  const vpLeft = (viewCanvasX - bounds.minX) * scale;
  const vpTop = (viewCanvasY - bounds.minY) * scale;
  const vpWidth = viewCanvasW * scale;
  const vpHeight = viewCanvasH * scale;

  const handleClickMap = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const targetCanvasX = bounds.minX + clickX / scale;
    const targetCanvasY = bounds.minY + clickY / scale;

    setPan({
      x: Math.round(viewW / 2 - targetCanvasX * zoom),
      y: Math.round(viewH / 2 - targetCanvasY * zoom),
    });
  };

  const getNodeColor = (type: string) => {
    switch (type) {
      case "editor":
        return "#4a9eff";
      case "terminal":
        return "#27c93f";
      case "agent":
        return "#e0a96d";
      case "browser":
        return "#ff9f0a";
      case "diagnostics":
        return "#ff5f56";
      case "note":
        return "#ffd666";
      default:
        return "#ffffff";
    }
  };

  return (
    <div
      onClick={handleClickMap}
      title="Click to pan camera"
      style={{ width: mapW, height: mapH }}
      className="absolute bottom-6 right-6 z-40 rounded-lg overflow-hidden bg-[#161513]/90 border border-white/10 shadow-2xl backdrop-blur-md cursor-pointer select-none group"
    >
      {/* Node rectangles on minimap */}
      {nodes.map((node) => {
        const left = (node.x - bounds.minX) * scale;
        const top = (node.y - bounds.minY) * scale;
        const width = Math.max(3, node.w * scale);
        const height = Math.max(3, node.h * scale);
        return (
          <div
            key={node.id}
            style={{
              left: `${left}px`,
              top: `${top}px`,
              width: `${width}px`,
              height: `${height}px`,
              backgroundColor: getNodeColor(node.type),
            }}
            className="absolute rounded-[1px] opacity-70 group-hover:opacity-90 transition-opacity"
          />
        );
      })}

      {/* Camera Viewport Box */}
      <div
        style={{
          left: `${vpLeft}px`,
          top: `${vpTop}px`,
          width: `${vpWidth}px`,
          height: `${vpHeight}px`,
        }}
        className="absolute border border-[#4a9eff] bg-[#4a9eff]/15 rounded-[2px] pointer-events-none"
      />

      {/* Minimap label */}
      <span className="absolute top-1 left-1.5 text-[8px] font-mono text-white/40 tracking-wider uppercase pointer-events-none">
        Radar
      </span>
    </div>
  );
}
