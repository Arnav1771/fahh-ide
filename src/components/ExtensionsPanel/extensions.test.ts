import { describe, it, expect } from "vitest";
import {
  formatDownloads,
  getVsixDownloadUrl,
  sortExtensions,
  filterExtensions,
  isPdfExtension,
  fromOpenVsx,
  openVsxSearchUrl,
  type MarketplaceExtension,
} from "./index";

// Test fixtures only (the panel itself ships no extension list).
const ext = (id: string, downloadCount: number, averageRating: number | undefined, verified = false): MarketplaceExtension => ({
  id, namespace: id.split(".")[0], name: id.split(".")[1], displayName: id.split(".")[1], description: id, version: "1.0.0", downloadCount, averageRating, verified,
});
const LIST = [ext("a.zeta", 10, 4.2, true), ext("b.alpha", 500, undefined), ext("c.python", 90, 4.9, true)];

describe("ExtensionsPanel Utilities", () => {
  it("formats download counts with M and k suffixes", () => {
    expect(formatDownloads(19400000)).toBe("19.4M");
    expect(formatDownloads(1000000)).toBe("1.0M");
    expect(formatDownloads(850000)).toBe("850k");
    expect(formatDownloads(1200)).toBe("1k");
    expect(formatDownloads(450)).toBe("450");
  });

  it("synthesizes valid Open VSX VSIX download URLs", () => {
    const url = getVsixDownloadUrl("ms-python", "python", "2024.18.0");
    expect(url).toBe(
      "https://open-vsx.org/api/ms-python/python/2024.18.0/file/ms-python.python-2024.18.0.vsix"
    );
  });

  it("sorts by downloads, rating (unrated last) and name", () => {
    expect(sortExtensions(LIST, "downloads").map((e) => e.id)).toEqual(["b.alpha", "c.python", "a.zeta"]);
    expect(sortExtensions(LIST, "rating").map((e) => e.id)).toEqual(["c.python", "a.zeta", "b.alpha"]);
    expect(sortExtensions(LIST, "name")[0].id).toBe("b.alpha");
  });

  it("filters by query and verified status", () => {
    expect(filterExtensions(LIST, "python", "All", false).map((e) => e.id)).toEqual(["c.python"]);
    expect(filterExtensions(LIST, "", "All", true).every((e) => e.verified)).toBe(true);
  });

  it("maps Open VSX entries without inventing a rating or version", () => {
    const e = fromOpenVsx({ namespace: "dracula-theme", name: "theme-dracula", downloadCount: 7, files: { icon: "i.png" } });
    expect(e).toMatchObject({ id: "dracula-theme.theme-dracula", displayName: "theme-dracula", version: "", downloadCount: 7, iconUrl: "i.png", verified: false });
    expect(e.averageRating).toBeUndefined();
  });

  it("asks the registry for a category's most downloaded, or a query", () => {
    const themes = new URL(openVsxSearchUrl("", "Themes"));
    expect(themes.searchParams.get("category")).toBe("Themes");
    expect(themes.searchParams.get("query")).toBeNull();
    const q = new URL(openVsxSearchUrl(" dracula ", "All"));
    expect(q.searchParams.get("query")).toBe("dracula");
    expect(q.searchParams.get("category")).toBeNull();
  });

  it("identifies PDF-related extensions for native feature banners", () => {
    expect(
      isPdfExtension({
        id: "tomoki1207.pdf",
        namespace: "tomoki1207",
        name: "pdf",
        displayName: "vscode-pdf",
        description: "Display PDF file in VS Code",
        version: "1.2.2",
        downloadCount: 100000,
        averageRating: 4.5,
      })
    ).toBe(true);

    expect(
      isPdfExtension({
        id: "ms-python.python",
        namespace: "ms-python",
        name: "python",
        displayName: "Python",
        description: "Python language support",
        version: "2024.18.0",
        downloadCount: 19400000,
        averageRating: 4.6,
      })
    ).toBe(false);
  });
});
