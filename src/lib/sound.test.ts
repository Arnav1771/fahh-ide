import { describe, expect, it } from "vitest";
import { chooseSound, resetSound, type SoundDeps } from "./sound";
import { parseSettings } from "../store/settingsStore";

function deps(over: Partial<SoundDeps> = {}) {
  const calls: string[] = [];
  let name = "old.wav";
  const d: SoundDeps = {
    pick: async () => "/music/ding.ogg",
    store: async (p) => (calls.push(`store ${p}`), "ding.ogg"),
    load: async () => (calls.push("load"), true),
    clear: async () => void calls.push("clear"),
    setName: (n) => void (name = n),
    ...over,
  };
  return { d, calls, name: () => name };
}

describe("error sound selection", () => {
  it("cancelling the dialog changes nothing", async () => {
    const t = deps({ pick: async () => null });
    expect(await chooseSound(t.d)).toBeNull();
    expect(t.calls).toEqual([]);
    expect(t.name()).toBe("old.wav");
  });

  it("a good file is copied, decoded, then remembered", async () => {
    const t = deps();
    expect(await chooseSound(t.d)).toEqual({ ok: true, name: "ding.ogg" });
    expect(t.calls).toEqual(["store /music/ding.ogg", "load"]);
    expect(t.name()).toBe("ding.ogg");
  });

  it("a file the backend rejects keeps the old choice and says why", async () => {
    const t = deps({ store: async () => { throw "big.wav is 9.0 MB; pick a sound under 5 MB."; } });
    expect(await chooseSound(t.d)).toEqual({ ok: false, error: "big.wav is 9.0 MB; pick a sound under 5 MB." });
    expect(t.name()).toBe("old.wav");
  });

  it("a file that will not decode is removed and the default comes back", async () => {
    const t = deps({ load: async () => false });
    const r = await chooseSound(t.d);
    expect(r && !r.ok && r.error).toContain("could not be played");
    expect(t.calls).toContain("clear");
    expect(t.name()).toBe("");
  });

  it("reset goes back to the default fahh", async () => {
    const t = deps();
    await resetSound(t.d);
    expect(t.calls).toEqual(["clear"]);
    expect(t.name()).toBe("");
  });

  it("the choice is saved in Settings and survives a reload", () => {
    expect(parseSettings(null).fahhSound).toBe("");
    expect(parseSettings(JSON.stringify({ fahhSound: "ding.ogg" })).fahhSound).toBe("ding.ogg");
    expect(parseSettings(JSON.stringify({ fahhSound: 42 })).fahhSound).toBe("");
    expect(parseSettings(null).checkUpdatesOnLaunch).toBe(true);
    expect(parseSettings(JSON.stringify({ checkUpdatesOnLaunch: false })).checkUpdatesOnLaunch).toBe(false);
  });
});
