import { useMemo, useState } from "react";
import { BookOpenText, Search, Sparkles } from "lucide-react";
import { useDeepWikiStore } from "../../store/deepwikiStore";
import { useFileStore } from "../../store/fileStore";
import { useAgentStore } from "../../store/agentStore";
import { openAt } from "../../lib/navigation";
import { revealView } from "../../lib/workbench";
import { explainPrompt } from "../../lib/deepwiki";
import { basenameOf } from "../../lib/launchConfig";
import type { SearchMatch } from "../../lib/types";

function Hit({ m, root }: { m: SearchMatch; root: string | null }) {
  const rel = root && m.file.startsWith(root) ? m.file.slice(root.length).replace(/^[\\/]/, "") : m.file;
  return (
    <button
      onClick={() => void openAt(m.file, m.line_number, m.match_start + 1)}
      className="w-full text-left px-3 py-1 hover:bg-fahh-surface/50"
      title={`${rel}:${m.line_number}`}
    >
      <div className="text-[11px] text-fahh-muted truncate">
        {basenameOf(m.file)}
        <span className="opacity-70">
          {" "}
          {rel.length > basenameOf(m.file).length ? rel.slice(0, -basenameOf(m.file).length - 1) : ""} :{m.line_number}
        </span>
      </div>
      <div className="font-mono text-xs text-fahh-text truncate">{m.line_text.trim()}</div>
    </button>
  );
}

/** DeepWiki: right-click a symbol, See Wiki. Definition, docs, usages, and an AI write-up. */
export function DeepWiki() {
  const { symbol, loading, error, definitions, usages, doc, history, lookup } = useDeepWikiStore();
  const root = useFileStore((s) => s.root);
  const [query, setQuery] = useState("");
  const usageFiles = useMemo(() => [...new Set(usages.map((u) => u.file))], [usages]);

  const explain = () => {
    if (!symbol || !root) return;
    void useAgentStore.getState().send(explainPrompt(symbol, definitions[0], usageFiles, root), { mode: "plan" });
    revealView("agent");
  };

  return (
    <div className="flex flex-col h-full overflow-hidden text-sm" data-testid="deepwiki">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void lookup(query);
        }}
        className="flex items-center gap-1 m-2 px-2 py-1 rounded bg-fahh-surface"
      >
        <Search size={13} className="text-fahh-muted" />
        <input
          aria-label="Look up a symbol"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Look up a symbol"
          className="flex-1 bg-transparent outline-none text-xs placeholder:text-fahh-muted"
        />
      </form>

      {!symbol ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center text-fahh-muted">
          <BookOpenText size={28} />
          <div className="text-fahh-text">Welcome to DeepWiki</div>
          <p className="text-xs">
            Right-click a symbol in the editor and choose <span className="text-fahh-accent">See Wiki</span> to see where it is defined, its documentation, and
            everywhere it is used.
          </p>
          {history.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1">
              {history.slice(0, 6).map((h) => (
                <button key={h} onClick={() => void lookup(h)} className="px-2 py-0.5 rounded bg-fahh-surface text-xs hover:text-fahh-text">
                  {h}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 pb-2 flex items-center gap-2">
            <h2 className="font-mono text-base text-fahh-text truncate flex-1" title={symbol}>
              {symbol}
            </h2>
            <button
              onClick={explain}
              disabled={loading || !root}
              title="Ask Fahh Local for a wiki page about this symbol (read-only)"
              className="flex items-center gap-1 px-2 py-1 rounded bg-fahh-accent/20 text-fahh-accent text-xs hover:bg-fahh-accent/30 disabled:opacity-40"
            >
              <Sparkles size={12} /> Explain
            </button>
          </div>
          {loading && <p className="px-3 text-xs text-fahh-muted">Searching the workspace…</p>}
          {error && <p className="px-3 text-xs text-fahh-error">{error}</p>}
          {!loading && !error && (
            <>
              <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide font-semibold text-fahh-muted">Documentation</div>
              {doc ? (
                <pre className="mx-3 mb-2 p-2 rounded bg-fahh-surface/60 text-xs whitespace-pre-wrap font-sans text-fahh-text">{doc}</pre>
              ) : (
                <p className="px-3 pb-2 text-xs text-fahh-muted">{definitions.length ? "No doc comment on the definition." : "No definition found to read docs from."}</p>
              )}

              <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide font-semibold text-fahh-muted">
                Definition{definitions.length === 1 ? "" : "s"} ({definitions.length})
              </div>
              {definitions.length === 0 && <p className="px-3 pb-2 text-xs text-fahh-muted">Not defined in this folder (a library or built-in?).</p>}
              {definitions.map((m) => (
                <Hit key={`${m.file}:${m.line_number}`} m={m} root={root} />
              ))}

              <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wide font-semibold text-fahh-muted">
                Usages ({usages.length} in {usageFiles.length} {usageFiles.length === 1 ? "file" : "files"})
              </div>
              {usages.length === 0 && <p className="px-3 pb-2 text-xs text-fahh-muted">No other uses found.</p>}
              {usages.map((m) => (
                <Hit key={`${m.file}:${m.line_number}:${m.match_start}`} m={m} root={root} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
