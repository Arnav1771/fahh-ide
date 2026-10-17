import { useState } from "react";
import { RotateCw, ExternalLink, Laptop, Smartphone, Tablet } from "lucide-react";
import { openBrowser } from "../../../lib/browser";
import { useSpatialStore, type SpatialNodeData } from "../../../store/spatialStore";

export function BrowserNodeView({ node }: { node: SpatialNodeData }) {
  const { updateNodeMeta } = useSpatialStore();
  const currentUrl = node.meta?.url || "http://localhost:1420";
  const [urlInput, setUrlInput] = useState(currentUrl);
  const [iframeKey, setIframeKey] = useState(0);
  const [viewportMode, setViewportMode] = useState<"desktop" | "tablet" | "mobile">("desktop");

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    let target = urlInput.trim();
    if (!target) return;
    if (!target.startsWith("http://") && !target.startsWith("https://")) {
      target = "http://" + target;
    }
    setUrlInput(target);
    updateNodeMeta(node.id, { url: target });
    setIframeKey((k) => k + 1);
  };

  const handleReload = () => {
    setIframeKey((k) => k + 1);
  };

  const handleOpenExternal = () => {
    openBrowser(currentUrl);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#141311] text-xs">
      {/* Browser address bar & navigation controls */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#161513] border-b border-white/[0.08] shrink-0">
        <button
          type="button"
          onClick={handleReload}
          title="Reload page"
          className="p-1 rounded text-[#8a8780] hover:text-[#e8e6e3] hover:bg-white/[0.06] transition-colors"
        >
          <RotateCw size={12} />
        </button>

        {/* Address bar input */}
        <form onSubmit={handleNavigate} className="flex-1 min-w-0">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="http://localhost:1420"
            className="w-full px-2.5 py-1 rounded bg-[#1f1e1c] border border-white/[0.08] text-[#e8e6e3] text-xs font-mono outline-none focus:border-[#4a9eff] transition-colors"
          />
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
          title="Open in default browser"
          className="p-1 rounded text-[#8a8780] hover:text-[#4a9eff] hover:bg-white/[0.06] transition-colors"
        >
          <ExternalLink size={12} />
        </button>
      </div>

      {/* Frame content container */}
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-auto bg-[#0a0a0a] p-2">
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
      </div>
    </div>
  );
}
