import { useState } from "react";
import { RotateCw, ExternalLink, Laptop, Smartphone, Tablet, Globe, ArrowRight } from "lucide-react";
import { openBrowser } from "../../../lib/browser";
import { useSpatialStore, type SpatialNodeData } from "../../../store/spatialStore";

const QUICK_PORTS = [
  { label: ":3000 (React / Next.js)", url: "http://localhost:3000" },
  { label: ":5173 (Vite / Svelte)", url: "http://localhost:5173" },
  { label: ":8080 (Web Server)", url: "http://localhost:8080" },
  { label: "Fahh Playground", url: "https://fahhide.duckdns.org/play.html" },
];

export function BrowserNodeView({ node }: { node: SpatialNodeData }) {
  const { updateNodeMeta } = useSpatialStore();
  const currentUrl = node.meta?.url || "about:blank";
  const [urlInput, setUrlInput] = useState(currentUrl === "about:blank" ? "" : currentUrl);
  const [iframeKey, setIframeKey] = useState(0);
  const [viewportMode, setViewportMode] = useState<"desktop" | "tablet" | "mobile">("desktop");

  const navigateTo = (rawTarget: string) => {
    let target = rawTarget.trim();
    if (!target) return;
    if (!target.startsWith("http://") && !target.startsWith("https://") && target !== "about:blank") {
      target = "http://" + target;
    }
    setUrlInput(target);
    updateNodeMeta(node.id, { url: target });
    setIframeKey((k) => k + 1);
  };

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    navigateTo(urlInput);
  };

  const handleReload = () => {
    setIframeKey((k) => k + 1);
  };

  const handleOpenExternal = () => {
    if (currentUrl && currentUrl !== "about:blank") {
      openBrowser(currentUrl);
    }
  };

  const isBlank = !currentUrl || currentUrl === "about:blank";

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-fahh-bg text-xs">
      {/* Browser address bar & navigation controls */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-fahh-sidebar border-b border-fahh-surface shrink-0">
        <button
          type="button"
          onClick={handleReload}
          title="Reload page"
          disabled={isBlank}
          className="p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface transition-colors disabled:opacity-40"
        >
          <RotateCw size={12} />
        </button>

        {/* Address bar input */}
        <form onSubmit={handleNavigate} className="flex-1 min-w-0 flex items-center gap-1">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="http://localhost:3000 or enter URL..."
            className="w-full px-2.5 py-1 rounded bg-fahh-surface border border-fahh-surface text-fahh-text text-xs font-mono outline-none focus:border-fahh-accent transition-colors"
          />
          <button
            type="submit"
            title="Navigate"
            className="p-1 rounded bg-fahh-surface text-fahh-muted hover:text-fahh-accent hover:bg-fahh-surface transition-colors"
          >
            <ArrowRight size={12} />
          </button>
        </form>

        {/* Viewport size toggles */}
        <div className="flex items-center gap-0.5 bg-fahh-surface p-0.5 rounded border border-fahh-surface">
          <button
            type="button"
            onClick={() => setViewportMode("desktop")}
            title="Desktop view"
            className={`p-1 rounded transition-colors ${
              viewportMode === "desktop" ? "bg-fahh-surface text-fahh-accent" : "text-fahh-muted hover:text-fahh-text"
            }`}
          >
            <Laptop size={11} />
          </button>
          <button
            type="button"
            onClick={() => setViewportMode("tablet")}
            title="Tablet view"
            className={`p-1 rounded transition-colors ${
              viewportMode === "tablet" ? "bg-fahh-surface text-fahh-accent" : "text-fahh-muted hover:text-fahh-text"
            }`}
          >
            <Tablet size={11} />
          </button>
          <button
            type="button"
            onClick={() => setViewportMode("mobile")}
            title="Mobile view"
            className={`p-1 rounded transition-colors ${
              viewportMode === "mobile" ? "bg-fahh-surface text-fahh-accent" : "text-fahh-muted hover:text-fahh-text"
            }`}
          >
            <Smartphone size={11} />
          </button>
        </div>

        {/* Open native external browser */}
        <button
          type="button"
          onClick={handleOpenExternal}
          disabled={isBlank}
          title="Open in default browser"
          className="p-1 rounded text-fahh-muted hover:text-fahh-accent hover:bg-fahh-surface transition-colors disabled:opacity-40"
        >
          <ExternalLink size={12} />
        </button>
      </div>

      {/* Frame content container */}
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-auto bg-fahh-bg p-2">
        {isBlank ? (
          <div className="flex flex-col items-center justify-center text-center p-6 max-w-sm">
            <div className="w-12 h-12 rounded-full bg-fahh-accent/10 border border-fahh-accent/20 flex items-center justify-center mb-3">
              <Globe size={24} className="text-fahh-accent" />
            </div>
            <h3 className="text-sm font-medium text-fahh-text mb-1">Live Browser Viewport</h3>
            <p className="text-[11px] text-fahh-muted mb-4">
              Enter a dev server URL above or select a local port below to start previewing your web UI:
            </p>
            <div className="w-full space-y-1.5">
              {QUICK_PORTS.map((item) => (
                <button
                  key={item.url}
                  type="button"
                  onClick={() => navigateTo(item.url)}
                  className="w-full flex items-center justify-between px-3 py-1.5 rounded bg-fahh-sidebar border border-fahh-surface hover:border-fahh-accent/40 hover:bg-fahh-surface text-fahh-text text-left transition-colors"
                >
                  <span className="font-mono text-[11px]">{item.label}</span>
                  <span className="text-[10px] text-fahh-accent">Launch →</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div
            style={{
              width: viewportMode === "mobile" ? "375px" : viewportMode === "tablet" ? "768px" : "100%",
              height: "100%",
            }}
            className="bg-white rounded overflow-hidden shadow-lg transition-all duration-200"
          >
            <iframe
              key={iframeKey}
              src={currentUrl}
              title="Spatial Browser Preview"
              className="w-full h-full border-0"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            />
          </div>
        )}
      </div>
    </div>
  );
}
