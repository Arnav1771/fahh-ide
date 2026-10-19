import { describe, it, expect } from "vitest";
import {
  formatDownloads,
  getVsixDownloadUrl,
  sortExtensions,
  filterExtensions,
  isPdfExtension,
  CURATED_MARKETPLACE,
} from "./index";

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

  it("sorts extensions by downloads, rating, and name", () => {
    const sortedByDownloads = sortExtensions(CURATED_MARKETPLACE, "downloads");
    expect(sortedByDownloads[0].downloadCount).toBeGreaterThanOrEqual(
      sortedByDownloads[1].downloadCount
    );

    const sortedByRating = sortExtensions(CURATED_MARKETPLACE, "rating");
    expect(sortedByRating[0].averageRating).toBeGreaterThanOrEqual(
      sortedByRating[sortedByRating.length - 1].averageRating
    );

    const sortedByName = sortExtensions(CURATED_MARKETPLACE, "name");
    expect(
      sortedByName[0].displayName.localeCompare(sortedByName[1].displayName)
    ).toBeLessThanOrEqual(0);
  });

  it("filters extensions by query, category, and verified status", () => {
    const pythonResults = filterExtensions(CURATED_MARKETPLACE, "python", "All", false);
    expect(pythonResults.some((e) => e.name === "python")).toBe(true);

    const themeResults = filterExtensions(CURATED_MARKETPLACE, "", "Themes", false);
    expect(themeResults.every((e) => e.category === "Themes")).toBe(true);

    const verifiedResults = filterExtensions(CURATED_MARKETPLACE, "", "All", true);
    expect(verifiedResults.every((e) => e.verified)).toBe(true);
  });

  it("contains high-relevance curated extensions across languages, formatters, and tools", () => {
    expect(CURATED_MARKETPLACE.length).toBeGreaterThanOrEqual(10);
    const ids = CURATED_MARKETPLACE.map((e) => e.id);
    expect(ids).toContain("ms-python.python");
    expect(ids).toContain("rust-lang.rust-analyzer");
    expect(ids).toContain("esbenp.prettier-vscode");
    expect(ids).toContain("golang.go");
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
