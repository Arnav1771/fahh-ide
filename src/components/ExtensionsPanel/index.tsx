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
  SlidersHorizontal,
  FileDown,
  X,
  Info,
  Tag,
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

export const INSTALLED_EXTENSIONS_KEY = "fahh-installed-extensions";

// Curated popular extensions for immediate zero-latency browsing
export const CURATED_MARKETPLACE: MarketplaceExtension[] = [
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

export function formatDownloads(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(0)}k`;
  return String(count);
}

export function getVsixDownloadUrl(namespace: string, name: string, version: string): string {
  return `https://open-vsx.org/api/${namespace}/${name}/${version}/file/${namespace}.${name}-${version}.vsix`;
}

export type SortOption = "downloads" | "rating" | "name";

export function sortExtensions(list: MarketplaceExtension[], sortBy: SortOption): MarketplaceExtension[] {
  return [...list].sort((a, b) => {
    if (sortBy === "downloads") return b.downloadCount - a.downloadCount;
    if (sortBy === "rating") return b.averageRating - a.averageRating;
    if (sortBy === "name") return a.displayName.localeCompare(b.displayName);
    return 0;
  });
}

export function filterExtensions(
  list: MarketplaceExtension[],
  query: string,
  category: string,
  verifiedOnly: boolean
): MarketplaceExtension[] {
  const q = query.trim().toLowerCase();
  return list.filter((ext) => {
    if (verifiedOnly && !ext.verified) return false;
    if (category !== "All" && ext.category !== category) return false;
    if (!q) return true;
    return (
      ext.displayName.toLowerCase().includes(q) ||
      ext.description.toLowerCase().includes(q) ||
      ext.id.toLowerCase().includes(q) ||
      ext.namespace.toLowerCase().includes(q)
    );
  });
}

export function ExtensionsPanel() {
  const [panelTab, setPanelTab] = useState<"marketplace" | "installed">("marketplace");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [sortBy, setSortBy] = useState<SortOption>("downloads");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [selectedExt, setSelectedExt] = useState<MarketplaceExtension | null>(null);

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
        )}&size=30&sortBy=downloadCount&sortOrder=desc`;
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
        setSearchResults(filterExtensions(CURATED_MARKETPLACE, search, "All", false));
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  // Filter and sort marketplace results
  const displayedMarketplace = useMemo(() => {
    const filtered = filterExtensions(searchResults, search, category, verifiedOnly);
    return sortExtensions(filtered, sortBy);
  }, [searchResults, search, category, verifiedOnly, sortBy]);

  const installedList = useMemo(() => {
    const list = Object.values(installedMap);
    if (!search.trim()) return list;
    return filterExtensions(list, search, "All", false);
  }, [installedMap, search]);

  return (
    <div className="flex flex-col h-full text-xs text-fahh-text overflow-hidden bg-fahh-sidebar" data-testid="extensions-panel">
      {/* Top Header Tabs */}
      <div className="flex border-b border-fahh-surface shrink-0 bg-fahh-bg/60">
        <button
          type="button"
          onClick={() => { setPanelTab("marketplace"); setSelectedExt(null); }}
          className={`flex-1 py-2 text-center text-[11px] font-medium transition-colors border-b-2 ${
            panelTab === "marketplace"
              ? "border-fahh-accent text-fahh-accent"
              : "border-transparent text-fahh-muted hover:text-fahh-text"
          }`}
        >
          Open VSX Store
        </button>
        <button
          type="button"
          onClick={() => { setPanelTab("installed"); setSelectedExt(null); }}
          className={`flex-1 py-2 text-center text-[11px] font-medium transition-colors border-b-2 ${
            panelTab === "installed"
              ? "border-fahh-accent text-fahh-accent"
              : "border-transparent text-fahh-muted hover:text-fahh-text"
          }`}
        >
          Installed ({Object.keys(installedMap).length + plugins.length})
        </button>
      </div>

      {/* Search Input & Filter Options */}
      <div className="px-3 py-2 shrink-0 border-b border-fahh-surface bg-fahh-sidebar space-y-2">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-2 text-fahh-muted" />
          <input
            type="text"
            placeholder={
              panelTab === "marketplace"
                ? "Search 50,000+ extensions (e.g. rust, python)…"
                : "Filter installed extensions…"
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-fahh-bg text-fahh-text placeholder-fahh-muted rounded pl-7 pr-7 py-1.5 text-xs border border-fahh-surface focus:outline-none focus:border-fahh-accent"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-2 text-fahh-muted hover:text-fahh-text"
              title="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Categories Bar & Sort Controls */}
        {panelTab === "marketplace" && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
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

            <div className="flex items-center justify-between text-[10px] text-fahh-muted pt-1 border-t border-fahh-surface/40">
              <label className="flex items-center gap-1 cursor-pointer hover:text-fahh-text">
                <input
                  type="checkbox"
                  checked={verifiedOnly}
                  onChange={(e) => setVerifiedOnly(e.target.checked)}
                  className="rounded bg-fahh-bg border-fahh-surface text-fahh-accent focus:ring-0 w-3 h-3 cursor-pointer"
                />
                <ShieldCheck size={10} className="text-fahh-info" />
                <span>Verified only</span>
              </label>

              <div className="flex items-center gap-1">
                <SlidersHorizontal size={10} />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="bg-transparent text-fahh-muted hover:text-fahh-text text-[10px] cursor-pointer focus:outline-none"
                >
                  <option value="downloads">Most Popular</option>
                  <option value="rating">Top Rated</option>
                  <option value="name">Name (A-Z)</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Extension Details Modal/Drawer */}
      {selectedExt ? (
        <div className="flex-1 overflow-y-auto p-3 flex flex-col bg-fahh-surface/30">
          <button
            type="button"
            onClick={() => setSelectedExt(null)}
            className="flex items-center gap-1 text-[11px] text-fahh-muted hover:text-fahh-text mb-3"
          >
            ← Back to extensions list
          </button>

          <div className="bg-fahh-surface border border-fahh-surface p-3 rounded-lg space-y-3">
            <div className="flex items-start gap-3">
              {selectedExt.iconUrl ? (
                <img
                  src={selectedExt.iconUrl}
                  alt=""
                  className="w-10 h-10 rounded shrink-0 object-contain bg-fahh-bg p-1"
                />
              ) : (
                <div className="w-10 h-10 rounded bg-fahh-accent/20 text-fahh-accent font-bold flex items-center justify-center shrink-0 text-sm">
                  {selectedExt.displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <h3 className="font-semibold text-sm text-fahh-text truncate">
                    {selectedExt.displayName}
                  </h3>
                  {selectedExt.verified && (
                    <span title="Verified Publisher" className="inline-flex items-center">
                      <ShieldCheck size={13} className="text-fahh-info shrink-0" />
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-fahh-muted">
                  {selectedExt.namespace} · v{selectedExt.version}
                </p>
                {selectedExt.category && (
                  <span className="inline-flex items-center gap-0.5 mt-1 px-1.5 py-0.5 rounded text-[9.5px] bg-fahh-bg text-fahh-accent">
                    <Tag size={9} /> {selectedExt.category}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-fahh-surface/60">
              {installedMap[selectedExt.id] ? (
                <button
                  type="button"
                  onClick={() => handleUninstall(selectedExt.id)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs bg-fahh-surface text-fahh-error border border-fahh-error/30 hover:bg-fahh-error/10 font-medium transition-colors"
                >
                  <Trash2 size={12} />
                  <span>Uninstall Extension</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleInstall(selectedExt)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs bg-fahh-accent text-white font-medium hover:bg-fahh-accent/90 transition-colors shadow-sm"
                >
                  <Download size={12} />
                  <span>Install to Fahh Editor</span>
                </button>
              )}

              <a
                href={getVsixDownloadUrl(selectedExt.namespace, selectedExt.name, selectedExt.version)}
                target="_blank"
                rel="noreferrer"
                download
                className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded text-xs bg-fahh-surface text-fahh-muted hover:text-fahh-text border border-fahh-surface hover:border-fahh-muted transition-colors"
                title="Download raw .vsix package for manual loading"
              >
                <FileDown size={12} />
                <span>VSIX</span>
              </a>
            </div>

            <p className="text-xs text-fahh-text/90 leading-relaxed pt-2 border-t border-fahh-surface/60">
              {selectedExt.description}
            </p>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-fahh-surface/60 text-[11px] text-fahh-muted">
              <div>
                <span className="block text-[10px] uppercase text-fahh-muted/70">Downloads</span>
                <span className="font-medium text-fahh-text flex items-center gap-1">
                  <Download size={11} /> {formatDownloads(selectedExt.downloadCount)}
                </span>
              </div>
              <div>
                <span className="block text-[10px] uppercase text-fahh-muted/70">Rating</span>
                <span className="font-medium text-fahh-text flex items-center gap-1">
                  <Star size={11} className="text-yellow-400 fill-yellow-400" /> {selectedExt.averageRating.toFixed(1)} / 5.0
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-fahh-surface/60 flex items-center justify-between text-[11px]">
              <span className="text-fahh-muted">Identifier: {selectedExt.id}</span>
              <a
                href={`https://open-vsx.org/extension/${selectedExt.namespace}/${selectedExt.name}`}
                target="_blank"
                rel="noreferrer"
                className="text-fahh-accent hover:underline flex items-center gap-1"
              >
                Open VSX Page <ExternalLink size={10} />
              </a>
            </div>
          </div>
        </div>
      ) : (
        /* Main Extension List */
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
          {panelTab === "marketplace" ? (
            <>
              {searching ? (
                <div className="flex items-center justify-center gap-2 py-8 text-fahh-muted">
                  <RefreshCw size={13} className="animate-spin text-fahh-accent" />
                  <span>Searching Open VSX registry…</span>
                </div>
              ) : displayedMarketplace.length === 0 ? (
                <div className="text-center py-8 text-fahh-muted">
                  <p>No extensions found for &quot;{search}&quot;</p>
                </div>
              ) : (
                displayedMarketplace.map((ext) => {
                  const isInstalled = !!installedMap[ext.id];
                  return (
                    <div
                      key={ext.id}
                      className="p-2.5 rounded-lg bg-fahh-surface/80 border border-fahh-surface hover:border-fahh-accent/40 transition-all flex flex-col gap-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div
                          className="flex items-center gap-2 min-w-0 cursor-pointer flex-1"
                          onClick={() => setSelectedExt(ext)}
                        >
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
                              <span className="font-medium text-fahh-text text-xs truncate hover:text-fahh-accent">
                                {ext.displayName}
                              </span>
                              {ext.verified && (
                                <span title="Verified Publisher" className="inline-flex items-center">
                                  <ShieldCheck size={11} className="text-fahh-info shrink-0" />
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-fahh-muted truncate block">
                              {ext.namespace} · v{ext.version}
                            </span>
                          </div>
                        </div>

                        {/* Action Button */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setSelectedExt(ext)}
                            className="p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-bg transition-colors"
                            title="View details & VSIX download"
                          >
                            <Info size={12} />
                          </button>

                          {isInstalled ? (
                            <button
                              type="button"
                              onClick={() => handleUninstall(ext.id)}
                              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] bg-fahh-surface text-fahh-muted hover:text-fahh-error border border-fahh-surface hover:border-fahh-error/30 transition-colors"
                              title="Click to uninstall"
                            >
                              <Check size={11} className="text-fahh-success" />
                              <span>Installed</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleInstall(ext)}
                              className="flex items-center gap-1 px-2.5 py-0.5 rounded text-[10.5px] bg-fahh-accent text-white font-medium hover:bg-fahh-accent/90 transition-colors shadow-sm"
                            >
                              <Download size={11} />
                              <span>Install</span>
                            </button>
                          )}
                        </div>
                      </div>

                      <p
                        className="text-[11px] text-fahh-muted line-clamp-2 leading-relaxed cursor-pointer hover:text-fahh-text/80"
                        onClick={() => setSelectedExt(ext)}
                      >
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
                          href={getVsixDownloadUrl(ext.namespace, ext.name, ext.version)}
                          target="_blank"
                          rel="noreferrer"
                          download
                          className="hover:text-fahh-accent flex items-center gap-0.5"
                          title="Direct VSIX download"
                        >
                          .vsix <FileDown size={8} />
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
                      className="p-2.5 rounded bg-fahh-surface/80 border border-fahh-surface flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 cursor-pointer flex-1" onClick={() => setSelectedExt(ext)}>
                        <p className="font-medium text-xs text-fahh-text truncate hover:text-fahh-accent">
                          {ext.displayName}
                        </p>
                        <p className="text-[10px] text-fahh-muted">
                          {ext.namespace} · v{ext.version}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <a
                          href={getVsixDownloadUrl(ext.namespace, ext.name, ext.version)}
                          target="_blank"
                          rel="noreferrer"
                          download
                          className="p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-bg transition-colors"
                          title="Download VSIX package"
                        >
                          <FileDown size={12} />
                        </a>
                        <button
                          type="button"
                          onClick={() => handleUninstall(ext.id)}
                          className="p-1 rounded text-fahh-muted hover:text-fahh-error hover:bg-fahh-bg transition-colors"
                          title="Uninstall extension"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1.5 pt-1">
                <span className="text-[10px] uppercase tracking-wider text-fahh-muted font-semibold px-1">
                  Built-in Language &amp; Theme Packs ({plugins.length})
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
      )}
    </div>
  );
}
