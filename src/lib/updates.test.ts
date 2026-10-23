import { describe, expect, it, vi } from "vitest";
import { assetFor, checkForUpdates, compareVersions } from "./updates";

describe("compareVersions", () => {
  it("compares numerically, ignores a leading v, and puts pre-releases first", () => {
    expect(compareVersions("0.6.10", "0.6.9")).toBe(1);
    expect(compareVersions("v0.6.4", "0.6.4")).toBe(0);
    expect(compareVersions("0.6", "0.6.0")).toBe(0);
    expect(compareVersions("0.7.0-beta.1", "0.7.0")).toBe(-1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
  });
});

const assets = [
  { name: "Fahh.Editor_0.7.0_amd64.AppImage", browser_download_url: "u/appimage" },
  { name: "Fahh.Editor_0.7.0_x64_en-US.msi", browser_download_url: "u/msi" },
  { name: "Fahh.Editor_0.7.0_aarch64.dmg", browser_download_url: "u/dmg" },
];

describe("checkForUpdates", () => {
  it("picks this platform's installer", () => {
    expect(assetFor(assets, "Mozilla/5.0 (Windows NT 10.0)")?.browser_download_url).toBe("u/msi");
    expect(assetFor(assets, "Mozilla/5.0 (Macintosh)")?.browser_download_url).toBe("u/dmg");
    expect(assetFor(assets, "Mozilla/5.0 (X11; Linux x86_64)")?.browser_download_url).toBe("u/appimage");
    expect(assetFor([], "Windows")).toBeUndefined();
  });
  it("reports a newer release with its links", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tag_name: "v0.7.0", html_url: "rel/0.7.0", assets }) });
    const r = await checkForUpdates("0.6.4", fetcher as unknown as typeof fetch, "Windows");
    expect(fetcher.mock.calls[0][0]).toBe("https://api.github.com/repos/Arnav1771/fahh-ide/releases/latest");
    expect(r).toEqual({ latest: "0.7.0", newer: true, url: "rel/0.7.0", download: "u/msi" });
  });
  it("says up to date when the release is this version or older", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tag_name: "v0.6.4", html_url: "x" }) });
    expect((await checkForUpdates("0.6.4", fetcher as unknown as typeof fetch, "")).newer).toBe(false);
  });
  it("fails clearly on an HTTP error or an empty answer", async () => {
    const limited = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(checkForUpdates("0.6.4", limited as unknown as typeof fetch)).rejects.toThrow(/rate limit/);
    const empty = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(checkForUpdates("0.6.4", empty as unknown as typeof fetch)).rejects.toThrow(/no release/);
  });
});
