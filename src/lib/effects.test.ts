import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * An effect may only return a cleanup function. `useEffect(() => el.scrollIntoView())`
 * returns whatever the DOM call returns, and current WebView2 returns a Promise from
 * scrollIntoView/scrollTo/focus-like calls: React then calls it on cleanup and the
 * panel crashes ("t is not a function", Roundtable in v0.7.1). Keep such calls in braces.
 */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? tsxFiles(full) : full.endsWith(".tsx") ? [full] : [];
  });
}

describe("effects", () => {
  it("never return a DOM call's value as their cleanup", () => {
    const bad = /useEffect\(\s*\(\)\s*=>\s*[\w.?]*\.(scrollIntoView|scrollTo|scrollBy|focus|blur|select|animate|play|requestFullscreen)\(/;
    const offenders = tsxFiles(join(__dirname, "..")).filter((f) => bad.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
