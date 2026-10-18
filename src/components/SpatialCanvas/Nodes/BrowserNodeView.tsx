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
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#141311] text-xs">
      {/* Browser address bar & navigation controls */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#161513] border-b border-white/[0.08] shrink-0">
        <button
          type="button"
          onClick={handleReload}
          title="Reload page"
          disabled={isBlank}
          className="p-1 rounded text-[#8a8780] hover:text-[#e8e6e3] hover:bg-white/[0.06] transition-colors disabled:opacity-40"
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
            className="w-full px-2.5 py-1 rounded bg-[#1f1e1c] border border-white/[0.08] text-[#e8e6e3] text-xs font-mono outline-none focus:border-[#4a9eff] transition-colors"
          />
          <button
            type="submit"
            title="Navigate"
            className="p-1 rounded bg-white/[0.06] text-[#8a8780] hover:text-[#4a9eff] hover:bg-white/[0.1] transition-colors"
          >
            <ArrowRight size={12} />
          </button>
        </form>

        {/* Viewport size toggles */}
        <div className="flex items-center gap-0.5 bg-[#1f1e1c] p-0.5 rounded border border-white/[0.08]">
          <button
            type="button"
            onClick={() => setViewportMode("desktop")}
            title="Desktop view"
            className={`p-1 rounded transition-colors ${
              viewportMode === "desktop" ? "bg-white/10 text-[#4a9eff]" : "text-[#8a8780] hover:text-[#e8e6e3]"
            }`}
          >
            <Laptop size={11} />
          </button>
          <button
            type="button"
            onClick={() => setViewportMode("tablet")}
            title="Tablet view"
            className={`p-1 rounded transition-colors ${
              viewportMode === "tablet" ? "bg-white/10 text-[#4a9eff]" : "text-[#8a8780] hover:text-[#e8e6e3]"
            }`}
          >
            <Tablet size={11} />
          </button>
          <button
            type="button"
            onClick={() => setViewportMode("mobile")}
            title="Mobile view"
            className={`p-1 rounded transition-colors ${
              viewportMode === "mobile" ? "bg-white/10 text-[#4a9eff]" : "text-[#8a8780] hover:text-[#e8e6e3]"
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
          className="p-1 rounded text-[#8a8780] hover:text-[#4a9eff] hover:bg-white/[0.06] transition-colors disabled:opacity-40"
        >
          <ExternalLink size={12} />
        </button>
      </div>

      {/* Frame content container */}
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-auto bg-[#0a0a0a] p-2">
        {isBlank ? (
          <div className="flex flex-col items-center justify-center text-center p-6 max-w-sm">
            <div className="w-12 h-12 rounded-full bg-[#4a9eff]/10 border border-[#4a9eff]/20 flex items-center justify-center mb-3">
              <Globe size={24} className="text-[#4a9eff]" />
            </div>
            <h3 className="text-sm font-medium text-[#e8e6e3] mb-1">Live Browser Viewport</h3>
            <p className="text-[11px] text-[#8a8780] mb-4">
              Enter a dev server URL above or select a local port below to start previewing your web UI:
            </p>
            <div className="w-full space-y-1.5">
              {QUICK_PORTS.map((item) => (
                <button
                  key={item.url}
                  type="button"
                  onClick={() => navigateTo(item.url)}
                  className="w-full flex items-center justify-between px-3 py-1.5 rounded bg-[#181816] border border-white/[0.08] hover:border-[#4a9eff]/40 hover:bg-[#1f1e1c] text-[#e8e6e3] text-left transition-colors"
                >
                  <span className="font-mono text-[11px]">{item.label}</span>
                  <span className="text-[10px] text-[#4a9eff]">Launch →</span>
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
