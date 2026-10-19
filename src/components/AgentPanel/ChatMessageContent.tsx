import React, { useState } from "react";
import { Check, Copy, FileInput } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";

interface CodeBlockProps {
  code: string;
  language: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const activeTab = useEditorStore((s) => s.activeTab);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  };

  const handleInsert = () => {
    if (!activeTab) return;
    const { fileContents, setContent } = useEditorStore.getState();
    const current = fileContents[activeTab] ?? "";
    setContent(activeTab, current ? `${current}\n\n${code}` : code);
  };

  const cleanLang = language.trim().toLowerCase() || "code";

  return (
    <div className="my-2 rounded-lg border border-fahh-surface/80 bg-[#0d0e12] overflow-hidden shadow-md">
      {/* Code Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#15171e] border-b border-fahh-surface/70 text-xs">
        <span className="font-mono text-[10.5px] uppercase font-semibold text-fahh-accent tracking-wider">
          {cleanLang}
        </span>
        <div className="flex items-center gap-1.5">
          {activeTab && (
            <button
              type="button"
              onClick={handleInsert}
              title="Append code to active document"
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] bg-fahh-surface/60 hover:bg-fahh-surface text-fahh-muted hover:text-fahh-text transition-colors"
            >
              <FileInput size={11} />
              <span>Insert</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            title="Copy code to clipboard"
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] bg-fahh-surface/60 hover:bg-fahh-surface text-fahh-muted hover:text-fahh-text transition-colors"
          >
            {copied ? (
              <>
                <Check size={11} className="text-emerald-400" />
                <span className="text-emerald-400 font-medium">Copied!</span>
              </>
            ) : (
              <>
                <Copy size={11} />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code Body */}
      <pre className="p-3 text-[11.5px] font-mono leading-relaxed overflow-x-auto text-[#e6edf3] select-text cursor-text selection:bg-fahh-accent/30 no-scrollbar">
        <code>{code}</code>
      </pre>
    </div>
  );
}

interface ChatMessageContentProps {
  text: string;
}

export function ChatMessageContent({ text }: ChatMessageContentProps) {
  // Parse code blocks vs regular markdown
  const parts = React.useMemo(() => {
    const segments: Array<{ type: "text" | "code"; content: string; language?: string }> = [];
    const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({
          type: "text",
          content: text.slice(lastIndex, match.index),
        });
      }
      segments.push({
        type: "code",
        language: match[1] || "plaintext",
        content: match[2].replace(/\n$/, ""),
      });
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      segments.push({
        type: "text",
        content: text.slice(lastIndex),
      });
    }

    return segments;
  }, [text]);

  return (
    <div className="select-text cursor-text leading-relaxed text-xs space-y-1.5 selection:bg-fahh-accent/30">
      {parts.map((part, index) => {
        if (part.type === "code") {
          return (
            <CodeBlock
              key={index}
              code={part.content}
              language={part.language ?? "plaintext"}
            />
          );
        }

        // Inline formatting for text (bold, inline code, line breaks)
        return (
          <div key={index} className="whitespace-pre-wrap break-words text-fahh-text/95">
            {renderInlineMarkdown(part.content)}
          </div>
        );
      })}
    </div>
  );
}

/** Render inline `code` and **bold** elements */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Tokenize by `inline code` and **bold**
  const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[1];
    if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code
          key={key++}
          className="px-1.5 py-0.5 rounded bg-fahh-surface/80 text-fahh-accent font-mono text-[11px] select-text"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        <strong key={key++} className="font-semibold text-fahh-text">
          {token.slice(2, -2)}
        </strong>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
