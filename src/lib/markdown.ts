/**
 * Markdown → HTML for the preview, modelled on VS Code's markdown engine
 * (extensions/markdown-language-features/src/markdownEngine.ts):
 *
 *  - markdown-it with linkify and typographer;
 *  - every block gets `data-line` (its source line, 0-based) and the
 *    `code-line` class, which is what scroll sync aligns on;
 *  - relative image paths are rewritten against the document's folder through
 *    `toUrl` (the Tauri asset protocol in the app), the original kept in
 *    `data-src`.
 *
 * Raw HTML is off (`html: false`), and the caller still sanitises the output
 * with DOMPurify before it reaches the DOM. No DOM here, so it runs in Node.
 */
import MarkdownIt from "markdown-it";
import { dirOf, resolvePath } from "./preview";

export interface RenderOptions {
  /** Absolute path of the document, for resolving relative images. */
  docPath: string;
  /** Turns an absolute file path into a URL the webview can load. */
  toUrl?: (absPath: string) => string;
}

const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false });

// Stamp source lines on block-level opening tokens (VS Code's "code-line").
md.core.ruler.push("fahh_source_lines", (state) => {
  for (const token of state.tokens) {
    if (token.map && token.nesting >= 0 && token.type !== "inline") {
      token.attrSet("data-line", String(token.map[0]));
      token.attrJoin("class", "code-line");
    }
  }
});

// Fences render their attributes onto <code>; put the line stamp on <pre>,
// the block element scroll sync measures.
const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const line = token.attrGet("data-line");
  token.attrs = (token.attrs ?? []).filter(([k, v]) => k !== "data-line" && !(k === "class" && v === "code-line"));
  const html = defaultFence(tokens, idx, options, env, self);
  return line === null ? html : html.replace(/^<pre>/, `<pre data-line="${line}" class="code-line">`);
};

// Per-render options reach the image rule through the env object.
const defaultImage = md.renderer.rules.image!;
md.renderer.rules.image = (tokens, idx, options, env: RenderOptions, self) => {
  const token = tokens[idx];
  const src = token.attrGet("src") ?? "";
  if (env?.docPath && src && !/^([a-z]+:|#)/i.test(src)) {
    const abs = resolvePath(dirOf(env.docPath), decodeURI(src));
    token.attrSet("data-src", src);
    token.attrSet("src", env.toUrl ? env.toUrl(abs) : abs);
  }
  return defaultImage(tokens, idx, options, env, self);
};

export function renderMarkdown(source: string, options: RenderOptions): string {
  return md.render(source, options);
}

/**
 * URLs the sanitised preview may keep: DOMPurify's default rule plus Tauri's
 * asset: scheme (how local images load on Linux and macOS). javascript:,
 * vbscript: and other schemes are still removed.
 */
export const SAFE_URL = /^(?:(?:https?|mailto|tel|callto|sms|cid|xmpp|asset):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;
