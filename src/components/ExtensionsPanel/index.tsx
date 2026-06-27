import { useEffect, useState } from "react";
import { getPlugins } from "../../lib/tauri";
import type { Plugin, PluginKind } from "../../lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = "themes" | "languages" | "formatters";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "themes", label: "Themes" },
  { id: "languages", label: "Languages" },
  { id: "formatters", label: "Formatters" },
];

const KIND_FOR_TAB: Record<TabId, PluginKind[]> = {
  themes: ["theme"],
  languages: ["language"],
  formatters: ["formatter"],
};

// ─── Badge colours ────────────────────────────────────────────────────────────

const KIND_BADGE: Record<PluginKind, { label: string; className: string }> = {
  theme: {
    label: "Theme",
    className: "bg-fahh-accent/20 text-fahh-accent",
  },
  language: {
    label: "Language",
    className: "bg-fahh-info/20 text-fahh-info",
  },
  formatter: {
    label: "Formatter",
    className: "bg-fahh-success/20 text-fahh-success",
  },
  linter: {
    label: "Linter",
    className: "bg-fahh-warn/20 text-fahh-warn",
  },
  builtin: {
    label: "Built-in",
    className: "bg-fahh-surface text-fahh-muted",
  },
};

// ─── Plugin card ──────────────────────────────────────────────────────────────

function PluginCard({ plugin }: { plugin: Plugin }) {
  const badge = KIND_BADGE[plugin.kind];

  return (
    <div className="flex flex-col gap-1.5 p-3 rounded-lg bg-fahh-surface border border-fahh-surface hover:border-fahh-muted transition-colors">
      {/* Header row */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-fahh-text truncate">{plugin.name}</p>
          <p className="text-[10px] text-fahh-muted">{plugin.author} · v{plugin.version}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
          {/* Kind badge */}
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${badge.className}`}
          >
            {badge.label}
          </span>
          {/* Built-in badge */}
          {plugin.builtin && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-fahh-surface text-fahh-muted border border-fahh-muted/30">
              Built-in
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-[11px] text-fahh-muted leading-relaxed">{plugin.description}</p>

      {/* Language pack: extensions list */}
      {plugin.kind === "language" && plugin.extensions && plugin.extensions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {plugin.extensions.map((ext) => (
            <span
              key={ext}
              className="text-[10px] px-1 py-0.5 rounded bg-fahh-bg text-fahh-info font-mono border border-fahh-surface"
            >
              .{ext}
            </span>
          ))}
        </div>
      )}

      {/* Formatter: command */}
      {plugin.kind === "formatter" && plugin.command && (
        <p className="text-[10px] font-mono text-fahh-success bg-fahh-bg px-2 py-1 rounded border border-fahh-surface truncate">
          $ {plugin.command}
        </p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ExtensionsPanel() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("themes");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    getPlugins()
      .then((list) => {
        if (mounted) {
          setPlugins(list);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (mounted) {
          setError(String(err));
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const targetKinds = KIND_FOR_TAB[activeTab];
  const filtered = plugins.filter(
    (p) =>
      targetKinds.includes(p.kind) &&
      (search === "" ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.description.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex flex-col h-full text-xs text-fahh-text overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-fahh-surface shrink-0 bg-fahh-sidebar">
        {TABS.map((tab) => {
          const count = plugins.filter((p) =>
            KIND_FOR_TAB[tab.id].includes(p.kind)
          ).length;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2 text-center text-[11px] font-medium transition-colors border-b-2 ${
                activeTab === tab.id
                  ? "border-fahh-accent text-fahh-accent"
                  : "border-transparent text-fahh-muted hover:text-fahh-text"
              }`}
            >
              {tab.label}
              {!loading && (
                <span className="ml-1 text-[10px] text-fahh-muted">({count})</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="px-3 py-2 shrink-0 border-b border-fahh-surface bg-fahh-sidebar">
        <input
          type="text"
          placeholder={`Search ${activeTab}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-fahh-surface text-fahh-text placeholder-fahh-muted rounded px-2 py-1 text-xs border border-fahh-surface focus:outline-none focus:border-fahh-accent"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && (
          <div className="text-fahh-muted text-center py-8">
            Loading extensions…
          </div>
        )}

        {error && !loading && (
          <div className="text-fahh-error bg-fahh-error/10 border border-fahh-error/30 rounded p-3">
            Failed to load plugins: {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-fahh-muted text-center py-8">
            {search ? "No results for your search." : `No ${activeTab} installed.`}
          </div>
        )}

        {!loading &&
          !error &&
          filtered.map((plugin) => (
            <PluginCard key={plugin.id} plugin={plugin} />
          ))}
      </div>
    </div>
  );
}
