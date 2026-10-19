import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Replace,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  X,
  ChevronsUpDown,
  CheckCheck,
  Filter,
} from "lucide-react";
import { useFileStore } from "../../store/fileStore";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useIconThemeStore } from "../../store/iconThemeStore";
import { revealLine } from "../../lib/monacoBridge";
import { searchWorkspace, replaceInWorkspace } from "../../lib/tauri";
import type { SearchMatch, SearchResult } from "../../lib/types";
import { renderFileIcon } from "../../lib/iconTheme";

interface FileGroup {
  filePath: string;
  relativePath: string;
  fileName: string;
  fileDir: string;
  matches: SearchMatch[];
}

export function SearchSidebar({
  initialFocusReplace = false,
}: {
  initialFocusReplace?: boolean;
}) {
  const root = useFileStore((s) => s.root);
  const { openFileInEditor } = useWorkspace();
  const activeIconTheme = useIconThemeStore((s) => s.activeIconTheme);

  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(initialFocusReplace);
  const [showFilters, setShowFilters] = useState(false);

  // Toggles
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [isRegex, setIsRegex] = useState(false);

  // Filter globs
  const [includeGlob, setIncludeGlob] = useState("");
  const [excludeGlob, setExcludeGlob] = useState("");

  // Search state
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});

  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    if (initialFocusReplace) {
      setShowReplace(true);
      setTimeout(() => replaceInputRef.current?.focus(), 50);
    } else {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [initialFocusReplace]);

  // Execute search
  const doSearch = useCallback(async () => {
    if (!root || !query.trim()) {
      setSearchResult(null);
      return;
    }

    setIsSearching(true);
    try {
      const res = await searchWorkspace(root, query, {
        caseSensitive,
        wholeWord,
        isRegex,
        includeGlob: includeGlob.trim() || undefined,
        excludeGlob: excludeGlob.trim() || undefined,
        maxResults: 2000,
      });
      setSearchResult(res);
      setCollapsedFiles({});
    } catch (err) {
      console.error("Search failed:", err);
      setSearchResult({ query, total_matches: 0, files_searched: 0, matches: [] });
    } finally {
      setIsSearching(false);
    }
  }, [root, query, caseSensitive, wholeWord, isRegex, includeGlob, excludeGlob]);

  // Debounced auto-search on query or toggle changes
  useEffect(() => {
    if (!query.trim()) {
      setSearchResult(null);
      return;
    }
    const timer = setTimeout(() => {
      void doSearch();
    }, 280);
    return () => clearTimeout(timer);
  }, [query, caseSensitive, wholeWord, isRegex, includeGlob, excludeGlob, doSearch]);

  // Group matches by file
  const fileGroups = useMemo<FileGroup[]>(() => {
    if (!searchResult || !searchResult.matches.length) return [];
    const map = new Map<string, SearchMatch[]>();
    for (const m of searchResult.matches) {
      const list = map.get(m.file) ?? [];
      list.push(m);
      map.set(m.file, list);
    }

    const groups: FileGroup[] = [];
    for (const [filePath, matches] of map.entries()) {
      let rel = filePath;
      if (root && filePath.startsWith(root)) {
        rel = filePath.slice(root.length).replace(/^[\\/]/, "");
      }
      const parts = rel.split(/[\\/]/);
      const name = parts.pop() ?? rel;
      const dir = parts.join("/");
      groups.push({
        filePath,
        relativePath: rel,
        fileName: name,
        fileDir: dir,
        matches,
      });
    }

    // Sort files alphabetically
    groups.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return groups;
  }, [searchResult, root]);

  // Toggle collapse for a single file
  const toggleFile = (filePath: string) => {
    setCollapsedFiles((prev) => ({ ...prev, [filePath]: !prev[filePath] }));
  };

  // Toggle collapse for all files
  const toggleAll = () => {
    const allCollapsed = fileGroups.every((g) => collapsedFiles[g.filePath]);
    const next: Record<string, boolean> = {};
    if (!allCollapsed) {
      for (const g of fileGroups) next[g.filePath] = true;
    }
    setCollapsedFiles(next);
  };

  // Replace in single file
  const handleReplaceFile = async (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!root || !query) return;
    try {
      await replaceInWorkspace(root, query, replacement, {
        caseSensitive,
        wholeWord,
        isRegex,
        files: [filePath],
      });
      void doSearch();
    } catch (err) {
      console.error("Replace file failed:", err);
    }
  };

  // Replace all across workspace
  const handleReplaceAll = async () => {
    if (!root || !query) return;
    try {
      await replaceInWorkspace(root, query, replacement, {
        caseSensitive,
        wholeWord,
        isRegex,
        includeGlob: includeGlob.trim() || undefined,
        excludeGlob: excludeGlob.trim() || undefined,
      });
      void doSearch();
    } catch (err) {
      console.error("Replace all failed:", err);
    }
  };

  // Click match to open in editor and reveal line
  const handleMatchClick = async (filePath: string, line: number) => {
    await openFileInEditor(filePath);
    setTimeout(() => {
      revealLine(line);
    }, 120);
  };

  return (
    <div className="flex flex-col h-full w-full bg-fahh-sidebar text-xs select-none overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-fahh-surface">
        <span className="font-semibold text-fahh-text tracking-wider uppercase text-[11px]">
          Search
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void doSearch()}
            title="Refresh Search"
            className="p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface transition-colors"
          >
            <RefreshCw size={13} className={isSearching ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={toggleAll}
            title="Toggle Collapse All"
            className="p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface transition-colors"
          >
            <ChevronsUpDown size={13} />
          </button>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSearchResult(null);
            }}
            title="Clear Search"
            className="p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* ── Inputs Section ── */}
      <div className="p-3 border-b border-fahh-surface flex flex-col gap-2 shrink-0">
        {/* Search input with toggle icons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowReplace((prev) => !prev)}
            title="Toggle Replace"
            className="p-1 text-fahh-muted hover:text-fahh-text transition-colors"
          >
            {showReplace ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <div className="flex-1 relative flex items-center">
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void doSearch()}
              placeholder="Search (Enter to search)"
              className="w-full bg-fahh-bg border border-fahh-surface rounded px-2.5 py-1 text-fahh-text placeholder-fahh-muted text-xs pr-16 focus:outline-none focus:border-fahh-accent"
            />
            {/* Query Options: Aa, \b, .* */}
            <div className="absolute right-1.5 flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setCaseSensitive((prev) => !prev)}
                title="Match Case (Alt+C)"
                className={`px-1 py-0.5 text-[10px] font-mono rounded transition-colors ${
                  caseSensitive
                    ? "bg-fahh-accent/20 text-fahh-accent border border-fahh-accent/40 font-bold"
                    : "text-fahh-muted hover:text-fahh-text"
                }`}
              >
                Aa
              </button>
              <button
                type="button"
                onClick={() => setWholeWord((prev) => !prev)}
                title="Match Whole Word (Alt+W)"
                className={`px-1 py-0.5 text-[10px] font-mono rounded transition-colors ${
                  wholeWord
                    ? "bg-fahh-accent/20 text-fahh-accent border border-fahh-accent/40 font-bold"
                    : "text-fahh-muted hover:text-fahh-text"
                }`}
              >
                \b
              </button>
              <button
                type="button"
                onClick={() => setIsRegex((prev) => !prev)}
                title="Use Regular Expression (Alt+R)"
                className={`px-1 py-0.5 text-[10px] font-mono rounded transition-colors ${
                  isRegex
                    ? "bg-fahh-accent/20 text-fahh-accent border border-fahh-accent/40 font-bold"
                    : "text-fahh-muted hover:text-fahh-text"
                }`}
              >
                .*
              </button>
            </div>
          </div>
        </div>

        {/* Replace input row (collapsible) */}
        {showReplace && (
          <div className="flex items-center gap-1 pl-5">
            <input
              ref={replaceInputRef}
              type="text"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="Replace"
              className="flex-1 bg-fahh-bg border border-fahh-surface rounded px-2.5 py-1 text-fahh-text placeholder-fahh-muted text-xs focus:outline-none focus:border-fahh-accent"
            />
            <button
              type="button"
              onClick={handleReplaceAll}
              title="Replace All"
              disabled={!fileGroups.length}
              className="p-1.5 rounded bg-fahh-surface/60 hover:bg-fahh-surface text-fahh-muted hover:text-fahh-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CheckCheck size={14} />
            </button>
          </div>
        )}

        {/* Filter toggle */}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => setShowFilters((prev) => !prev)}
            className="flex items-center gap-1 text-[11px] text-fahh-muted hover:text-fahh-text transition-colors"
          >
            <Filter size={11} />
            <span>{showFilters ? "Hide Filters" : "Files to include/exclude"}</span>
          </button>
          {searchResult && (
            <span className="text-[10px] text-fahh-muted font-mono">
              {searchResult.total_matches} {searchResult.total_matches === 1 ? "match" : "matches"} in {fileGroups.length} {fileGroups.length === 1 ? "file" : "files"}
            </span>
          )}
        </div>

        {/* Filter inputs (include / exclude) */}
        {showFilters && (
          <div className="flex flex-col gap-1.5 pt-1 pl-1 border-t border-fahh-surface/60">
            <div>
              <label className="text-[10px] text-fahh-muted block mb-0.5">files to include:</label>
              <input
                type="text"
                value={includeGlob}
                onChange={(e) => setIncludeGlob(e.target.value)}
                placeholder="e.g. *.ts, src/**"
                className="w-full bg-fahh-bg border border-fahh-surface rounded px-2 py-0.5 text-fahh-text placeholder-fahh-muted text-[11px] focus:outline-none focus:border-fahh-accent font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-fahh-muted block mb-0.5">files to exclude:</label>
              <input
                type="text"
                value={excludeGlob}
                onChange={(e) => setExcludeGlob(e.target.value)}
                placeholder="e.g. *.min.js, dist/**"
                className="w-full bg-fahh-bg border border-fahh-surface rounded px-2 py-0.5 text-fahh-text placeholder-fahh-muted text-[11px] focus:outline-none focus:border-fahh-accent font-mono"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Results List ── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-1">
        {!root ? (
          <div className="p-4 text-center text-fahh-muted text-[11px]">
            Open a folder to search across files.
          </div>
        ) : !query.trim() ? (
          <div className="p-4 text-center text-fahh-muted/70 text-[11px]">
            Type a query and press Enter to search across workspace.
          </div>
        ) : isSearching ? (
          <div className="p-4 text-center text-fahh-muted text-[11px] flex items-center justify-center gap-2">
            <RefreshCw size={13} className="animate-spin text-fahh-accent" />
            <span>Searching files...</span>
          </div>
        ) : fileGroups.length === 0 ? (
          <div className="p-4 text-center text-fahh-muted text-[11px]">
            No results found for &ldquo;{query}&rdquo;.
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {fileGroups.map((group) => {
              const isCollapsed = collapsedFiles[group.filePath];
              return (
                <div key={group.filePath} className="flex flex-col">
                  {/* File Row */}
                  <div
                    onClick={() => toggleFile(group.filePath)}
                    className="flex items-center justify-between px-2 py-1 rounded hover:bg-fahh-surface/60 cursor-pointer group transition-colors"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-fahh-muted/60 shrink-0">
                        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      </span>
                      <span className="shrink-0 flex items-center">
                        {renderFileIcon(group.fileName, activeIconTheme)}
                      </span>
                      <span className="font-medium text-fahh-text truncate text-[11.5px]">
                        {group.fileName}
                      </span>
                      {group.fileDir && (
                        <span className="text-[10px] text-fahh-muted/60 truncate font-mono">
                          {group.fileDir}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0 ml-1">
                      {showReplace && (
                        <button
                          type="button"
                          onClick={(e) => void handleReplaceFile(group.filePath, e)}
                          title={`Replace matches in ${group.fileName}`}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-fahh-surface text-fahh-muted hover:text-fahh-accent transition-all"
                        >
                          <Replace size={11} />
                        </button>
                      )}
                      <span className="px-1.5 py-0.2 rounded-full bg-fahh-surface text-[10px] text-fahh-muted font-mono font-medium">
                        {group.matches.length}
                      </span>
                    </div>
                  </div>

                  {/* Matching Lines */}
                  {!isCollapsed && (
                    <div className="flex flex-col pl-6 pr-1 py-0.5 border-l border-fahh-surface/40 ml-3.5 my-0.5">
                      {group.matches.map((m, idx) => {
                        // Highlight matched substring
                        const start = Math.max(0, m.match_start);
                        const end = Math.min(m.line_text.length, m.match_end);
                        const before = m.line_text.slice(0, start).trimStart();
                        const matchText = m.line_text.slice(start, end);
                        const after = m.line_text.slice(end);

                        return (
                          <div
                            key={idx}
                            onClick={() => void handleMatchClick(group.filePath, m.line_number)}
                            className="flex items-baseline gap-2 px-1.5 py-0.5 rounded hover:bg-fahh-surface/70 cursor-pointer text-[11px] font-mono group transition-colors"
                          >
                            <span className="text-[10px] text-fahh-accent/80 shrink-0 font-medium">
                              {m.line_number}:
                            </span>
                            <span className="text-fahh-muted truncate flex-1 leading-relaxed">
                              <span>{before}</span>
                              <mark className="bg-fahh-accent/30 text-fahh-accent font-semibold px-0.5 rounded">
                                {matchText}
                              </mark>
                              <span>{after}</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
