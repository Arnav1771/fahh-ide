import { describe, expect, it } from "vitest";
import { dirOf, formatBytes, isPreviewOnly, nextZoom, parseCsv, previewKindFor, resolvePath, syncTarget } from "./preview";

describe("which preview a file gets", () => {
  it("maps extensions, case-insensitively", () => {
    expect(previewKindFor("/a/README.md")).toBe("markdown");
    expect(previewKindFor("C:\\site\\Index.HTML")).toBe("html");
    expect(previewKindFor("/a/logo.PNG")).toBe("image");
    expect(previewKindFor("/a/icon.svg")).toBe("svg");
    expect(previewKindFor("/a/data.csv")).toBe("csv");
    expect(previewKindFor("/a/main.rs")).toBeNull();
    expect(previewKindFor("/a/.md")).toBeNull();
  });

  it("only binary images are preview-only", () => {
    expect(isPreviewOnly("/a/photo.jpg")).toBe(true);
    expect(isPreviewOnly("/a/icon.svg")).toBe(false);
    expect(isPreviewOnly("/a/README.md")).toBe(false);
  });
});

describe("paths", () => {
  it("resolves relative image paths against the document folder", () => {
    expect(dirOf("/home/me/docs/README.md")).toBe("/home/me/docs");
    expect(resolvePath("/home/me/docs", "img/logo.png")).toBe("/home/me/docs/img/logo.png");
    expect(resolvePath("/home/me/docs", "./a.png")).toBe("/home/me/docs/a.png");
    expect(resolvePath("/home/me/docs", "../shared/a.png")).toBe("/home/me/shared/a.png");
    expect(resolvePath("C:\\site\\docs", "img\\a.png")).toBe("C:\\site\\docs\\img\\a.png");
  });

  it("leaves URLs and absolute paths alone", () => {
    expect(resolvePath("/d", "https://x.dev/a.png")).toBe("https://x.dev/a.png");
    expect(resolvePath("/d", "data:image/png;base64,AA")).toBe("data:image/png;base64,AA");
    expect(resolvePath("/d", "/etc/a.png")).toBe("/etc/a.png");
  });
});

describe("CSV", () => {
  it("handles quotes, escaped quotes, embedded commas/newlines and CRLF", () => {
    const { rows } = parseCsv('name,quote\r\n"Ada, L.","said ""hi""\nthen left"\r\nBob,ok\r\n');
    expect(rows).toEqual([["name", "quote"], ["Ada, L.", 'said "hi"\nthen left'], ["Bob", "ok"]]);
  });

  it("reads a last row without a newline, TSV, and stops at maxRows", () => {
    expect(parseCsv("a\tb\n1\t2", "\t").rows).toEqual([["a", "b"], ["1", "2"]]);
    const big = parseCsv("x\n".repeat(50), ",", 10);
    expect(big.rows).toHaveLength(10);
    expect(big.truncated).toBe(true);
  });
});

describe("scroll sync", () => {
  const blocks = [0, 4, 10, 11];
  it("finds the block the top line is in and how far into it", () => {
    expect(syncTarget(blocks, 0)).toEqual({ index: 0, fraction: 0 });
    expect(syncTarget(blocks, 2)).toEqual({ index: 0, fraction: 0.5 });
    expect(syncTarget(blocks, 7)).toEqual({ index: 1, fraction: 0.5 });
    expect(syncTarget(blocks, 50)).toEqual({ index: 3, fraction: 0 });
    expect(syncTarget([], 3)).toBeNull();
  });
});

describe("image zoom and sizes", () => {
  it("steps through VS Code's zoom levels within 0.1–20×", () => {
    expect(nextZoom(1, 1)).toBe(1.5);
    expect(nextZoom(1, -1)).toBe(0.9);
    expect(nextZoom(0.73, 1)).toBe(0.8);
    expect(nextZoom(20, 1)).toBe(20);
    expect(nextZoom(0.1, -1)).toBe(0.1);
  });

  it("formats file sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
