import { describe, expect, it } from "vitest";
import { sortChecks, summarize, type SetupCheck } from "./doctor";

const c = (name: string, found: boolean, kind: SetupCheck["kind"] = "tool"): SetupCheck => ({ name, kind, found, version: found ? "1.0.0" : null, program: found ? name : null, hint: `install ${name}` });

describe("Check Setup results", () => {
  it("puts tools before language servers and keeps their order", () => {
    const sorted = sortChecks([c("pylsp", false, "language server"), c("git", true), c("rust-analyzer", true, "language server"), c("node", false)]);
    expect(sorted.map((x) => x.name)).toEqual(["git", "node", "pylsp", "rust-analyzer"]);
  });

  it("drops malformed entries and non-arrays", () => {
    expect(sortChecks(null)).toEqual([]);
    expect(sortChecks([{ name: 3 }, c("git", true), "x"])).toHaveLength(1);
  });

  it("summarizes what is missing", () => {
    expect(summarize([c("git", true), c("node", true)])).toBe("All 2 found.");
    expect(summarize([c("git", true), c("node", false), c("cargo", false)])).toBe("2 missing: node, cargo.");
    expect(summarize([])).toBe("Nothing was checked.");
  });
});
