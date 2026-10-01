import { describe, expect, it } from "vitest";
import { renderMarkdown, SAFE_URL } from "./markdown";

describe("which URLs the sanitised preview keeps", () => {
  it("keeps web links, relative paths and local asset images", () => {
    for (const ok of ["https://example.com", "http://asset.localhost/%2Fa.png", "asset://localhost/%2Fhome%2Fa.png", "img/a.png", "./a.md", "#top", "mailto:me@x.dev"]) {
      expect(SAFE_URL.test(ok), ok).toBe(true);
    }
  });
  it("drops script URLs", () => {
    for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", "vbscript:msgbox(1)"]) {
      expect(SAFE_URL.test(bad), bad).toBe(false);
    }
  });
});

const opts = { docPath: "/home/me/notes/README.md", toUrl: (p: string) => `asset://localhost/${encodeURIComponent(p)}` };

describe("markdown preview rendering", () => {
  it("stamps each block with its source line for scroll sync", () => {
    const html = renderMarkdown("# Title\n\nFirst para\n\n- a\n- b\n", opts);
    expect(html).toMatch(/<h1 data-line="0" class="code-line">Title<\/h1>/);
    expect(html).toMatch(/<p data-line="2" class="code-line">First para<\/p>/);
    expect(html).toMatch(/<ul data-line="4" class="code-line">/);
  });

  it("rewrites relative images against the document folder, keeps the original", () => {
    const html = renderMarkdown("![logo](img/logo.png)\n", opts);
    expect(html).toContain(`src="asset://localhost/${encodeURIComponent("/home/me/notes/img/logo.png")}"`);
    expect(html).toContain('data-src="img/logo.png"');
  });

  it("leaves web images, data URIs and anchors alone", () => {
    const html = renderMarkdown("![a](https://x.dev/a.png) ![b](data:image/png;base64,AA)\n", opts);
    expect(html).toContain('src="https://x.dev/a.png"');
    expect(html).toContain('src="data:image/png;base64,AA"');
  });

  it("never passes raw HTML through (scripts are text, not tags)", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n', opts);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img src=x/i);
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders the everyday syntax", () => {
    const html = renderMarkdown("**bold** `code` [link](https://example.com)\n\n```ts\nconst a = 1\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n", opts);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toMatch(/<pre data-line="2" class="code-line"><code class="language-ts">/);
    expect(html).toMatch(/<table data-line="6" class="code-line">/);
  });
});
