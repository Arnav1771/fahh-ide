import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from "./agent";
import { helpText, runSlash, type CommandApi, type Ipc, type SendOpts } from "./agentCommands";
import { agentReducer, initialAgentState, type AgentAction, type AgentState } from "./agentState";
import { parseSlash } from "./slash";
import type { AgentLoaded } from "./types";

const loaded: AgentLoaded = {
  session: "s9",
  title: "Old chat",
  history: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello", calls: [] }],
  turns: [{ id: 1, prompt: "hi", hist_start: 0, mode: "ask", at: 0 }],
};

function setup(over: Partial<AgentSettings> = {}, session: string | null = "s1", root: string | null = "/proj") {
  let settings: AgentSettings = { ...DEFAULT_AGENT_SETTINGS, model: "big", apiKey: "k", ...over };
  let state: AgentState = { ...initialAgentState, session };
  let fast = false;
  const sent: { prompt: string; opts?: SendOpts }[] = [];
  const ipc = {
    sessions: vi.fn(async () => [{ id: "a", title: "A", updated: 1, steps: 2 }]),
    load: vi.fn(async () => loaded),
    fork: vi.fn(async () => ({ ...loaded, session: "s10", title: "Fork of Old chat" })),
    revert: vi.fn(async () => ({ files: ["a.txt"], rewound: true, loaded })),
    rename: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    steps: vi.fn(async () => loaded.turns),
    compact: vi.fn(async () => ({ folded: 4, before: 1000, after: 200 })),
    context: vi.fn(async () => ({ used: 5000, window: 128000, percent: 3, messages: 7 })),
    usage: vi.fn(async () => ({ model_calls: 3, tool_calls: 2, tokens_in: 900, tokens_out: 100 })),
    exportSession: vi.fn(async () => "wrote .fahh/exports/s1.md"),
    agents: vi.fn(async () => ({
      agents: [{ name: "explore", description: "Read-only", model: null, mode: "qa" as const, source: "builtin", max_steps: 12 }],
      problems: ["project/broken.md: missing frontmatter"],
    })),
  } satisfies Ipc;
  const api: CommandApi = {
    ipc,
    settings: () => settings,
    state: () => state,
    root: () => root,
    update: (p) => (settings = { ...settings, ...p }),
    dispatch: (a: AgentAction) => (state = agentReducer(state, a)),
    send: async (prompt, opts) => void sent.push({ prompt, opts }),
    provider: () => ({ kind: "openai", base_url: "http://x", model: settings.model }),
    newChat: vi.fn(),
    reloadTabs: vi.fn(async () => {}),
    copy: vi.fn(async () => {}),
    exit: vi.fn(),
    usingFast: () => fast,
    setUsingFast: (b) => (fast = b),
  };
  const run = async (line: string) => {
    const p = parseSlash(line);
    if (!p || typeof p === "string") throw new Error("not a command: " + line);
    await runSlash(api, p);
  };
  const notices = () => state.items.filter((i) => i.kind === "notice").map((i) => (i as { text: string }).text);
  return { api, run, ipc, sent, notices, settings: () => settings, state: () => state };
}

describe("modes", () => {
  it("/mode and the mode shortcuts switch the default mode", async () => {
    const t = setup();
    await t.run("/mode smart");
    expect(t.settings().mode).toBe("smart");
    await t.run("/mode yolo");
    expect(t.settings().mode).toBe("bypass");
    expect(t.notices().at(-1)).toMatch(/Deny rules .* still apply/);
    await t.run("/normal");
    expect(t.settings().mode).toBe("ask");
    await t.run("/accept-edits");
    expect(t.settings().mode).toBe("auto-edit");
    await t.run("/mode");
    expect(t.notices().at(-1)).toBe("Mode: accept-edits");
    await t.run("/mode nope");
    expect(t.notices().at(-1)).toMatch(/Unknown mode/);
    expect(t.sent).toEqual([]);
  });

  it("an argument runs the prompt in that mode", async () => {
    const t = setup();
    await t.run("/plan add a cache");
    expect(t.sent.at(-1)).toEqual({ prompt: "add a cache", opts: { mode: "plan" } });
    expect(t.settings().mode).toBe("plan");
    await t.run("/code fix the bug");
    expect(t.sent.at(-1)).toEqual({ prompt: "fix the bug", opts: { mode: "ask" } });
    await t.run("/smart tidy up");
    expect(t.sent.at(-1)?.opts).toEqual({ mode: "smart" });
    await t.run("/bypass go");
    expect(t.sent.at(-1)?.opts).toEqual({ mode: "bypass" });
    await t.run("/plan"); // no argument: only switches
    expect(t.sent).toHaveLength(4);
  });

  it("/ask is one-shot read-only and does not change the mode", async () => {
    const t = setup({ mode: "auto-edit" });
    await t.run("/ask what does main do?");
    expect(t.sent.at(-1)).toEqual({ prompt: "what does main do?", opts: { mode: "qa" } });
    expect(t.settings().mode).toBe("auto-edit");
    await t.run("/ask");
    expect(t.notices().at(-1)).toMatch(/Usage: \/ask/);
  });
});

describe("model, fast, loop, btw, agent", () => {
  it("/model shows and switches", async () => {
    const t = setup();
    await t.run("/model");
    expect(t.notices().at(-1)).toBe("Model: big");
    await t.run("/model small-one");
    expect(t.settings().model).toBe("small-one");
  });

  it("/fast needs a fast model, toggles, or runs one prompt with it", async () => {
    const none = setup();
    await none.run("/fast");
    expect(none.notices().at(-1)).toMatch(/No fast model/);
    const t = setup({ fastModel: "quick" });
    await t.run("/fast");
    expect(t.api.usingFast()).toBe(true);
    await t.run("/fast");
    expect(t.api.usingFast()).toBe(false);
    await t.run("/fast summarise this");
    expect(t.sent.at(-1)).toEqual({ prompt: "summarise this", opts: { model: "quick" } });
  });

  it("/loop, /btw and /agent pass the right run spec", async () => {
    const t = setup();
    await t.run("/loop make the tests pass");
    expect(t.sent.at(-1)).toEqual({ prompt: "make the tests pass", opts: { run: { kind: "loop" } } });
    await t.run("/btw what is a mutex?");
    expect(t.sent.at(-1)?.opts).toEqual({ run: { kind: "btw" } });
    await t.run("/agent explore where is the parser");
    expect(t.sent.at(-1)).toEqual({ prompt: "where is the parser", opts: { run: { kind: "agent", name: "explore" } } });
    await t.run("/agent explore");
    expect(t.notices().at(-1)).toMatch(/Usage: \/agent/);
    await t.run("/loop");
    expect(t.notices().at(-1)).toMatch(/Usage: \/loop/);
  });
});

describe("sessions", () => {
  it("/ls lists, /resume without an id opens the picker, /continue loads the latest", async () => {
    const t = setup();
    await t.run("/ls");
    expect(t.state().items.at(-1)).toMatchObject({ kind: "sessions", sessions: [{ id: "a" }] });
    await t.run("/resume");
    expect(t.ipc.sessions).toHaveBeenCalledTimes(2);
    await t.run("/continue");
    expect(t.ipc.load).toHaveBeenLastCalledWith("/proj", null, []);
    expect(t.state()).toMatchObject({ session: "s9", title: "Old chat" });
    await t.run("/resume abc");
    expect(t.ipc.load).toHaveBeenLastCalledWith("/proj", "abc", []);
  });

  it("/steps, /title, /fork, /revert, /export, /rm-session go through the backend", async () => {
    const t = setup();
    await t.run("/steps");
    expect(t.notices().at(-1)).toBe("1. [normal] hi");
    await t.run("/title New name");
    expect(t.ipc.rename).toHaveBeenCalledWith("s1", "New name");
    expect(t.state().title).toBe("New name");
    await t.run("/fork 1");
    expect(t.ipc.fork).toHaveBeenCalledWith("s1", 1);
    expect(t.state().session).toBe("s10");
    await t.run("/revert 1");
    expect(t.ipc.revert).toHaveBeenCalledWith("s10", 1);
    expect(t.api.reloadTabs).toHaveBeenCalledWith(["a.txt"]);
    expect(t.notices().at(-1)).toMatch(/Reverted 1 file: a.txt; the conversation is rewound/);
    await t.run("/export");
    expect(t.ipc.exportSession).toHaveBeenLastCalledWith("s9", ".fahh/exports/s9.md");
    await t.run("/rm-session abc");
    expect(t.ipc.remove).toHaveBeenCalledWith("/proj", "abc");
    await t.run("/revert x");
    expect(t.notices().at(-1)).toMatch(/Usage: \/revert/);
  });

  it("commands that need a session or a folder say so", async () => {
    const t = setup({}, null, null);
    await t.run("/steps");
    expect(t.notices().at(-1)).toMatch(/no session yet/);
    await t.run("/ls");
    expect(t.notices().at(-1)).toMatch(/Open a folder first/);
  });

  it("a failing backend call becomes an error notice, not a crash", async () => {
    const t = setup();
    t.ipc.compact.mockRejectedValueOnce("nothing to compact yet");
    await t.run("/compact");
    expect(t.notices().at(-1)).toBe("nothing to compact yet");
  });
});

describe("context, usage, workspace, help", () => {
  it("/compact, /context and /usage report numbers", async () => {
    const t = setup();
    await t.run("/compact");
    expect(t.notices().at(-1)).toMatch(/Compacted 4 messages: about 1000 to 200/);
    await t.run("/context");
    expect(t.notices().at(-1)).toMatch(/about 5000 of 128000 tokens \(3%\)/);
    await t.run("/usage");
    expect(t.notices().at(-1)).toMatch(/Model calls: 3\nTool calls: 2/);
  });

  it("/add-dir, /remove-dir, /workspace", async () => {
    const t = setup();
    await t.run("/add-dir /other");
    expect(t.settings().extraDirs).toEqual(["/other"]);
    await t.run("/add-dir /other");
    expect(t.settings().extraDirs).toEqual(["/other"]);
    await t.run("/workspace");
    expect(t.notices().at(-1)).toBe("/proj\n+ /other");
    await t.run("/remove-dir /other");
    expect(t.settings().extraDirs).toEqual([]);
    await t.run("/remove-dir /nope");
    expect(t.notices().at(-1)).toMatch(/was not added/);
  });

  it("/agents lists definitions and the files that were skipped", async () => {
    const t = setup();
    await t.run("/agents");
    expect(t.notices().at(-1)).toContain("explore [builtin] Read-only (ask (read-only), max 12 steps)");
    expect(t.notices().at(-1)).toContain("skipped: project/broken.md: missing frontmatter");
  });

  it("/config never prints the key", async () => {
    const t = setup({ apiKey: "sk-secret-123" });
    await t.run("/config");
    expect(t.notices().at(-1)).not.toContain("sk-secret");
    expect(t.notices().at(-1)).toContain("Model: big");
  });

  it("/help lists every command grouped, /copy copies the last reply, /exit and /clear call the host", async () => {
    expect(helpText()).toMatch(/Session\n {2}\/model/);
    expect(helpText()).toContain("/loop <prompt>");
    const t = setup();
    await t.run("/copy");
    expect(t.notices().at(-1)).toMatch(/no reply to copy/);
    t.api.dispatch({ type: "event", event: { type: "text_delta", turn: 1, text: "the reply" } });
    await t.run("/copy");
    expect(t.api.copy).toHaveBeenCalledWith("the reply");
    await t.run("/exit");
    expect(t.api.exit).toHaveBeenCalled();
    await t.run("/clear");
    expect(t.api.newChat).toHaveBeenCalled();
  });
});
