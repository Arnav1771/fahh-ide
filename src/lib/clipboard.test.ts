import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";
import { useToastStore } from "../store/toastStore";

describe("copyText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useToastStore.setState({ toasts: [] });
  });

  it("copies and says nothing on success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("C:\p\a.ts")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("C:\p\a.ts");
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("surfaces a failed copy instead of swallowing it", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Document is not focused.")) } });
    expect(await copyText("x")).toBe(false);
    expect(useToastStore.getState().toasts[0]).toMatchObject({ kind: "error", text: expect.stringContaining("Document is not focused.") });
  });

  it("reports a missing clipboard API", async () => {
    vi.stubGlobal("navigator", {});
    expect(await copyText("x")).toBe(false);
    expect(useToastStore.getState().toasts[0].kind).toBe("error");
  });
});
