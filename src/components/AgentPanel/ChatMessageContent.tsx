import React, { useState } from "react";
import DOMPurify from "dompurify";
import { renderMarkdown, SAFE_URL } from "../../lib/markdown";
import { openExternal } from "../../lib/browser";
import { Check, Copy, FileInput } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { copyText } from "../../lib/clipboard";

interface CodeBlockProps {
  code: string;
  language: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const activeTab = useEditorStore((s) => s.activeTab);

  const handleCopy = async () => {
    if (!(await copyText(code))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInsert = () => {
    if (!activeTab) return;
    const { fileContents, setContent } = useEditorStore.getState();
    const current = fileContents[activeTab] ?? "";
    setContent(activeTab, current ? `${current}\n\n${code}` : code);
  };

  const cleanLang = language.trim().toLowerCase() || "code";

  return (
    <div className="my-2 rounded-lg border border-fahh-surface/80 bg-fahh-bg overflow-hidden shadow-md">
      {/* Code Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-fahh-sidebar border-b border-fahh-surface/70 text-xs">
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
                <Check size={11} className="text-fahh-success" />
                <span className="text-fahh-success font-medium">Copied!</span>
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
      <pre className="p-3 text-[11.5px] font-mono leading-relaxed overflow-x-auto text-fahh-text select-text cursor-text selection:bg-fahh-accent/30 no-scrollbar">
        <code>{code}</code>
      </pre>
    </div>
  );
}

interface ChatMessageContentProps {
  text: string;
  /** Agent mode's reading size (14px) instead of the dock's 12px. */
  large?: boolean;
}

export function ChatMessageContent({ text, large }: ChatMessageContentProps) {
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
    <div className={`select-text cursor-text space-y-1.5 selection:bg-fahh-accent/30 ${large ? "text-sm leading-6" : "text-xs leading-relaxed"}`}>
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

        return <MarkdownText key={index} source={part.content} />;
      })}
    </div>
  );
}

// No images (a reply could load a tracking pixel), no styles or forms; links open in the browser.
const CHAT_PURIFY = {
  FORBID_TAGS: ["img", "style", "form", "iframe", "object", "embed", "script", "link", "meta", "base", "input"],
  FORBID_ATTR: ["style"],
  ALLOWED_URI_REGEXP: SAFE_URL,
};

/** Markdown between code fences: tables, lists, headings, quotes, links, bold, inline code. */
function MarkdownText({ source }: { source: string }) {
  const html = React.useMemo(() => DOMPurify.sanitize(renderMarkdown(source, { docPath: "" }), CHAT_PURIFY), [source]);
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/i.test(href)) void openExternal(href);
  };
  return <div className="fahh-chat-md break-words text-fahh-text/95" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
