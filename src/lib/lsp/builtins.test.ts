import { describe, expect, it, vi } from "vitest";
import { toggleBuiltins } from "./monacoLsp";

const defaults = (cfg: Record<string, boolean>) => {
  const d = { modeConfiguration: cfg, setModeConfiguration: vi.fn((c: Record<string, boolean>) => (d.modeConfiguration = c)) };
  return d;
};

describe("toggleBuiltins", () => {
  it("does not touch the mode (and restart its worker) when nothing changes", () => {
    // A server failing to start again and again used to re-set the TS mode each time,
    // which disposed the worker under in-flight completions ("Loading..." forever).
    const d = defaults({ completionItems: true, hovers: true, documentSymbols: true });
    expect(toggleBuiltins(d, true)).toBe(false);
    expect(d.setModeConfiguration).not.toHaveBeenCalled();
  });

  it("switches only the overlapping features, once", () => {
    const d = defaults({ completionItems: true, hovers: true, documentSymbols: true });
    expect(toggleBuiltins(d, false)).toBe(true);
    expect(d.modeConfiguration).toEqual({ completionItems: false, hovers: false, documentSymbols: true });
    expect(toggleBuiltins(d, false)).toBe(false);
    expect(d.setModeConfiguration).toHaveBeenCalledTimes(1);
  });
});
