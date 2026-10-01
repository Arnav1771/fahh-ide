import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Code, ShieldAlert, X } from "lucide-react";
import { renderMarkdown, SAFE_URL } from "../../lib/markdown";
import { dirOf, extOf, formatBytes, nextZoom, parseCsv, resolvePath, syncTarget, type PreviewKind } from "../../lib/preview";
import { allowPreview } from "../../lib/tauri";
import { revealLine } from "../../lib/monacoBridge";
import { usePreviewStore } from "../../store/previewStore";
import { useWorkspace } from "../../hooks/useWorkspace";

/** Turn a local path into a URL the webview may load (asset protocol). */
function assetUrl(path: string): string {
  try {
    return convertFileSrc(path);
  } catch {
    return path; // browser preview: no Tauri
  }
}

/** Re-render at most every `ms` while typing (VS Code throttles at 300 ms). */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

interface Props {
  path: string;
  content: string;
  kind: PreviewKind;
  /** Shown when the preview is beside the editor. */
  onClose?: () => void;
  /** Back to the text editor (preview shown in place). */
  onShowSource?: () => void;
}

export function PreviewPane({ path, content, kind, onClose, onShowSource }: Props) {
  const name = path.split(/[\\/]/).pop() ?? path;

  // The asset protocol starts with an empty scope: allow this file's folder.
  useEffect(() => {
    allowPreview(path).catch(() => {});
  }, [path]);

  return (
    <div className="fahh-preview flex h-full min-w-0 flex-1 flex-col bg-fahh-bg" data-kind={kind}>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-fahh-surface bg-fahh-sidebar px-3 text-xs text-fahh-muted">
        <span className="fahh-label">Preview</span>
        <span className="truncate text-fahh-text">{name}</span>
        <div className="flex-1" />
        {onShowSource && (
          <button type="button" onClick={onShowSource} title="Show source (Ctrl+Shift+V)" aria-label="Show source" className="flex items-center gap-1 hover:text-fahh-text">
            <Code size={13} aria-hidden="true" /> Source
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} title="Close preview" aria-label="Close preview" className="hover:text-fahh-text">
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {kind === "markdown" && <MarkdownPreview path={path} content={content} />}
        {kind === "html" && <HtmlPreview path={path} content={content} />}
        {kind === "image" && <ImagePreview src={assetUrl(path)} path={path} />}
        {kind === "svg" && <ImagePreview src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`} path={path} bytes={new Blob([content]).size} />}
        {kind === "csv" && <CsvPreview content={content} delimiter={extOf(path) === "tsv" ? "\t" : ","} />}
      </div>
    </div>
  );
}

// ─── Markdown ─────────────────────────────────────────────────────────────────

const MD_CSS = `
:host { all: initial; }
.md { font: 14px/1.65 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fahh-text); padding: 20px 28px 40vh; max-width: 860px; position: relative; word-wrap: break-word; }
.md h1, .md h2 { border-bottom: 1px solid var(--fahh-surface); padding-bottom: .3em; }
.md h1 { font-size: 1.9em; margin: .2em 0 .6em; } .md h2 { font-size: 1.45em; margin: 1.4em 0 .6em; } .md h3 { font-size: 1.2em; margin: 1.2em 0 .5em; }
.md p, .md ul, .md ol, .md table, .md pre, .md blockquote { margin: 0 0 1em; }
.md a { color: var(--fahh-accent); text-decoration: none; } .md a:hover { text-decoration: underline; }
.md code { font: 12.5px "JetBrains Mono", "Fira Code", monospace; background: var(--fahh-surface); padding: .15em .4em; border-radius: 4px; }
.md pre { background: var(--fahh-sidebar); border: 1px solid var(--fahh-surface); border-radius: 6px; padding: 12px 14px; overflow-x: auto; }
.md pre code { background: none; padding: 0; }
.md blockquote { border-left: 3px solid var(--fahh-accent); margin-left: 0; padding: .2em 1em; color: var(--fahh-muted); }
.md table { border-collapse: collapse; display: block; overflow-x: auto; }
.md th, .md td { border: 1px solid var(--fahh-surface); padding: 6px 12px; } .md th { background: var(--fahh-sidebar); text-align: left; }
.md img { max-width: 100%; }
.md hr { border: 0; border-top: 1px solid var(--fahh-surface); margin: 1.6em 0; }
.md .code-line.fahh-synced { box-shadow: -10px 0 0 -7px var(--fahh-accent); }
`;

function MarkdownPreview({ path, content }: { path: string; content: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const source = useDebounced(content, 200);
  const topLine = usePreviewStore((s) => s.topLine);
  const { openFileInEditor } = useWorkspace();

  const html = useMemo(() => {
    const raw = renderMarkdown(source, { docPath: path, toUrl: assetUrl });
    // markdown-it already refuses raw HTML; DOMPurify is the belt to that brace.
    return DOMPurify.sanitize(raw, {
      FORBID_TAGS: ["style", "form", "iframe", "object", "embed", "script"],
      FORBID_ATTR: ["style"],
      // DOMPurify's default URL rule plus Tauri's asset: scheme (Linux/macOS),
      // which local images use; javascript: and other schemes stay blocked.
      ALLOWED_URI_REGEXP: SAFE_URL,
    });
  }, [source, path]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!shadowRef.current) shadowRef.current = host.attachShadow({ mode: "open" });
    shadowRef.current.innerHTML = `<style>${MD_CSS}</style><article class="md">${html}</article>`;
  }, [html]);

  // Links open outside (web) or in the editor (other files); never navigate the app.
  useEffect(() => {
    const root = shadowRef.current;
    if (!root) return;
    const onClick = (e: Event) => {
      const a = (e.target as HTMLElement).closest?.("a");
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        root.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: "smooth" });
      } else if (/^(https?:|mailto:)/i.test(href)) {
        import("@tauri-apps/plugin-shell").then(({ open }) => open(href)).catch(() => window.open(href, "_blank", "noopener"));
      } else if (href) {
        openFileInEditor(resolvePath(dirOf(path), decodeURI(href.split("#")[0]))).catch(() => {});
      }
    };
    // Double-click a block to jump to its source line (VS Code's doubleClickToSwitchToEditor).
    const onDbl = (e: Event) => {
      const block = (e.target as HTMLElement).closest?.("[data-line]");
      if (block) revealLine(Number(block.getAttribute("data-line")) + 1);
    };
    root.addEventListener("click", onClick);
    root.addEventListener("dblclick", onDbl);
    return () => {
      root.removeEventListener("click", onClick);
      root.removeEventListener("dblclick", onDbl);
    };
  }, [html, path, openFileInEditor]);

  // Scroll sync: keep the block at the editor's top line at the top of the preview.
  useEffect(() => {
    const host = hostRef.current;
    const root = shadowRef.current;
    if (!host || !root) return;
    // Document order is source order; offsets are all relative to the article.
    const blocks = [...root.querySelectorAll<HTMLElement>("[data-line]")];
    const lines = blocks.map((el) => Number(el.getAttribute("data-line")));
    const t = syncTarget(lines, topLine - 1);
    if (!t) return;
    const el = blocks[t.index];
    const next = blocks[t.index + 1];
    const y = el.offsetTop + (next ? (next.offsetTop - el.offsetTop) * t.fraction : 0);
    host.scrollTo({ top: Math.max(0, y - 12) });
    root.querySelectorAll(".fahh-synced").forEach((n) => n.classList.remove("fahh-synced"));
    el.classList.add("fahh-synced");
  }, [topLine, html]);

  return <div ref={hostRef} className="fahh-md-host absolute inset-0 overflow-auto" />;
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

/** Put a <base> in the page so its relative CSS, scripts and images load from its folder. */
function withBase(html: string, baseHref: string): string {
  const tag = `<base href="${baseHref}">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${tag}`);
  return `${tag}${html}`;
}

function HtmlPreview({ path, content }: { path: string; content: string }) {
  const allowed = usePreviewStore((s) => !!s.scripts[path]);
  const allowScripts = usePreviewStore((s) => s.allowScripts);
  const source = useDebounced(content, 300);
  const srcDoc = useMemo(() => withBase(source, assetUrl(dirOf(path)) + "/"), [source, path]);
  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-fahh-surface px-3 py-1 text-[11px] text-fahh-muted">
        <ShieldAlert size={12} aria-hidden="true" />
        {allowed ? "Scripts are running in this preview." : "Scripts are off in this preview."}
        <button type="button" className="text-fahh-accent hover:underline" onClick={() => allowScripts(path, !allowed)}>
          {allowed ? "Turn scripts off" : "Allow scripts for this file"}
        </button>
      </div>
      <iframe
        key={allowed ? "scripts" : "static"}
        title={`Preview of ${path}`}
        srcDoc={srcDoc}
        // No allow-same-origin: the page can never reach the editor.
        sandbox={allowed ? "allow-scripts allow-modals" : ""}
        className="fahh-html-frame w-full flex-1 border-none bg-white"
      />
    </div>
  );
}

// ─── Images (VS Code media-preview) ───────────────────────────────────────────

function ImagePreview({ src, path, bytes }: { src: string; path: string; bytes?: number }) {
  const [zoom, setZoom] = useState<number | null>(null); // null = fit
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [fileBytes, setFileBytes] = useState<number | null>(bytes ?? null);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setZoom(null);
    setFailed(false);
    if (bytes !== undefined) return setFileBytes(bytes);
    fetch(src).then((r) => (r.ok ? r.blob() : null)).then((b) => b && setFileBytes(b.size)).catch(() => {});
  }, [src, bytes]);

  const current = () => {
    const img = imgRef.current;
    return zoom ?? (img && size ? img.clientWidth / size.w : 1);
  };
  const step = (dir: 1 | -1) => setZoom(nextZoom(current(), dir));

  return (
    <div className="absolute inset-0 flex flex-col">
      <div
        className="fahh-image-stage relative flex min-h-0 flex-1 items-center justify-center overflow-auto"
        style={{ backgroundImage: "repeating-conic-gradient(color-mix(in srgb, var(--fahh-surface) 70%, transparent) 0 25%, transparent 0 50%)", backgroundSize: "16px 16px" }}
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          step(e.deltaY < 0 ? 1 : -1);
        }}
      >
        {failed ? (
          <p className="text-xs text-fahh-error">Could not load {path}.</p>
        ) : (
          <img
            ref={imgRef}
            src={src}
            alt={path.split(/[\\/]/).pop()}
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setFailed(true)}
            onClick={(e) => step(e.ctrlKey || e.altKey || e.metaKey ? -1 : 1)}
            className="fahh-image select-none"
            style={
              zoom === null
                ? { maxWidth: "100%", maxHeight: "100%", cursor: "zoom-in" }
                : { width: size ? size.w * zoom : undefined, maxWidth: "none", cursor: "zoom-in", imageRendering: zoom >= 3 ? "pixelated" : "auto" }
            }
            draggable={false}
          />
        )}
      </div>
      <div className="fahh-image-info flex shrink-0 items-center gap-3 border-t border-fahh-surface bg-fahh-sidebar px-3 py-1 font-mono text-[11px] text-fahh-muted">
        {size && <span>{size.w} × {size.h}</span>}
        {fileBytes !== null && <span>{formatBytes(fileBytes)}</span>}
        <span>{zoom === null ? "Fit" : `${Math.round(zoom * 100)}%`}</span>
        <div className="flex-1" />
        <button type="button" className="hover:text-fahh-text" onClick={() => setZoom(null)}>Fit</button>
        <button type="button" className="hover:text-fahh-text" onClick={() => setZoom(1)}>100%</button>
        <span>click to zoom in · Ctrl+click out · Ctrl+wheel</span>
      </div>
    </div>
  );
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

function CsvPreview({ content, delimiter }: { content: string; delimiter: string }) {
  const source = useDebounced(content, 300);
  const { rows, truncated } = useMemo(() => parseCsv(source, delimiter), [source, delimiter]);
  if (rows.length === 0) return <p className="p-4 text-xs text-fahh-muted">Empty file.</p>;
  const [header, ...body] = rows;
  return (
    <div className="absolute inset-0 overflow-auto">
      <table className="fahh-csv min-w-full border-collapse font-mono text-xs">
        <thead className="sticky top-0 bg-fahh-sidebar">
          <tr>
            <th className="border border-fahh-surface px-2 py-1 text-right text-fahh-muted">#</th>
            {header.map((h, i) => (
              <th key={i} className="border border-fahh-surface px-2 py-1 text-left text-fahh-text">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="odd:bg-fahh-sidebar">
              <td className="border border-fahh-surface px-2 py-0.5 text-right text-fahh-muted">{i + 1}</td>
              {header.map((_, j) => (
                <td key={j} className="whitespace-pre border border-fahh-surface px-2 py-0.5 text-fahh-text">{r[j] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-fahh-muted">
        {body.length} row{body.length === 1 ? "" : "s"}{truncated ? " shown — the file has more; open it as text to see everything." : "."}
      </p>
    </div>
  );
}
