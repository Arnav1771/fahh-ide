import { useRef, useCallback } from "react";
import {
  FileCode,
  Terminal as TerminalIcon,
  Bot,
  Globe,
  AlertCircle,
  StickyNote,
  X,
  Minus,
  Maximize2,
  Move
} from "lucide-react";
import { useSpatialStore, type SpatialNodeData } from "../../store/spatialStore";

interface CanvasNodeProps {
  node: SpatialNodeData;
  children: React.ReactNode;
}

export function CanvasNode({ node, children }: CanvasNodeProps) {
  const {
    activeNodeId,
    bringToFront,
    updateNodePos,
    updateNodeSize,
    toggleMinimize,
    toggleMaximize,
    removeNode,
    zoom,
  } = useSpatialStore();

  const isFocused = activeNodeId === node.id;
  const isMinimized = !!node.minimized;
  const isMaximized = !!node.maximized;

  // Dragging state
  const isDragging = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0, nodeX: 0, nodeY: 0 });

  // Resizing state
  const isResizing = useRef(false);
  const resizeStartPos = useRef({ x: 0, y: 0, nodeW: 0, nodeH: 0 });

  const onMouseDownTitle = useCallback(
    (e: React.MouseEvent) => {
      // Don't drag if clicking buttons
      if ((e.target as HTMLElement).closest("button")) return;
      bringToFront(node.id);
      isDragging.current = true;
      dragStartPos.current = {
        x: e.clientX,
        y: e.clientY,
        nodeX: node.x,
        nodeY: node.y,
      };

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const dx = (ev.clientX - dragStartPos.current.x) / zoom;
        const dy = (ev.clientY - dragStartPos.current.y) / zoom;
        updateNodePos(
          node.id,
          Math.round(dragStartPos.current.nodeX + dx),
          Math.round(dragStartPos.current.nodeY + dy)
        );
      };

      const onMouseUp = () => {
        isDragging.current = false;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
      e.stopPropagation();
    },
    [bringToFront, node.id, node.x, node.y, updateNodePos, zoom]
  );

  const onMouseDownResize = useCallback(
    (e: React.MouseEvent) => {
      bringToFront(node.id);
      isResizing.current = true;
      resizeStartPos.current = {
        x: e.clientX,
        y: e.clientY,
        nodeW: node.w,
        nodeH: node.h,
      };

      const onMouseMove = (ev: MouseEvent) => {
        if (!isResizing.current) return;
        const dw = (ev.clientX - resizeStartPos.current.x) / zoom;
        const dh = (ev.clientY - resizeStartPos.current.y) / zoom;
        updateNodeSize(
          node.id,
          Math.round(resizeStartPos.current.nodeW + dw),
          Math.round(resizeStartPos.current.nodeH + dh)
        );
      };

      const onMouseUp = () => {
        isResizing.current = false;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
      e.stopPropagation();
    },
    [bringToFront, node.h, node.id, node.w, updateNodeSize, zoom]
  );

  const getNodeIcon = () => {
    switch (node.type) {
      case "editor":
        return <FileCode size={13} className="text-[#4a9eff]" />;
      case "terminal":
        return <TerminalIcon size={13} className="text-[#27c93f]" />;
      case "agent":
        return <Bot size={13} className="text-[#e0a96d]" />;
      case "browser":
        return <Globe size={13} className="text-[#ff9f0a]" />;
      case "diagnostics":
        return <AlertCircle size={13} className="text-[#ff5f56]" />;
      case "note":
        return <StickyNote size={13} className="text-[#ffd666]" />;
      default:
        return <Move size={13} className="text-fahh-muted" />;
    }
  };

  return (
    <div
      onMouseDown={() => bringToFront(node.id)}
      style={{
        transform: `translate3d(${node.x}px, ${node.y}px, 0)`,
        width: isMinimized ? 300 : isMaximized ? 1100 : node.w,
        height: isMinimized ? 40 : isMaximized ? 760 : node.h,
        zIndex: node.zIndex,
      }}
      className={`absolute select-none flex flex-col rounded-xl overflow-hidden backdrop-blur-md transition-shadow duration-200 ${
        isFocused
          ? "border border-[#4a9eff]/70 shadow-[0_0_0_1px_rgba(74,158,255,0.4),0_20px_50px_-10px_rgba(0,0,0,0.8),0_0_60px_-15px_rgba(74,158,255,0.2)] bg-[#1a1917]/95"
          : "border border-white/10 shadow-[0_12px_36px_-10px_rgba(0,0,0,0.7)] bg-[#161513]/90 hover:border-white/20"
      }`}
    >
      {/* ── macOS Window Chrome Title Bar ── */}
      <div
        onMouseDown={onMouseDownTitle}
        onDoubleClick={() => toggleMaximize(node.id)}
        className="h-9 shrink-0 flex items-center justify-between px-3 bg-[#161513]/95 border-b border-white/[0.07] cursor-grab active:cursor-grabbing select-none"
      >
        {/* Left: Window Controls (Traffic Lights) */}
        <div className="flex items-center gap-1.5 group/controls">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeNode(node.id);
            }}
            title="Close node"
            className="w-3 h-3 rounded-full bg-[#ff5f56] flex items-center justify-center hover:brightness-110 active:brightness-90 transition-all text-[#4a0000] opacity-90 group-hover/controls:opacity-100"
          >
            <X size={8} className="opacity-0 group-hover/controls:opacity-100 transition-opacity stroke-[2.5]" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleMinimize(node.id);
            }}
            title="Minimize node"
            className="w-3 h-3 rounded-full bg-[#ffbd2e] flex items-center justify-center hover:brightness-110 active:brightness-90 transition-all text-[#543b00] opacity-90 group-hover/controls:opacity-100"
          >
            <Minus size={8} className="opacity-0 group-hover/controls:opacity-100 transition-opacity stroke-[2.5]" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleMaximize(node.id);
            }}
            title="Expand node"
            className="w-3 h-3 rounded-full bg-[#27c93f] flex items-center justify-center hover:brightness-110 active:brightness-90 transition-all text-[#003b0c] opacity-90 group-hover/controls:opacity-100"
          >
            <Maximize2 size={7} className="opacity-0 group-hover/controls:opacity-100 transition-opacity stroke-[2.5]" />
          </button>
        </div>

        {/* Center: Node Title & Icon */}
        <div className="flex items-center gap-1.5 min-w-0 max-w-[65%] px-2">
          {getNodeIcon()}
          <span className="text-xs font-medium text-[#e8e6e3] truncate tracking-tight font-sans">
            {node.title}
          </span>
        </div>

        {/* Right: Badge / Type Pill */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-[#a8a49e] font-mono capitalize">
            {node.type}
          </span>
        </div>
      </div>

      {/* ── Node Body Content ── */}
      {!isMinimized && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#141311]">
          {children}
        </div>
      )}

      {/* ── Resize Grip (bottom-right) ── */}
      {!isMinimized && !isMaximized && (
        <div
          onMouseDown={onMouseDownResize}
          title="Drag to resize"
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-center justify-center opacity-40 hover:opacity-100 transition-opacity z-20"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" className="fill-white/60">
            <path d="M6 0L8 2L2 8L0 6Z M7 5L8 6L6 8L5 7Z" />
          </svg>
        </div>
      )}
    </div>
  );
}
