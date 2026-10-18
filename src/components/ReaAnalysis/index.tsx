import { useState, useMemo } from "react";
import {
  Cpu,
  Search,
  Copy,
  Check,
  Code2,
} from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { revealLine } from "../../lib/monacoBridge";

interface StringEvidence {
  offset: string;
  value: string;
  type: "url" | "symbol" | "path" | "text";
}

interface SymbolNode {
  name: string;
  kind: "function" | "class" | "interface" | "variable" | "import" | "export";
  line: number;
}

const SAMPLE_MODULE = `// REA Architecture & Binary Analysis Demo
import { useState, useEffect } from "react";

export interface ServerEndpoint {
  url: string;
  protocol: "https" | "wss";
  active: boolean;
}

export class EngineDriver {
  private host = "https://fahhide.duckdns.org/api/v1/telemetry";
  private socket = "wss://fahhide.duckdns.org/stream";

  async connect(retries = 3) {
    console.log("Connecting to", this.host);
  }
}

export function initializeBuffer(size: number) {
  const magic = "FAHH_BINARY_HDR_0x42";
  return new Uint8Array(size);
}
`;

export function ReaAnalysisPanel() {
  const { activeTab, fileContents } = useEditorStore();
  const [showDemo, setShowDemo] = useState(false);

  const [activeTabMode, setActiveTabMode] = useState<"ast" | "strings" | "hex">("ast");
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState(false);

  const rawContent = (activeTab && fileContents[activeTab]) || "";
  const content = rawContent || (showDemo ? SAMPLE_MODULE : "");
  const fileName = activeTab
    ? activeTab.split(/[/\\]/).pop() || "untitled"
    : showDemo
    ? "demo_module.ts"
    : "No file open";

  // 1. Static Module / AST & Symbol Analysis
  const symbols = useMemo<SymbolNode[]>(() => {
    if (!content) return [];
    const lines = content.split("\n");
    const found: SymbolNode[] = [];

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      // Function match
      const fnMatch = trimmed.match(/(?:async\s+)?(?:function\s+([a-zA-Z0-9_$]+)|(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|def\s+([a-zA-Z0-9_]+)\s*\(|fn\s+([a-zA-Z0-9_]+)\s*\()/);
      if (fnMatch) {
        const name = fnMatch[1] || fnMatch[2] || fnMatch[3] || fnMatch[4];
        if (name) found.push({ name, kind: "function", line: idx + 1 });
      }
      // Class match
      const classMatch = trimmed.match(/(?:export\s+)?(?:default\s+)?class\s+([a-zA-Z0-9_$]+)|class\s+([a-zA-Z0-9_]+)\s*(?:\(|$|:)/);
      if (classMatch) {
        const name = classMatch[1] || classMatch[2];
        if (name) found.push({ name, kind: "class", line: idx + 1 });
      }
      // Interface / Type match
      const typeMatch = trimmed.match(/(?:export\s+)?(?:interface|type)\s+([a-zA-Z0-9_$]+)/);
      if (typeMatch && typeMatch[1]) {
        found.push({ name: typeMatch[1], kind: "interface", line: idx + 1 });
      }
      // Import match
      if (trimmed.startsWith("import ") || trimmed.startsWith("from ") || trimmed.startsWith("use ")) {
        found.push({ name: trimmed.slice(0, 60), kind: "import", line: idx + 1 });
      }
      // Export match
      if (trimmed.startsWith("export ") && !trimmed.startsWith("export default")) {
        found.push({ name: trimmed.slice(0, 60), kind: "export", line: idx + 1 });
      }
    });

    return found;
  }, [content]);

  // 2. String Extraction (REA "strings" provider emulation)
  const extractedStrings = useMemo<StringEvidence[]>(() => {
    if (!content) return [];
    const results: StringEvidence[] = [];
    const regex = /["'`]([^"'`]{4,120})["'`]/g;
    let m;
    let count = 0;
    while ((m = regex.exec(content)) !== null && count < 150) {
      const val = m[1].trim();
      if (!val) continue;
      count++;
      let type: StringEvidence["type"] = "text";
      if (val.startsWith("http://") || val.startsWith("https://")) type = "url";
      else if (val.includes("/") || val.includes("\\")) type = "path";
      else if (/^[A-Z0-9_]{3,}$/.test(val) || /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(val)) type = "symbol";

      results.push({
        offset: `0x${m.index.toString(16).padStart(6, "0")}`,
        value: val,
        type,
      });
    }
    return results;
  }, [content]);

  // 3. Hex Dump (16 bytes per row)
  const hexDump = useMemo(() => {
    if (!content) return [];
    // Convert first 4KB of content to hex representation
    const sample = content.slice(0, 2048);
    const rows = [];
    for (let i = 0; i < sample.length; i += 16) {
      const chunk = sample.slice(i, i + 16);
      const hexBytes = [];
      let ascii = "";
      for (let j = 0; j < 16; j++) {
        if (j < chunk.length) {
          const code = chunk.charCodeAt(j);
          hexBytes.push(code.toString(16).padStart(2, "0").toUpperCase());
          ascii += code >= 32 && code <= 126 ? chunk[j] : ".";
        } else {
          hexBytes.push("  ");
          ascii += " ";
        }
      }
      rows.push({
        offset: `0x${i.toString(16).padStart(6, "0")}`,
        hex: hexBytes.slice(0, 8).join(" ") + "  " + hexBytes.slice(8).join(" "),
        ascii,
      });
    }
    return rows;
  }, [content]);

  const copyAnalysis = () => {
    const text = `REA Analysis Report: ${fileName}\nSymbols: ${symbols.length}\nStrings: ${extractedStrings.length}\n\nTop Symbols:\n${symbols.slice(0, 15).map(s => `[${s.kind}] ${s.name} (line ${s.line})`).join("\n")}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-[#141311] font-sans text-xs text-[#e8e6e3] select-none overflow-hidden">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#161513] border-b border-white/[0.08] shrink-0">
        <div className="flex items-center gap-2">
          <Cpu size={14} className="text-[#4a9eff]" />
          <span className="font-semibold text-xs tracking-tight">REA Code Analysis</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/[0.05] border border-white/[0.08] text-[#a8a49e] font-mono">
            {fileName}
          </span>
        </div>

        <button
          type="button"
          onClick={copyAnalysis}
          title="Copy analysis report"
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/[0.05] hover:bg-white/[0.1] text-[11px] text-[#a8a49e] hover:text-[#e8e6e3] transition-colors"
        >
          {copied ? <Check size={11} className="text-[#27c93f]" /> : <Copy size={11} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>

      {/* Mode Sub-nav */}
      <div className="flex items-center gap-1 px-3 py-1.5 bg-[#181816] border-b border-white/[0.06] shrink-0">
        <button
          type="button"
          onClick={() => setActiveTabMode("ast")}
          className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            activeTabMode === "ast" ? "bg-[#4a9eff]/20 text-[#4a9eff]" : "text-[#8a8780] hover:text-[#e8e6e3]"
          }`}
        >
          Symbols & AST ({symbols.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTabMode("strings")}
          className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            activeTabMode === "strings" ? "bg-[#4a9eff]/20 text-[#4a9eff]" : "text-[#8a8780] hover:text-[#e8e6e3]"
          }`}
        >
          Strings ({extractedStrings.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTabMode("hex")}
          className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            activeTabMode === "hex" ? "bg-[#4a9eff]/20 text-[#4a9eff]" : "text-[#8a8780] hover:text-[#e8e6e3]"
          }`}
        >
          Hex Dump
        </button>
      </div>

      {/* Filter bar */}
      <div className="px-3 py-1.5 bg-[#141311] border-b border-white/[0.06] shrink-0">
        <div className="relative">
          <Search size={11} className="absolute left-2.5 top-2 text-[#8a8780]" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${activeTabMode}...`}
            className="w-full pl-7 pr-3 py-1 rounded bg-[#1a1917] border border-white/[0.08] text-[11px] text-[#e8e6e3] outline-none focus:border-[#4a9eff] transition-colors"
          />
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {/* Mode 1: Symbols & AST */}
        {activeTabMode === "ast" && (
          <div className="flex flex-col gap-1">
            {symbols.length === 0 ? (
              <div className="text-center py-8 text-[#8a8780] space-y-3">
                <p>No symbols detected in active document.</p>
                {!showDemo && (
                  <button
                    type="button"
                    onClick={() => setShowDemo(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#4a9eff]/15 text-[#4a9eff] border border-[#4a9eff]/30 hover:bg-[#4a9eff]/25 text-xs transition-colors"
                  >
                    <Code2 size={12} />
                    <span>Load Demo Analysis</span>
                  </button>
                )}
              </div>
            ) : (
              symbols
                .filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()))
                .map((s, idx) => (
                  <div
                    key={idx}
                    onClick={() => s.line && revealLine(s.line)}
                    title={`Click to jump to line ${s.line}`}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.04] transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded font-mono uppercase ${
                          s.kind === "function"
                            ? "bg-[#27c93f]/20 text-[#27c93f]"
                            : s.kind === "class"
                            ? "bg-[#4a9eff]/20 text-[#4a9eff]"
                            : s.kind === "interface"
                            ? "bg-[#ff9f0a]/20 text-[#ff9f0a]"
                            : "bg-white/10 text-[#a8a49e]"
                        }`}
                      >
                        {s.kind}
                      </span>
                      <span className="font-mono text-xs text-[#e8e6e3] truncate">{s.name}</span>
                    </div>
                    <span className="text-[10px] text-[#8a8780] font-mono shrink-0 ml-2">
                      Ln {s.line}
                    </span>
                  </div>
                ))
            )}
          </div>
        )}

        {/* Mode 2: Strings */}
        {activeTabMode === "strings" && (
          <div className="flex flex-col gap-1">
            {extractedStrings.length === 0 ? (
              <div className="text-center py-8 text-[#8a8780]">
                No strings extracted.
              </div>
            ) : (
              extractedStrings
                .filter((s) => s.value.toLowerCase().includes(filter.toLowerCase()))
                .map((s, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.04] transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-mono text-[#4a9eff] shrink-0">{s.offset}</span>
                      <span className="font-mono text-xs text-[#e8e6e3] truncate">{s.value}</span>
                    </div>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/[0.05] text-[#8a8780] font-mono capitalize shrink-0 ml-2">
                      {s.type}
                    </span>
                  </div>
                ))
            )}
          </div>
        )}

        {/* Mode 3: Hex Dump */}
        {activeTabMode === "hex" && (
          <div className="font-mono text-[11px] leading-relaxed text-[#a8a49e] flex flex-col gap-0.5">
            {hexDump.map((row, idx) => (
              <div key={idx} className="flex items-center gap-3 hover:bg-white/[0.04] px-1 rounded">
                <span className="text-[#4a9eff]">{row.offset}</span>
                <span className="text-[#e8e6e3]">{row.hex}</span>
                <span className="text-[#8a8780] border-l border-white/10 pl-3">{row.ascii}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
