import React, { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  X,
  Maximize2,
  Minimize2,
  Plus,
  FileCode,
  Check,
  Layers,
  Terminal,
  AlertTriangle,
} from "lucide-react";
import { useComposerStore, type AttachedContext } from "../../store/composerStore";
import { useFileStore } from "../../store/fileStore";
import { MentionMenu } from "../MentionMenu";
import { flattenTree } from "../../lib/quickOpen";

export function Composer() {
  const {
    isOpen,
    isExpanded,
    prompt,
    targetFiles,
    attachedContexts,
    status,
    timeline,
    fileDiffs,
    activeDiffFile,
    closeComposer,
    toggleExpanded,
    setPrompt,
    addTargetFile,
    removeTargetFile,
    attachContext,
    removeContext,
    setActiveDiffFile,
    startExecution,
    acceptFile,
    rejectFile,
    acceptAll,
    rejectAll,
  } = useComposerStore();

  const tree = useFileStore((s) => s.tree);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [showFilePicker, setShowFilePicker] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  // Handle keyboard shortcuts inside Composer
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (status === "review") {
        void acceptAll();
      } else if (status === "idle" || status === "done") {
        void startExecution();
      }
    } else if (e.key === "Escape" && !showMentionMenu && !showFilePicker) {
      e.preventDefault();
      closeComposer();
    } else if (e.key === "@") {
      setShowMentionMenu(true);
      setMentionQuery("");
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setPrompt(val);

    const lastAt = val.lastIndexOf("@");
    if (lastAt !== -1 && lastAt >= val.length - 15) {
      const q = val.slice(lastAt + 1);
      if (!q.includes(" ")) {
        setShowMentionMenu(true);
        setMentionQuery(q);
        return;
      }
    }
    setShowMentionMenu(false);
  };

  const handleSelectMention = (ctx: AttachedContext) => {
    attachContext(ctx);
    setShowMentionMenu(false);
    // Remove the trailing @query from input
    const lastAt = prompt.lastIndexOf("@");
    if (lastAt !== -1) {
      setPrompt(prompt.slice(0, lastAt));
    }
    inputRef.current?.focus();
  };

  if (!isOpen) return null;

  const activeDiff = activeDiffFile ? fileDiffs[activeDiffFile] : null;
  const isExecuting = status === "planning" || status === "generating";

  return (
    <div
      className={`fixed z-50 transition-all duration-200 select-none ${
        isExpanded
          ? "inset-4"
          : "bottom-8 right-8 w-[640px] max-h-[82vh] h-[600px]"
      } flex flex-col rounded-2xl bg-[#141311]/95 border border-[#4a9eff]/40 shadow-[0_25px_60px_rgba(0,0,0,0.85),0_0_0_1px_rgba(74,158,255,0.3)] backdrop-blur-3xl overflow-hidden font-sans text-xs text-[#e8e6e3]`}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#181816] border-b border-white/[0.08] cursor-move">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-[#4a9eff] shadow-[0_0_8px_#4a9eff]" />
          <span className="font-semibold text-[#e8e6e3] tracking-wide">
            Cursor Composer (Ctrl+I)
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#4a9eff]/15 text-[#4a9eff] font-mono">
            multi-file agent
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleExpanded}
            title={isExpanded ? "Collapse" : "Full Screen"}
            className="p-1 rounded text-[#8a8780] hover:text-[#e8e6e3] transition-colors"
          >
            {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button
            type="button"
            onClick={closeComposer}
            title="Close (Esc)"
            className="p-1 rounded text-[#8a8780] hover:text-[#e8e6e3] transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── Main Body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Side: Context & Prompt */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-white/[0.08] bg-[#141311]">
          {/* Target Files Strip */}
          <div className="p-2.5 border-b border-white/[0.06] flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase font-semibold text-[#8a8780] tracking-wider shrink-0 mr-1">
              Targets:
            </span>
            {targetFiles.map((file) => {
              const name = file.split(/[/\\]/).pop() || file;
              return (
                <div
                  key={file}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#1e1e1c] border border-white/10 text-[11px] text-[#e8e6e3]"
                >
                  <FileCode size={11} className="text-[#4a9eff]" />
                  <span className="truncate max-w-[120px]">{name}</span>
                  <button
                    type="button"
                    onClick={() => removeTargetFile(file)}
                    className="hover:text-red-400 ml-0.5"
                  >
                    <X size={10} />
                  </button>
                </div>
              );
            })}

            {/* Add Target File Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowFilePicker((v) => !v)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 border border-dashed border-white/20 text-[10px] text-[#8a8780] hover:text-[#e8e6e3] transition-colors"
              >
                <Plus size={10} /> Add File
              </button>

              {showFilePicker && (
                <div className="absolute top-full left-0 mt-1 z-50 w-64 max-h-48 overflow-y-auto rounded-lg bg-[#181816] border border-white/10 shadow-xl p-1 text-xs">
                  <div className="px-2 py-1 text-[10px] text-[#8a8780] font-semibold border-b border-white/5">
                    Select Target File
                  </div>
                  {flattenTree(tree).map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      onClick={() => {
                        addTargetFile(f.path);
                        setShowFilePicker(false);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-white/10 truncate"
                    >
                      <FileCode size={12} className="text-[#4a9eff] shrink-0" />
                      <span className="truncate">{f.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Attached Context Pills (@mentions) */}
          {attachedContexts.length > 0 && (
            <div className="px-2.5 py-1.5 border-b border-white/[0.06] flex items-center gap-1.5 flex-wrap bg-[#181816]/50">
              <span className="text-[10px] uppercase font-semibold text-[#8a8780] tracking-wider shrink-0">
                Context:
              </span>
              {attachedContexts.map((ctx) => (
                <div
                  key={ctx.id}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#4a9eff]/15 border border-[#4a9eff]/30 text-[10px] text-[#4a9eff]"
                >
                  <span>{ctx.label}</span>
                  <button
                    type="button"
                    onClick={() => removeContext(ctx.id)}
                    className="hover:text-red-400 ml-0.5"
                  >
                    <X size={9} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Prompt Input Box */}
          <div className="relative flex-1 p-2.5 flex flex-col min-h-0">
            {showMentionMenu && (
              <MentionMenu
                query={mentionQuery}
                onSelect={handleSelectMention}
                onClose={() => setShowMentionMenu(false)}
              />
            )}

            <textarea
              ref={inputRef}
              value={prompt}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={isExecuting}
              placeholder="Describe your multi-file edits, refactor instructions, or new feature... Type @ to reference files, problems, terminal, or git"
              className="w-full flex-1 bg-transparent resize-none outline-none text-xs text-[#e8e6e3] placeholder:text-[#6a6760] font-sans leading-relaxed"
            />
          </div>

          {/* Timeline / Progress Checklist */}
          {timeline.length > 0 && (
            <div className="p-2.5 bg-[#181816]/70 border-t border-white/[0.06] flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[10px] uppercase font-semibold text-[#8a8780] tracking-wider">
                <span>Autonomous Execution Plan</span>
                <span>{status.toUpperCase()}</span>
              </div>
              <div className="flex flex-col gap-1">
                {timeline.map((step) => (
                  <div key={step.id} className="flex items-center gap-2 text-xs">
                    <div
                      className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] shrink-0 font-bold ${
                        step.status === "completed"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : step.status === "running"
                          ? "bg-[#4a9eff]/20 text-[#4a9eff] animate-pulse"
                          : "bg-white/5 text-[#8a8780]"
                      }`}
                    >
                      {step.status === "completed" ? "✓" : step.id}
                    </div>
                    <span
                      className={`flex-1 truncate ${
                        step.status === "completed"
                          ? "text-[#e8e6e3]"
                          : step.status === "running"
                          ? "text-[#4a9eff] font-medium"
                          : "text-[#8a8780]"
                      }`}
                    >
                      {step.title}
                    </span>
                    {step.detail && (
                      <span className="text-[10px] text-[#8a8780] font-mono shrink-0">
                        {step.detail}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom Execution Bar */}
          <div className="p-2.5 bg-[#181816] border-t border-white/[0.08] flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[10px] text-[#8a8780]">
              <span className="font-mono">Ctrl+Enter</span>
              <span>to execute</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  attachContext({
                    id: "context-problems-fast",
                    type: "problems",
                    label: "@problems",
                  });
                }}
                className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[10px] text-[#8a8780] hover:text-[#e8e6e3] flex items-center gap-1 transition-colors"
              >
                <AlertTriangle size={11} className="text-amber-400" />
                <span>+ Problems</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  attachContext({
                    id: "context-terminal-fast",
                    type: "terminal",
                    label: "@terminal",
                  });
                }}
                className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[10px] text-[#8a8780] hover:text-[#e8e6e3] flex items-center gap-1 transition-colors"
              >
                <Terminal size={11} className="text-cyan-400" />
                <span>+ Terminal</span>
              </button>

              <button
                type="button"
                onClick={startExecution}
                disabled={isExecuting || !prompt.trim() || targetFiles.length === 0}
                className="px-3.5 py-1.5 rounded-lg bg-[#4a9eff] hover:bg-[#3d8be6] disabled:opacity-50 text-[#0a0907] font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Sparkles size={13} className={isExecuting ? "animate-spin" : ""} />
                <span>{isExecuting ? "Composing..." : "Compose"}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Side: Multi-File Diff Preview (when changes are generated) */}
        {Object.keys(fileDiffs).length > 0 && (
          <div className="w-[300px] flex flex-col bg-[#11100e] border-l border-white/[0.08]">
            {/* Diff Header */}
            <div className="p-2.5 border-b border-white/[0.08] flex items-center justify-between bg-[#161513]">
              <div className="flex items-center gap-1.5">
                <Layers size={13} className="text-[#4a9eff]" />
                <span className="font-semibold text-xs text-[#e8e6e3]">
                  Changed Files ({Object.keys(fileDiffs).length})
                </span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={acceptAll}
                  className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 font-semibold text-[10px] transition-colors"
                >
                  Accept All
                </button>
                <button
                  type="button"
                  onClick={rejectAll}
                  className="px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-400 font-semibold text-[10px] transition-colors"
                >
                  Reject All
                </button>
              </div>
            </div>

            {/* File List */}
            <div className="p-1.5 flex flex-col gap-1 overflow-y-auto max-h-40 border-b border-white/[0.06]">
              {Object.values(fileDiffs).map((diff) => {
                const name = diff.path.split(/[/\\]/).pop() || diff.path;
                const isSelected = activeDiffFile === diff.path;
                return (
                  <div
                    key={diff.path}
                    onClick={() => setActiveDiffFile(diff.path)}
                    className={`flex items-center justify-between p-1.5 rounded cursor-pointer transition-colors ${
                      isSelected ? "bg-[#4a9eff]/20 text-[#e8e6e3]" : "hover:bg-white/5 text-[#8a8780]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <FileCode size={12} className={isSelected ? "text-[#4a9eff]" : "text-[#8a8780]"} />
                      <span className="truncate">{name}</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {diff.status === "accepted" ? (
                        <span className="text-[10px] text-emerald-400 font-semibold">Accepted</span>
                      ) : diff.status === "rejected" ? (
                        <span className="text-[10px] text-red-400 font-semibold">Rejected</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void acceptFile(diff.path);
                            }}
                            title="Accept changes for this file"
                            className="p-1 rounded hover:bg-emerald-500/20 text-emerald-400"
                          >
                            <Check size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              rejectFile(diff.path);
                            }}
                            title="Reject changes for this file"
                            className="p-1 rounded hover:bg-red-500/20 text-red-400"
                          >
                            <X size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Active File Diff View */}
            <div className="flex-1 p-2 overflow-y-auto font-mono text-[11px] leading-relaxed flex flex-col gap-1 bg-[#0a0a08]">
              {activeDiff ? (
                <>
                  <div className="text-[10px] text-[#8a8780] pb-1 border-b border-white/5 truncate font-sans">
                    Diff preview for {activeDiff.path.split(/[/\\]/).pop()}
                  </div>
                  <div className="text-red-400/80 bg-red-950/20 p-1.5 rounded border border-red-900/30 overflow-x-auto whitespace-pre">
                    --- Original ({activeDiff.original.split("\n").length} lines)
                  </div>
                  <div className="text-emerald-400/90 bg-emerald-950/20 p-1.5 rounded border border-emerald-900/30 overflow-x-auto whitespace-pre">
                    +++ Modified ({activeDiff.modified.split("\n").length} lines)
                    {"\n\n" + activeDiff.modified.slice(0, 500) + (activeDiff.modified.length > 500 ? "\n..." : "")}
                  </div>
                </>
              ) : (
                <div className="h-full flex items-center justify-center text-[#8a8780] text-center p-4">
                  Select a changed file to view its unified diff
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
