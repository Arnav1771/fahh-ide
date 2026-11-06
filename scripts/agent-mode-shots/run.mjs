// Screenshots of Agent mode (the whole app in the browser, Tauri bridge faked) in every
// state the redesign covers: empty, running (mocked agent events) and review, at 1920 and
// 1280 px, in Fahh Gold, Fahh Dark and Fahh Light.
//   node scripts/agent-mode-shots/run.mjs <out-dir>     e.g. IMP_DOCS/agent-mode/after
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const OUT = path.resolve(process.argv[2] ?? "IMP_DOCS/agent-mode/after");
fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY; // e.g. "fahh-light-1920-empty"

const ROOT = "/home/me/shop-api";
const now = Math.floor(Date.now() / 1000);
const SESSIONS = [
  { id: "s4", title: "Bump the Stripe SDK to v15", updated: now - 60 * 4, steps: 3 },
  { id: "s3", title: "Why does the cart test flake on CI?", updated: now - 3600 * 3, steps: 5 },
  { id: "s2", title: "Plan: move sessions from cookies to Redis", updated: now - 86400 * 2, steps: 2 },
  { id: "s1", title: "Explain the order state machine", updated: now - 86400 * 9, steps: 1 },
];
const DIFFS = [
  { path: "src/routes/checkout.ts", before: "router.post('/checkout', handler);\n", after: "router.post('/checkout', rateLimit({ max: 20 }), handler);\n" },
  { path: "src/middleware/rateLimit.ts", before: null, after: "export function rateLimit(o: { max: number }) {\n  return (req, res, next) => next();\n}\n" },
  { path: "test/checkout.test.ts", before: "it('checks out', ...)\n", after: "it('checks out', ...)\nit('limits bursts', ...)\n" },
];

// The fake Tauri bridge: answers the agent IPC with fixtures and rejects everything else.
const bridge = ({ sessions, diffs, root }) => {
  const callbacks = {};
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    transformCallback(cb) {
      const id = next++;
      callbacks[id] = cb;
      return id;
    },
    unregisterCallback(id) {
      delete callbacks[id];
    },
    convertFileSrc: (p) => p,
    async invoke(cmd) {
      if (cmd.startsWith("plugin:event|")) return next++;
      switch (cmd) {
        case "plugin:event|listen":
          return next++;
        case "agent_sessions":
          return sessions;
        case "agent_list_models":
          return ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "llama-3.3-70b-versatile"];
        case "agent_turn_diff":
          return diffs;
        case "agent_context":
          return { used: 18400, window: 131072, percent: 14, messages: 22 };
        case "agent_usage":
          return { model_calls: 9, tool_calls: 14, tokens_in: 48210, tokens_out: 3920 };
        case "agent_steps":
          return [
            { id: 1, prompt: "Add rate limiting to the checkout route", hist_start: 0, mode: "smart", at: Date.now() / 1000 - 300 },
            { id: 2, prompt: "Also cover it with a test", hist_start: 8, mode: "smart", at: Date.now() / 1000 - 120 },
          ];
        case "agent_start":
          return { session: "s5", turn: 1 };
        case "read_dir":
        case "read_directory":
          return { name: "shop-api", path: root, is_dir: true, children: [] };
        default:
          // like the plain browser build: everything else is unavailable
          throw `${cmd}: not available in this preview`;
      }
    },
  };
};

const TREE = {
  name: "shop-api",
  path: ROOT,
  is_dir: true,
  children: ["package.json", "tsconfig.json", "vite.config.ts", "README.md", "src", "test", ".fahh"].map((n) => ({
    name: n,
    path: `${ROOT}/${n}`,
    is_dir: !n.includes("."),
  })),
};

const ev = (event) => ({ type: "event", event });
const RUNNING = [
  { type: "user_sent", text: "Add rate limiting to the checkout route and cover it with a test" },
  { type: "started", session: "s5", turn: 1 },
  ev({ type: "turn_started", turn: 1 }),
  ev({ type: "text_delta", turn: 1, text: "I'll look at how routes are wired first, then add a small middleware." }),
  ev({ type: "tool_call", turn: 1, id: "t1", name: "list_dir", args: { path: "src/routes" }, kind: "read" }),
  ev({ type: "tool_result", turn: 1, id: "t1", ok: true, output: "checkout.ts\ncart.ts\norders.ts", elapsed_ms: 12 }),
  ev({ type: "tool_call", turn: 1, id: "t2", name: "read_file", args: { path: "src/routes/checkout.ts" }, kind: "read" }),
  ev({ type: "tool_result", turn: 1, id: "t2", ok: true, output: "router.post('/checkout', handler);", elapsed_ms: 8 }),
  ev({ type: "tool_call", turn: 1, id: "t3", name: "search", args: { pattern: "rateLimit" }, kind: "read" }),
  ev({ type: "tool_result", turn: 1, id: "t3", ok: true, output: "no matches", elapsed_ms: 140 }),
  ev({ type: "text_delta", turn: 1, text: "\n\nThere is no limiter yet. Adding `src/middleware/rateLimit.ts` and wiring it into the checkout route." }),
  ev({ type: "tool_call", turn: 1, id: "t4", name: "write_file", args: { path: "src/middleware/rateLimit.ts" }, kind: "edit" }),
  ev({ type: "tool_result", turn: 1, id: "t4", ok: true, output: "wrote 3 lines", elapsed_ms: 21 }),
  ev({ type: "file_changed", turn: 1, path: "src/middleware/rateLimit.ts" }),
  ev({ type: "tool_call", turn: 1, id: "t5", name: "edit_file", args: { path: "src/routes/checkout.ts" }, kind: "edit" }),
  ev({ type: "tool_result", turn: 1, id: "t5", ok: true, output: "1 edit", elapsed_ms: 17 }),
  ev({ type: "file_changed", turn: 1, path: "src/routes/checkout.ts" }),
  ev({ type: "sub_started", turn: 1, child: "c1", name: "test-writer", task: "Write a test for burst requests to /checkout", model: null, mode: "auto-edit" }),
  { type: "event", event: { type: "sub", turn: 1, child: "c1", name: "test-writer", event: { type: "tool_call", turn: 1, id: "c1t1", name: "read_file", args: { path: "test/checkout.test.ts" }, kind: "read" } } },
  ev({ type: "tool_call", turn: 1, id: "t6", name: "run_command", args: { command: "pnpm vitest run test/checkout.test.ts" }, kind: "run" }),
];
const REVIEW = [
  ...RUNNING.slice(0, -1),
  { type: "event", event: { type: "sub", turn: 1, child: "c1", name: "test-writer", event: { type: "file_changed", turn: 1, path: "test/checkout.test.ts" } } },
  ev({ type: "sub_done", turn: 1, child: "c1", name: "test-writer", ok: true, steps: 3, summary: "Added 'limits bursts' to test/checkout.test.ts." }),
  ev({ type: "tool_call", turn: 1, id: "t6", name: "run_command", args: { command: "pnpm vitest run test/checkout.test.ts" }, kind: "run" }),
  ev({ type: "tool_result", turn: 1, id: "t6", ok: true, output: "2 passed", elapsed_ms: 2310 }),
  ev({
    type: "plan_written",
    turn: 1,
    id: "p1",
    path: ".fahh/plans/rate-limit.md",
    markdown: "# Rate limit checkout\n\n- [x] Add a rateLimit middleware\n- [x] Wire it into POST /checkout\n- [x] Test burst requests\n- [ ] Make the limit configurable per environment",
  }),
  ev({ type: "text_delta", turn: 1, text: "\n\nDone. `POST /checkout` now allows 20 requests a minute per client, and the new test passes. Review the 3 changed files on the right." }),
  ev({ type: "done", turn: 1, steps: 9, files: DIFFS.map((d) => d.path) }),
];

const THEMES = ["fahh-gold", "fahh-dark", "fahh-light"];
const WIDTHS = (process.env.WIDTHS ?? "1920,1280").split(",").map(Number);
const STATES = {
  empty: { mode: "bypass", events: [] },
  running: { mode: "smart", events: RUNNING },
  review: { mode: "auto-edit", events: REVIEW },
  // the docked Fahh Local panel in Editor mode, which shares the same pieces
  "dock-review": { mode: "bypass", events: REVIEW, layout: "editor" },
};

const server = await createServer({ configFile: "vite.config.ts", logLevel: "error", server: { port: 1433, strictPort: true } });
await server.listen();
const browser = await chromium.launch();
const problems = [];
let n = 0;
try {
  for (const theme of THEMES)
    for (const width of WIDTHS)
      for (const [state, { mode, events, layout = "agent" }] of Object.entries(STATES)) {
        const name = `${theme}-${width}-${state}`;
        if (ONLY && !name.includes(ONLY)) continue;
        const ctx = await browser.newContext({ viewport: { width, height: width === 1920 ? 1080 : 800 } });
        const page = await ctx.newPage();
        page.on("pageerror", (e) => problems.push(`${name}: ${e.message}`));
        await page.addInitScript(bridge, { sessions: SESSIONS, diffs: DIFFS, root: ROOT });
        await page.addInitScript(
          ({ theme, mode, layout }) => {
            localStorage.setItem("fahh-onboarded", "1");
            localStorage.setItem("fahh-theme", theme);
            localStorage.setItem("fahh-layout-mode", layout);
            localStorage.setItem("fahh-skip-restore", "1");
            localStorage.setItem(
              "fahh-agent-settings",
              JSON.stringify({ provider: "groq", baseUrl: "https://api.groq.com/openai/v1", model: "qwen/qwen3.8-27b", apiKey: "gsk_demo", mode, fastModel: "", extraDirs: [], endpoints: [] })
            );
          },
          { theme, mode, layout }
        );
        await page.goto("http://localhost:1433/");
        await page.waitForSelector(layout === "agent" ? '[data-testid="agent-mode"]' : ".dockview-theme-fahh", { timeout: 30000 });
        await page.evaluate(
          async ({ root, tree, events, layout }) => {
            if (layout === "editor") (await import("/src/lib/workbench.ts")).revealView("agent");
            const { useFileStore } = await import("/src/store/fileStore.ts");
            useFileStore.getState().setRoot(root);
            useFileStore.getState().setTree(tree);
            const { useAgentStore } = await import("/src/store/agentStore.ts");
            for (const a of events) useAgentStore.getState().dispatch(a);
            if (events.length) useAgentStore.setState({ title: "Add rate limiting to the checkout route" });
          },
          { root: ROOT, tree: TREE, events, layout }
        );
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(OUT, `${name}.png`) });
        const sw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (sw > 0) problems.push(`${name}: horizontal overflow ${sw}px`);
        n++;
        await ctx.close();
      }
} finally {
  await browser.close();
  await server.close();
}
console.log(`${n} screenshots in ${OUT}`);
if (problems.length) console.log("problems:\n" + problems.join("\n"));
