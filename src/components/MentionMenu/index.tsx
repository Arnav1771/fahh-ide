import { useEffect, useMemo, useState } from "react";
import { FileCode, AlertTriangle, Terminal, GitBranch, FolderGit2 } from "lucide-react";
import { useFileStore } from "../../store/fileStore";
import { flattenTree } from "../../lib/quickOpen";
import { type AttachedContext, buildContextSnippet } from "../../store/composerStore";

interface MentionMenuProps {
  query: string;
  onSelect: (context: AttachedContext) => void;
  onClose: () => void;
  position?: { top: number; left: number };
}

interface MentionOption {
  id: string;
  type: "file" | "problems" | "terminal" | "git" | "codebase";
  label: string;
  detail: string;
  icon: typeof FileCode;
}

export function MentionMenu({ query, onSelect, onClose }: MentionMenuProps) {
  const tree = useFileStore((s) => s.tree);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const fileOptions = useMemo<MentionOption[]>(() => {
    return flattenTree(tree).slice(0, 30).map((f) => ({
      id: f.path,
      type: "file" as const,
      label: `@file ${f.name}`,
      detail: f.folder,
      icon: FileCode,
    }));
  }, [tree]);

  const staticOptions: MentionOption[] = [
    {
      id: "problems",
      type: "problems",
      label: "@problems",
      detail: "Active LSP diagnostics, compiler & linter errors",
      icon: AlertTriangle,
    },
    {
      id: "terminal",
      type: "terminal",
      label: "@terminal",
      detail: "Recent stdout, stderr, and command outputs",
      icon: Terminal,
    },
    {
      id: "codebase",
      type: "codebase",
      label: "@codebase",
      detail: "Workspace directory map and architectural overview",
      icon: FolderGit2,
    },
    {
      id: "git",
      type: "git",
      label: "@git",
      detail: "Active branch, staged and unstaged diffs",
      icon: GitBranch,
    },
  ];

  const allOptions = useMemo(() => [...staticOptions, ...fileOptions], [fileOptions]);

  const filteredOptions = useMemo(() => {
    const q = query.toLowerCase().replace(/^@/, "").trim();
    if (!q) return allOptions.slice(0, 8);
    return allOptions
      .filter((opt) => opt.label.toLowerCase().includes(q) || opt.detail.toLowerCase().includes(q))
      .slice(0, 8);
  }, [allOptions, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredOptions]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (filteredOptions.length > 0 ? (i + 1) % filteredOptions.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (filteredOptions.length > 0 ? (i - 1 + filteredOptions.length) % filteredOptions.length : 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filteredOptions[selectedIndex]) {
          const item = filteredOptions[selectedIndex];
          onSelect(buildContextSnippet(item.type, item.id));
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filteredOptions, selectedIndex, onSelect, onClose]);

  if (filteredOptions.length === 0) return null;

  return (
    <div className="absolute bottom-full mb-1 left-0 z-50 w-72 max-h-60 overflow-y-auto rounded-lg bg-[#141311] border border-[#4a9eff]/40 shadow-[0_15px_30px_rgba(0,0,0,0.8)] backdrop-blur-xl p-1 text-xs font-sans animate-in fade-in zoom-in-95 duration-100">
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider font-semibold text-[#8a8780] border-b border-white/5">
        Context Mentions (@)
      </div>
      <div className="flex flex-col gap-0.5 mt-1">
        {filteredOptions.map((opt, idx) => {
          const Icon = opt.icon;
          const isSelected = idx === selectedIndex;
          return (
            <button
              type="button"
              key={opt.id}
              onClick={() => onSelect(buildContextSnippet(opt.type, opt.id))}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                isSelected ? "bg-[#4a9eff]/20 text-[#e8e6e3]" : "text-[#8a8780] hover:text-[#e8e6e3]"
              }`}
            >
              <Icon size={13} className={isSelected ? "text-[#4a9eff]" : "text-[#8a8780]"} />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-xs truncate">{opt.label}</div>
                <div className="text-[10px] text-[#8a8780] truncate">{opt.detail}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
