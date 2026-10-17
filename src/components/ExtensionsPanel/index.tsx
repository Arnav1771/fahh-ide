import { useEffect, useState, useMemo } from "react";
import {
  Search,
  Download,
  Star,
  Check,
  Trash2,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { getPlugins } from "../../lib/tauri";
import type { Plugin } from "../../lib/types";

// ─── Open VSX / Marketplace Types ────────────────────────────────────────────

export interface MarketplaceExtension {
  id: string; // e.g. "ms-python.python"
  namespace: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  downloadCount: number;
  averageRating: number;
  iconUrl?: string;
  category?: string;
  verified?: boolean;
}

const INSTALLED_EXTENSIONS_KEY = "fahh-installed-extensions";

// Curated popular extensions for immediate zero-latency browsing
const CURATED_MARKETPLACE: MarketplaceExtension[] = [
  {
    id: "ms-python.python",
    namespace: "ms-python",
    name: "python",
    displayName: "Python",
    description: "Rich Python language support with IntelliSense, linting, debugging, code formatting and refactoring.",
    version: "2024.18.0",
    downloadCount: 19400000,
    averageRating: 4.6,
    category: "Languages",
    verified: true,
  },
  {
    id: "esbenp.prettier-vscode",
    namespace: "esbenp",
    name: "prettier-vscode",
    displayName: "Prettier - Code formatter",
    description: "Opinionated code formatter supporting JavaScript, TypeScript, CSS, HTML, JSON, Markdown and YAML.",
    version: "10.4.1",
    downloadCount: 16800000,
    averageRating: 4.7,
    category: "Formatters",
    verified: true,
  },
  {
    id: "dbaeumer.vscode-eslint",
    namespace: "dbaeumer",
    name: "vscode-eslint",
    displayName: "ESLint",
    description: "Integrates ESLint into the editor to catch syntax errors and stylistic violations in JavaScript and TypeScript.",
    version: "3.0.10",
    downloadCount: 14200000,
    averageRating: 4.5,
    category: "Formatters",
    verified: true,
  },
  {
    id: "rust-lang.rust-analyzer",
    namespace: "rust-lang",
    name: "rust-analyzer",
    displayName: "rust-analyzer",
    description: "Modular compiler and high-performance language server implementation for the Rust programming language.",
    version: "0.4.2140",
    downloadCount: 8900000,
    averageRating: 4.9,
    category: "Languages",
    verified: true,
  },
  {
    id: "bradlc.vscode-tailwindcss",
    namespace: "bradlc",
    name: "vscode-tailwindcss",
    displayName: "Tailwind CSS IntelliSense",
    description: "Intelligent Tailwind CSS tooling: autocomplete, syntax highlighting, class sorting and linting.",
    version: "0.14.3",
    downloadCount: 9600000,
    averageRating: 4.8,
    category: "Tools",
    verified: true,
  },
  {
    id: "eamodio.gitlens",
    namespace: "eamodio",
    name: "gitlens",
    displayName: "GitLens — Git supercharged",
    description: "Supercharge Git: visual blame annotations, file history, branch comparison and commit navigation.",
    version: "15.7.0",
    downloadCount: 11200000,
    averageRating: 4.8,
    category: "Tools",
    verified: true,
  },
  {
    id: "dracula-theme.theme-dracula",
    namespace: "dracula-theme",
    name: "theme-dracula",
    displayName: "Dracula Official",
    description: "The official dark gothic theme with vibrant neon highlights for Monaco and modern editors.",
    version: "2.25.1",
    downloadCount: 5400000,
    averageRating: 4.9,
    category: "Themes",
    verified: true,
  },
  {
    id: "charliermarsh.ruff",
    namespace: "charliermarsh",
    name: "ruff",
    displayName: "Ruff",
    description: "An extremely fast Python linter and formatter written in Rust, replacing Flake8, Black and isort.",
    version: "2024.46.0",
    downloadCount: 3800000,
    averageRating: 4.9,
    category: "Formatters",
    verified: true,
  },
  {
    id: "usernamehw.error-lens",
    namespace: "usernamehw",
    name: "error-lens",
    displayName: "Error Lens",
    description: "Highlights diagnostics inline on code lines, showing language server errors and warnings immediately.",
    version: "3.20.0",
    downloadCount: 4100000,
    averageRating: 4.8,
    category: "Tools",
    verified: true,
  },
  {
    id: "golang.go",
    namespace: "golang",
    name: "go",
    displayName: "Go",
    description: "Rich Go language support for Fahh: gopls language server, auto-completion, tests, and formatting.",
    version: "0.42.0",
    downloadCount: 6500000,
    averageRating: 4.7,
    category: "Languages",
    verified: true,
  },
];

function formatDownloads(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(0)}k`;
  return String(count);
}

export function ExtensionsPanel() {
  const [panelTab, setPanelTab] = useState<"marketplace" | "installed">("marketplace");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [installedMap, setInstalledMap] = useState<Record<string, MarketplaceExtension>>(() => {
    try {
      return JSON.parse(localStorage.getItem(INSTALLED_EXTENSIONS_KEY) || "{}");
    } catch {
      return {};
    }
  });

  // Local/built-in plugins from backend
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [_backendLoading, setBackendLoading] = useState(true);

  // Live Open VSX search results
  const [searchResults, setSearchResults] = useState<MarketplaceExtension[]>(CURATED_MARKETPLACE);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let mounted = true;
    getPlugins()
      .then((list) => {
        if (mounted) {
          setPlugins(list);
          setBackendLoading(false);
        }
      })
      .catch(() => {
        if (mounted) setBackendLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Save installed map to localStorage
  const saveInstalled = (next: Record<string, MarketplaceExtension>) => {
    setInstalledMap(next);
    try {
      localStorage.setItem(INSTALLED_EXTENSIONS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const handleInstall = (ext: MarketplaceExtension) => {
    const next = { ...installedMap, [ext.id]: ext };
    saveInstalled(next);
  };

  const handleUninstall = (id: string) => {
    const next = { ...installedMap };
    delete next[id];
    saveInstalled(next);
  };

  // Debounced search to Open VSX API
  useEffect(() => {
    if (!search.trim()) {
      setSearchResults(CURATED_MARKETPLACE);
      setSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const url = `https://open-vsx.org/api/-/search?query=${encodeURIComponent(
          search
        )}&size=20&sortBy=downloadCount&sortOrder=desc`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.extensions)) {
            const mapped: MarketplaceExtension[] = data.extensions.map((e: any) => ({
              id: `${e.namespace}.${e.name}`,
              namespace: e.namespace,
              name: e.name,
              displayName: e.displayName || e.name,
              description: e.description || "",
              version: e.version || "1.0.0",
              downloadCount: e.downloadCount || 0,
              averageRating: e.averageRating || 5,
              iconUrl: e.files?.icon,
              verified: e.verified || false,
            }));
            setSearchResults(mapped);
          }
        }
      } catch {
        // Fallback to filtering curated list
        const q = search.toLowerCase();
        setSearchResults(
          CURATED_MARKETPLACE.filter(
            (e) =>
              e.displayName.toLowerCase().includes(q) ||
              e.description.toLowerCase().includes(q) ||
              e.id.toLowerCase().includes(q)
          )
        );
      } finally {
        setSearching(false);
      }
    }, 320);

    return () => clearTimeout(timer);
  }, [search]);

  // Filter marketplace results by category
  const filteredMarketplace = useMemo(() => {
    if (category === "All") return searchResults;
    return searchResults.filter((ext) => ext.category === category);
  }, [searchResults, category]);

  const installedList = Object.values(installedMap);

  return (
    <div className="flex flex-col h-full text-xs text-fahh-text overflow-hidden bg-fahh-sidebar" data-testid="extensions-panel">
      {/* Top Header Tabs */}
      <div className="flex border-b border-fahh-surface shrink-0 bg-fahh-bg/60">
        <button
          type="button"
          onClick={() => setPanelTab("marketplace")}
          className={`flex-1 py-2 text-center text-[11px] font-medium transition-colors border-b-2 ${
            panelTab === "marketplace"
              ? "border-fahh-accent text-fahh-accent"
              : "border-transparent text-fahh-muted hover:text-fahh-text"
          }`}
        >
          Marketplace
        </button>
        <button
          type="button"
          onClick={() => setPanelTab("installed")}
          className={`flex-1 py-2 text-center text-[11px] font-medium transition-colors border-b-2 ${
            panelTab === "installed"
              ? "border-fahh-accent text-fahh-accent"
              : "border-transparent text-fahh-muted hover:text-fahh-text"
          }`}
        >
          Installed ({installedList.length + plugins.length})
        </button>
      </div>

      {/* Search Input */}
      <div className="px-3 py-2 shrink-0 border-b border-fahh-surface bg-fahh-sidebar">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-2 text-fahh-muted" />
          <input
            type="text"
            placeholder={
              panelTab === "marketplace"
                ? "Search Open VSX Marketplace (e.g. python, prettier)…"
                : "Filter installed extensions…"
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-fahh-bg text-fahh-text placeholder-fahh-muted rounded pl-7 pr-2 py-1.5 text-xs border border-fahh-surface focus:outline-none focus:border-fahh-accent"
          />
        </div>

        {/* Categories Bar for Marketplace */}
        {panelTab === "marketplace" && (
          <div className="flex items-center gap-1 mt-2 overflow-x-auto no-scrollbar pb-0.5">
            {["All", "Languages", "Formatters", "Themes", "Tools"].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`px-2 py-0.5 text-[10px] rounded-full shrink-0 transition-colors ${
                  category === cat
                    ? "bg-fahh-accent text-white font-medium"
                    : "bg-fahh-surface text-fahh-muted hover:text-fahh-text"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main List */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {panelTab === "marketplace" ? (
          <>
            {searching ? (
              <div className="flex items-center justify-center gap-2 py-8 text-fahh-muted">
                <RefreshCw size={13} className="animate-spin text-fahh-accent" />
                <span>Searching Open VSX registry…</span>
              </div>
            ) : filteredMarketplace.length === 0 ? (
              <div className="text-center py-8 text-fahh-muted">
                <p>No extensions found for &quot;{search}&quot;</p>
              </div>
            ) : (
              filteredMarketplace.map((ext) => {
                const isInstalled = !!installedMap[ext.id];
                return (
                  <div
                    key={ext.id}
                    className="p-2.5 rounded-lg bg-fahh-surface/80 border border-fahh-surface hover:border-fahh-accent/40 transition-all flex flex-col gap-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {ext.iconUrl ? (
                          <img
                            src={ext.iconUrl}
                            alt=""
                            className="w-7 h-7 rounded shrink-0 object-contain bg-fahh-bg p-0.5"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded bg-fahh-accent/15 text-fahh-accent font-semibold flex items-center justify-center shrink-0 text-xs">
                            {ext.displayName.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="font-medium text-fahh-text text-xs truncate">
                              {ext.displayName}
                            </span>
                            {ext.verified && (
                              <ShieldCheck size={11} className="text-fahh-info shrink-0" />
                            )}
                          </div>
                          <span className="text-[10px] text-fahh-muted truncate block">
                            {ext.namespace} · v{ext.version}
                          </span>
                        </div>
                      </div>

                      {/* Action Button */}
                      {isInstalled ? (
                        <button
                          type="button"
                          onClick={() => handleUninstall(ext.id)}
                          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] bg-fahh-surface text-fahh-muted hover:text-fahh-error border border-fahh-surface hover:border-fahh-error/30 transition-colors shrink-0"
                          title="Click to uninstall"
                        >
                          <Check size={11} className="text-fahh-success" />
                          <span>Installed</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleInstall(ext)}
                          className="flex items-center gap-1 px-2.5 py-0.5 rounded text-[10.5px] bg-fahh-accent text-white font-medium hover:bg-fahh-accent/90 transition-colors shrink-0 shadow-sm"
                        >
                          <Download size={11} />
                          <span>Install</span>
                        </button>
                      )}
                    </div>

                    <p className="text-[11px] text-fahh-muted line-clamp-2 leading-relaxed">
                      {ext.description}
                    </p>

                    <div className="flex items-center justify-between text-[10px] text-fahh-muted/70 pt-0.5 border-t border-fahh-surface/60">
                      <span className="flex items-center gap-1">
                        <Download size={9} />
                        {formatDownloads(ext.downloadCount)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Star size={9} className="text-yellow-400 fill-yellow-400" />
                        {ext.averageRating.toFixed(1)}
                      </span>
                      <a
                        href={`https://open-vsx.org/extension/${ext.namespace}/${ext.name}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-fahh-accent flex items-center gap-0.5"
                      >
                        Registry <ExternalLink size={8} />
                      </a>
                    </div>
                  </div>
                );
              })
            )}
          </>
        ) : (
          /* Installed Tab */
          <div className="space-y-3">
            {installedList.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase tracking-wider text-fahh-muted font-semibold px-1">
                  Marketplace Extensions ({installedList.length})
                </span>
                {installedList.map((ext) => (
                  <div
                    key={ext.id}
                    className="p-2 rounded bg-fahh-surface/80 border border-fahh-surface flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-xs text-fahh-text truncate">
                        {ext.displayName}
                      </p>
                      <p className="text-[10px] text-fahh-muted">
                        {ext.namespace} · v{ext.version}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUninstall(ext.id)}
                      className="p-1 rounded text-fahh-muted hover:text-fahh-error hover:bg-fahh-bg transition-colors"
                      title="Uninstall extension"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5 pt-1">
              <span className="text-[10px] uppercase tracking-wider text-fahh-muted font-semibold px-1">
                Built-in Language & Theme Packs ({plugins.length})
              </span>
              {plugins.map((plugin) => (
                <div
                  key={plugin.id}
                  className="p-2 rounded bg-fahh-surface/60 border border-fahh-surface flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-xs text-fahh-text truncate">
                        {plugin.name}
                      </span>
                      <span className="text-[9px] px-1 py-0.2 rounded bg-fahh-bg text-fahh-accent border border-fahh-surface">
                        {plugin.kind}
                      </span>
                    </div>
                    <p className="text-[10px] text-fahh-muted truncate">{plugin.description}</p>
                  </div>
                  <span className="text-[10px] text-fahh-muted/70 shrink-0">Built-in</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
