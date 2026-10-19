import { create } from "zustand";

export type SpatialNodeType = "editor" | "terminal" | "agent" | "browser" | "diagnostics" | "note" | "rea" | "files" | "extensions";

export interface SpatialNodeData {
  id: string;
  type: SpatialNodeType;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  minimized?: boolean;
  maximized?: boolean;
  meta?: {
    noteColor?: "amber" | "cyan" | "pink" | "green";
    noteText?: string;
    url?: string;
    file?: string;
  };
}

interface SpatialStore {
  isSpatialMode: boolean;
  pan: { x: number; y: number };
  zoom: number;
  activeNodeId: string | null;
  nodes: SpatialNodeData[];
  highestZ: number;

  toggleSpatialMode: () => void;
  setSpatialMode: (active: boolean) => void;
  setPan: (pan: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) => void;
  setZoom: (zoom: number | ((prev: number) => number)) => void;
  zoomBy: (delta: number, clientX?: number, clientY?: number) => void;
  resetView: () => void;
  fitAll: () => void;
  focusNode: (id: string) => void;

  bringToFront: (id: string) => void;
  updateNodePos: (id: string, x: number, y: number) => void;
  updateNodeSize: (id: string, w: number, h: number) => void;
  updateNodeMeta: (id: string, meta: Partial<NonNullable<SpatialNodeData["meta"]>>) => void;
  toggleMinimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  addNode: (type: SpatialNodeType, title?: string, x?: number, y?: number) => string;
  removeNode: (id: string) => void;
}

const DEFAULT_NODES: SpatialNodeData[] = [
  {
    id: "spatial-agent",
    type: "agent",
    title: "Fahh Local · AI Engineer",
    x: 60,
    y: 80,
    w: 430,
    h: 660,
    zIndex: 10,
  },
  {
    id: "spatial-editor",
    type: "editor",
    title: "Monaco Canvas Editor",
    x: 510,
    y: 80,
    w: 960,
    h: 660,
    zIndex: 11,
  },
  {
    id: "spatial-browser",
    type: "browser",
    title: "Live Browser Viewport",
    x: 1490,
    y: 80,
    w: 500,
    h: 660,
    zIndex: 12,
    meta: {
      url: "about:blank",
    },
  },
  {
    id: "spatial-rea",
    type: "rea",
    title: "REA Code Analysis · AST & Hex",
    x: 2010,
    y: 80,
    w: 480,
    h: 660,
    zIndex: 13,
  },
  {
    id: "spatial-terminal",
    type: "terminal",
    title: "Interactive Terminal · PowerShell",
    x: 510,
    y: 760,
    w: 960,
    h: 420,
    zIndex: 14,
  },
  {
    id: "spatial-diagnostics",
    type: "diagnostics",
    title: "Problems & LSP Diagnostics",
    x: 60,
    y: 760,
    w: 430,
    h: 420,
    zIndex: 9,
  },
  {
    id: "spatial-note-1",
    type: "note",
    title: "Architecture Map",
    x: 1490,
    y: 760,
    w: 500,
    h: 260,
    zIndex: 8,
    meta: {
      noteColor: "amber",
      noteText: "Spatial mapping of open files, terminals, and AI agents.\n\nCode the way you think — float spatially across code, live tests, and terminal outputs.",
    },
  },
];

const STORAGE_KEY = "fahh-spatial-nodes-v1";
const MODE_STORAGE_KEY = "fahh-spatial-mode";

function loadSavedNodes(): SpatialNodeData[] {
  if (typeof localStorage === "undefined") return DEFAULT_NODES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NODES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_NODES;
    // Sanitize any nodes referencing recursive localhost:1420 to prevent memory explosion,
    // and upgrade editor dimensions if too narrow for readable code
    return parsed.map((n: SpatialNodeData) => {
      if (n.type === "browser" && n.meta?.url === "http://localhost:1420") {
        return { ...n, title: "Live Browser Viewport", meta: { ...n.meta, url: "about:blank" } };
      }
      if (n.id === "spatial-editor" && n.w < 900) {
        return { ...n, w: 960, h: Math.max(n.h, 660) };
      }
      return n;
    });
  } catch {
    return DEFAULT_NODES;
  }
}

function saveNodes(nodes: SpatialNodeData[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes));
  } catch {}
}

export function calculateCenterPan(
  node: { x: number; y: number; w: number; h: number },
  viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1440,
  viewportHeight = typeof window !== "undefined" ? window.innerHeight : 900
): { x: number; y: number } {
  const targetX = Math.round(viewportWidth / 2 - (node.x + node.w / 2));
  const targetY = Math.max(30, Math.round(viewportHeight / 2 - (node.y + node.h / 2)));
  return { x: targetX, y: targetY };
}

function getInitialPan(): { x: number; y: number } {
  const editor = DEFAULT_NODES.find((n) => n.id === "spatial-editor");
  if (editor) {
    return calculateCenterPan(editor);
  }
  return { x: -260, y: 40 };
}

export const useSpatialStore = create<SpatialStore>((set, get) => ({
  isSpatialMode: typeof localStorage !== "undefined" ? localStorage.getItem(MODE_STORAGE_KEY) === "true" : false,
  pan: getInitialPan(),
  zoom: 1.0,
  activeNodeId: "spatial-editor",
  nodes: loadSavedNodes(),
  highestZ: 20,

  toggleSpatialMode: () => {
    const next = !get().isSpatialMode;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(MODE_STORAGE_KEY, String(next));
    }
    set({ isSpatialMode: next });
  },

  setSpatialMode: (active: boolean) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(MODE_STORAGE_KEY, String(active));
    }
    set({ isSpatialMode: active });
  },

  setPan: (pan) =>
    set((state) => ({
      pan: typeof pan === "function" ? pan(state.pan) : pan,
    })),

  setZoom: (zoom) =>
    set((state) => {
      const nextZoom = typeof zoom === "function" ? zoom(state.zoom) : zoom;
      return { zoom: Math.min(2.0, Math.max(0.3, nextZoom)) };
    }),

  zoomBy: (delta: number) => {
    set((state) => {
      const next = Math.min(2.0, Math.max(0.35, state.zoom + delta));
      return { zoom: next };
    });
  },

  resetView: () => {
    const editor = get().nodes.find((n) => n.id === "spatial-editor");
    if (editor) {
      set({ pan: calculateCenterPan(editor), zoom: 1.0 });
    } else {
      set({ pan: getInitialPan(), zoom: 1.0 });
    }
  },

  focusNode: (id: string) => {
    const node = get().nodes.find((n) => n.id === id);
    if (node) {
      set({ pan: calculateCenterPan(node), zoom: 1.0, activeNodeId: id });
    }
  },

  fitAll: () => {
    const { nodes } = get();
    if (nodes.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    }
    const width = maxX - minX;
    const height = maxY - minY;
    const viewW = window.innerWidth || 1200;
    const viewH = window.innerHeight || 800;
    const scaleX = (viewW - 140) / width;
    const scaleY = (viewH - 140) / height;
    const nextZoom = Math.min(1.2, Math.max(0.4, Math.min(scaleX, scaleY)));
    const centerX = minX + width / 2;
    const centerY = minY + height / 2;
    const panX = viewW / 2 - centerX * nextZoom;
    const panY = viewH / 2 - centerY * nextZoom;
    set({ zoom: nextZoom, pan: { x: panX, y: panY } });
  },

  bringToFront: (id: string) =>
    set((state) => {
      const nextZ = state.highestZ + 1;
      const updated = state.nodes.map((n) => (n.id === id ? { ...n, zIndex: nextZ } : n));
      saveNodes(updated);
      return {
        nodes: updated,
        highestZ: nextZ,
        activeNodeId: id,
      };
    }),

  updateNodePos: (id, x, y) =>
    set((state) => {
      const updated = state.nodes.map((n) => (n.id === id ? { ...n, x, y } : n));
      saveNodes(updated);
      return { nodes: updated };
    }),

  updateNodeSize: (id, w, h) =>
    set((state) => {
      const updated = state.nodes.map((n) => (n.id === id ? { ...n, w: Math.max(260, w), h: Math.max(160, h) } : n));
      saveNodes(updated);
      return { nodes: updated };
    }),

  updateNodeMeta: (id, meta) =>
    set((state) => {
      const updated = state.nodes.map((n) =>
        n.id === id ? { ...n, meta: { ...n.meta, ...meta } } : n
      );
      saveNodes(updated);
      return { nodes: updated };
    }),

  toggleMinimize: (id) =>
    set((state) => {
      const updated = state.nodes.map((n) => (n.id === id ? { ...n, minimized: !n.minimized } : n));
      saveNodes(updated);
      return { nodes: updated };
    }),

  toggleMaximize: (id) =>
    set((state) => {
      const updated = state.nodes.map((n) => (n.id === id ? { ...n, maximized: !n.maximized } : n));
      saveNodes(updated);
      return { nodes: updated };
    }),

  addNode: (type, title, x, y) => {
    const id = `spatial-${type}-${Date.now().toString(36)}`;
    const defaults: Record<SpatialNodeType, { w: number; h: number; title: string }> = {
      editor: { w: 720, h: 540, title: "Monaco Canvas Editor" },
      terminal: { w: 680, h: 360, title: "Spatial Terminal" },
      agent: { w: 420, h: 560, title: "Fahh Local Assistant" },
      browser: { w: 480, h: 540, title: "Browser Viewport" },
      diagnostics: { w: 420, h: 360, title: "Diagnostics Panel" },
      note: { w: 320, h: 220, title: "Sticky Note" },
      rea: { w: 460, h: 560, title: "REA Code Analysis" },
      files: { w: 320, h: 480, title: "Project Explorer" },
      extensions: { w: 420, h: 560, title: "Extensions Store" },
    };
    const def = defaults[type];
    const { highestZ, nodes } = get();
    const nextZ = highestZ + 1;
    const posX = x ?? 200 + (nodes.length % 6) * 40;
    const posY = y ?? 150 + (nodes.length % 6) * 40;

    const newNode: SpatialNodeData = {
      id,
      type,
      title: title || def.title,
      x: posX,
      y: posY,
      w: def.w,
      h: def.h,
      zIndex: nextZ,
      meta: type === "note" ? { noteColor: "amber", noteText: "Write thoughts, tasks, or architecture notes here." } : undefined,
    };

    const updated = [...nodes, newNode];
    saveNodes(updated);
    set({
      nodes: updated,
      highestZ: nextZ,
      activeNodeId: id,
    });
    return id;
  },

  removeNode: (id) =>
    set((state) => {
      const updated = state.nodes.filter((n) => n.id !== id);
      saveNodes(updated);
      return { nodes: updated };
    }),
}));
