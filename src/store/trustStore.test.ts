import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = new Map<string, boolean>();
vi.mock("../lib/tauri", () => ({
  workspaceTrustGet: vi.fn(async (root: string) => (backend.has(root) ? backend.get(root)! : null)),
  workspaceTrustSet: vi.fn(async (root: string, t: boolean) => void backend.set(root, t)),
}));
const answers: (string | null)[] = [];
vi.mock("./dialogStore", () => ({ chooseDialog: vi.fn(async () => answers.shift() ?? null) }));

import { ensureTrusted, useTrustStore } from "./trustStore";

describe("workspace trust", () => {
  beforeEach(() => {
    backend.clear();
    answers.length = 0;
  });

  it("asks once for a new folder and remembers the answer", async () => {
    await useTrustStore.getState().load("/clone");
    expect(useTrustStore.getState().trusted).toBeNull();
    answers.push("restricted");
    expect(await ensureTrusted()).toBe(false);
    expect(backend.get("/clone")).toBe(false);
    // already answered: no second question
    expect(await ensureTrusted()).toBe(false);
    await useTrustStore.getState().load("/clone");
    expect(useTrustStore.getState().trusted).toBe(false);
  });

  it("dismissing the question trusts nothing and saves nothing", async () => {
    await useTrustStore.getState().load("/other");
    answers.push(null);
    expect(await ensureTrusted()).toBe(false);
    expect(backend.has("/other")).toBe(false);
  });

  it("trusting enables the folder", async () => {
    await useTrustStore.getState().load("/mine");
    answers.push("trust");
    expect(await ensureTrusted()).toBe(true);
    expect(useTrustStore.getState().trusted).toBe(true);
  });
});
