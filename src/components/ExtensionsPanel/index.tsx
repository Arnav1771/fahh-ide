import { loader } from "@monaco-editor/react";
import { extInstallTheme } from "../../lib/tauri";
import { convertVsCodeTheme } from "../../lib/vscodeTheme";
import { useExtensionThemes } from "../../store/extensionThemesStore";
import { DEFAULT_THEME, useThemeStore } from "../../store/themeStore";
import { allThemes, applyThemeCssVars, defineExtensionThemes } from "../ThemePanel";
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
  Palette,
  FileText,
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
  /** Absent when nobody has rated it. */
  averageRating?: number;
  iconUrl?: string;
  category?: string;
  verified?: boolean;
}

export const INSTALLED_EXTENSIONS_KEY = "fahh-installed-extensions";

/** The categories the panel offers, as Open VSX names them (its search filters by these). */
export const OPEN_VSX_CATEGORIES: Record<string, string | null> = {
  All: null,
  Themes: "Themes",
  Languages: "Programming Languages",
  Formatters: "Formatters",
  Linters: "Linters",
};

/**
 * The Open VSX search for the panel. An empty query lists the most downloaded extensions of
 * the category. Everything shown comes from the registry; nothing is bundled.
 */
export function openVsxSearchUrl(query: string, category: string): string {
  const params = new URLSearchParams({ size: "30", sortBy: "downloadCount", sortOrder: "desc" });
  if (query.trim()) params.set("query", query.trim());
  const cat = OPEN_VSX_CATEGORIES[category];
  if (cat) params.set("category", cat);
  return `https://open-vsx.org/api/-/search?${params}`;
}

/** One Open VSX search entry. Missing stats stay missing (no invented rating or version). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fromOpenVsx(e: any): MarketplaceExtension {
  return {
    id: `${e.namespace}.${e.name}`,
    namespace: String(e.namespace),
    name: String(e.name),
    displayName: e.displayName || e.name,
    description: e.description || "",
    version: e.version || "",
    downloadCount: typeof e.downloadCount === "number" ? e.downloadCount : 0,
    averageRating: typeof e.averageRating === "number" ? e.averageRating : undefined,
    iconUrl: e.files?.icon,
    verified: !!e.verified,
  };
}

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
    if (sortBy === "rating") return (b.averageRating ?? -1) - (a.averageRating ?? -1);
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

export function isPdfExtension(ext: MarketplaceExtension): boolean {
  const s = `${ext.id} ${ext.name} ${ext.displayName} ${ext.description}`.toLowerCase();
  return s.includes("pdf");
}

export function ExtensionsPanel() {
  const [panelTab, setPanelTab] = useState<"marketplace" | "installed">("marketplace");
  const [search, setSearch] = useState("");
  // Fahh installs colour themes, so the registry's themes come first.
  const [category, setCategory] = useState<string>("Themes");
  const [sortBy, setSortBy] = useState<SortOption>("downloads");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [selectedExt, setSelectedExt] = useState<MarketplaceExtension | null>(null);

  const [installedMap, setInstalledMap] = useState<Record<string, MarketplaceExtension>>(() => {
    try {
      const saved: Record<string, MarketplaceExtension> = JSON.parse(localStorage.getItem(INSTALLED_EXTENSIONS_KEY) || "{}");
      // Before themes were really installed, "Install" only recorded the click: drop those.
      const real = new Set(useExtensionThemes.getState().themes.map((t) => t.extId));
      return Object.fromEntries(Object.entries(saved).filter(([id]) => real.has(id)));
    } catch {
      return {};
    }
  });
  const [busy, setBusy] = useState<string | null>(null);

  // Local/built-in plugins from backend
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [_backendLoading, setBackendLoading] = useState(true);

  // Live Open VSX search results
  const [searchResults, setSearchResults] = useState<MarketplaceExtension[]>([]);
  const [searching, setSearching] = useState(true);
  const [registryError, setRegistryError] = useState<string | null>(null);

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

  const [themeToast, setThemeToast] = useState<string | null>(null);

  const isPdfExtension = (ext: MarketplaceExtension) => {
    const s = `${ext.id} ${ext.name} ${ext.displayName} ${ext.description}`.toLowerCase();
    return s.includes("pdf");
  };

  // Save installed map to localStorage
  const saveInstalled = (next: Record<string, MarketplaceExtension>) => {
    setInstalledMap(next);
    try {
      localStorage.setItem(INSTALLED_EXTENSIONS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  /**
   * Fahh has no VS Code extension host: it installs what it can really use, colour themes
   * (downloaded from Open VSX and converted), and says so for anything else.
   */
  const handleInstall = async (ext: MarketplaceExtension) => {
    if (isPdfExtension(ext)) {
      setThemeToast("No need: Fahh opens .pdf files itself. Open one from the explorer.");
      return;
    }
    setBusy(ext.id);
    try {
      const found = await extInstallTheme(ext.namespace, ext.name, "");
      const themes = found.map((t) => convertVsCodeTheme(ext.id, t.label, t.ui_theme, t.json, t.include_json ?? undefined));
      useExtensionThemes.getState().add(ext.id, themes);
      const monaco = await loader.init().catch(() => null);
      if (monaco) defineExtensionThemes(monaco, themes);
      saveInstalled({ ...installedMap, [ext.id]: ext });
      setThemeToast(`Installed ${themes.map((t) => t.name).join(", ")}. Pick it in Colour Theme (or the palette: Theme).`);
    } catch (e) {
      setThemeToast(`${ext.displayName}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleUninstall = (id: string) => {
    const gone = useExtensionThemes.getState().themes.filter((t) => t.extId === id).map((t) => t.id as string);
    useExtensionThemes.getState().remove(id);
    // Using a theme that is going away: back to the default one.
    const { activeTheme, setTheme } = useThemeStore.getState();
    if (gone.includes(activeTheme)) {
      setTheme(DEFAULT_THEME);
      const def = allThemes().find((d) => d.id === DEFAULT_THEME);
      if (def) applyThemeCssVars(def);
    }
    const next = { ...installedMap };
    delete next[id];
    saveInstalled(next);
  };

  // Open VSX search (debounced while typing). Offline: say so; never a bundled stand-in list.
  useEffect(() => {
    let live = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(openVsxSearchUrl(search, category));
        if (!res.ok) throw new Error(`Open VSX answered ${res.status}`);
        const data = await res.json();
        if (!live) return;
        setSearchResults(Array.isArray(data?.extensions) ? data.extensions.map(fromOpenVsx) : []);
        setRegistryError(null);
      } catch (e) {
        if (!live) return;
        setSearchResults([]);
        setRegistryError(`Could not reach the Open VSX registry (${e instanceof Error ? e.message : String(e)}). Check your connection and search again.`);
      } finally {
        if (live) setSearching(false);
      }
    }, search.trim() ? 300 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search, category]);

  // Filter and sort marketplace results
  const displayedMarketplace = useMemo(() => {
    // The registry already filtered by query and category.
    const filtered = filterExtensions(searchResults, "", "All", verifiedOnly);
    return sortExtensions(filtered, sortBy);
  }, [searchResults, verifiedOnly, sortBy]);

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

      <p className="mx-3 mt-2 text-[11px] text-fahh-muted">
        Install works for colour themes from Open VSX. Other VS Code extensions need an extension host, which Fahh does not have yet; Fahh says so when you try.
      </p>

      {/* Dynamic Theme Activation Notification */}
      {themeToast && (
        <div className="mx-3 mt-2 px-2.5 py-1.5 rounded-lg bg-fahh-accent/15 border border-fahh-accent/40 text-fahh-accent text-[11px] flex items-center justify-between shrink-0">
          <span className="flex items-center gap-1.5 truncate">
            <Palette size={12} className="shrink-0" />
            <span className="truncate">{themeToast}</span>
          </span>
          <button
            type="button"
            onClick={() => setThemeToast(null)}
            className="text-xs hover:text-fahh-text ml-2 text-fahh-muted"
          >
            &times;
          </button>
        </div>
      )}

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
              {Object.keys(OPEN_VSX_CATEGORIES).map((cat) => (
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

      {/* Native PDF Viewer Helper Callout */}
      {search.trim().toLowerCase().includes("pdf") && (
        <div className="mx-3 mt-2.5 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-fahh-text space-y-1 shrink-0">
          <div className="flex items-center gap-1.5 text-red-400 font-semibold text-[11px]">
            <FileText size={13} />
            <span>Built-in Native Feature: PDF Viewer</span>
          </div>
          <p className="text-[10.5px] text-fahh-muted leading-relaxed">
            Fahh Editor includes a native PDF viewer powered by WebView2 with zoom, scroll, text selection, and system app handoff. You do <strong>not</strong> need a VS Code extension to open PDFs — simply click any <code className="text-red-400">.pdf</code> file in your workspace!
          </p>
        </div>
      )}

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

            {/* Native PDF Notice */}
            {isPdfExtension(selectedExt) && (
              <div className="p-2.5 rounded-lg bg-fahh-error/10 border border-fahh-error/30 text-[11px] text-fahh-text space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-fahh-error">
                  <FileText size={13} />
                  <span>Built-in Native PDF Viewer in Fahh Editor</span>
                </div>
                <p className="text-fahh-text/80 leading-relaxed text-[10.5px]">
                  This extension was built for Microsoft VS Code&apos;s Node.js extension host. Fahh Editor already includes a native, hardware-accelerated PDF viewer built into the core. Opening any <code>.pdf</code> file in your project opens directly in the viewer with zero extensions needed.
                </p>
              </div>
            )}

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
                  onClick={() => void handleInstall(selectedExt)}
                  disabled={busy !== null}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs bg-fahh-accent text-white font-medium hover:bg-fahh-accent/90 transition-colors shadow-sm disabled:opacity-60"
                >
                  <Download size={12} />
                  <span>{busy === selectedExt.id ? "Installing…" : "Install to Fahh Editor"}</span>
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
                  <Star size={11} className="text-yellow-400 fill-yellow-400" /> {selectedExt.averageRating !== undefined ? `${selectedExt.averageRating.toFixed(1)} / 5.0` : "No ratings yet"}
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
              ) : registryError ? (
                <div role="alert" className="text-center py-8 text-fahh-muted">
                  <p>{registryError}</p>
                </div>
              ) : displayedMarketplace.length === 0 ? (
                <div className="text-center py-8 text-fahh-muted">
                  <p>{search.trim() ? <>No extensions found for &quot;{search}&quot;</> : "No extensions in this category."}</p>
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
                            <span className="text-[10px] text-fahh-muted truncate flex items-center gap-1.5">
                              <span>{ext.namespace} · v{ext.version}</span>
                              {isPdfExtension(ext) && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] bg-red-500/15 text-red-400 border border-red-500/25 font-medium shrink-0">
                                  Native PDF
                                </span>
                              )}
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
                            <>
                              <button
                                type="button"
                                onClick={() => handleUninstall(ext.id)}
                                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] bg-fahh-surface text-fahh-muted hover:text-fahh-error border border-fahh-surface hover:border-fahh-error/30 transition-colors"
                                title="Click to uninstall"
                              >
                                <Check size={11} className="text-fahh-success" />
                                <span>Installed</span>
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleInstall(ext)}
                              disabled={busy !== null}
                              className="flex items-center gap-1 px-2.5 py-0.5 rounded text-[10.5px] bg-fahh-accent text-white font-medium hover:bg-fahh-accent/90 transition-colors shadow-sm disabled:opacity-60"
                            >
                              <Download size={11} />
                              <span>{busy === ext.id ? "Installing…" : "Install"}</span>
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
                          {ext.averageRating !== undefined ? ext.averageRating.toFixed(1) : "—"}
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

              {plugins.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <span className="text-[10px] uppercase tracking-wider text-fahh-muted font-semibold px-1">
                  Plugins in ~/.fahh/plugins ({plugins.length})
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
                    <span className="text-[10px] text-fahh-muted/70 shrink-0">{plugin.version}</span>
                  </div>
                ))}
              </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
