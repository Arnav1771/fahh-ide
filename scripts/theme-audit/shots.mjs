// Screenshot every main surface of the app in every shipped theme, against a fake Tauri
// backend (like scripts/term-check). Run from the repo root:
//   node scripts/theme-audit/shots.mjs IMP_DOCS/theme-audit/after
// THEMES=fahh-light,dracula limits the themes; the output folder gets <theme>-<view>.jpg.
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdirSync } from "fs";

const OUT = process.argv[2] ?? "IMP_DOCS/theme-audit/after";
const THEMES = (process.env.THEMES ?? "fahh-gold,fahh-dark,fahh-light,github-dark,dracula,solarized-dark,cate-obsidian").split(",");
mkdirSync(OUT, { recursive: true });

const ANSI =
  "$ ls --color\r\n" +
  [30, 31, 32, 33, 34, 35, 36, 37].map((c) => `\x1b[${c}mcolour${c - 30}\x1b[0m`).join(" ") +
  "\r\n" +
  [90, 91, 92, 93, 94, 95, 96, 97].map((c) => `\x1b[${c}mbright${c - 90}\x1b[0m`).join(" ") +
  "\r\n\x1b[1mbold text\x1b[0m plain text \x1b[2mdim text\x1b[0m\r\n$ ";

const NOTEBOOK = JSON.stringify({
  cells: [
    { cell_type: "markdown", metadata: {}, source: ["# Notebook\n", "Some *markdown* text."] },
    { cell_type: "code", metadata: {}, execution_count: 1, source: ["print('hello')"], outputs: [{ output_type: "stream", name: "stdout", text: ["hello\n"] }] },
  ],
  metadata: { kernelspec: { name: "python3", display_name: "Python 3", language: "python" } },
  nbformat: 4,
  nbformat_minor: 5,
});

/** Runs in the page before the app: a fake backend that answers what the screens need. */
function mock({ theme, ansi, notebook }) {
  localStorage.setItem("fahh-theme", theme);
  localStorage.setItem("fahh-onboarded", "1");
  localStorage.removeItem("fahh-layout-mode"); // every page load starts in the editor, not in Agent mode
  const callbacks = {};
  const handlers = {};
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  const emit = (event, payload) => (handlers[event] || []).forEach((h) => callbacks[h]?.({ event, id: 0, payload }));
  const f = (path) => ({ name: path.split("/").pop(), path, is_dir: false });
  const tree = {
    name: "proj",
    path: "/proj",
    is_dir: true,
    children: [
      { name: "src", path: "/proj/src", is_dir: true, children: [f("/proj/src/app.ts"), f("/proj/src/styles.css")] },
      f("/proj/demo.ipynb"),
      f("/proj/README.md"),
      f("/proj/package.json"),
    ],
  };
  const files = {
    "/proj/src/app.ts": 'import { readFile } from "fs/promises";\n\n// Load the config and greet.\nexport async function main(name: string): Promise<number> {\n  const cfg = JSON.parse(await readFile("cfg.json", "utf8"));\n  console.log(`hello ${name}`, cfg.version);\n  return 42;\n}\n',
    "/proj/demo.ipynb": notebook,
    "/proj/README.md": "# proj\n\nA demo project.\n",
  };
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
    async invoke(cmd, args) {
      if (cmd === "plugin:event|listen") {
        (handlers[args.event] ??= []).push(args.handler);
        return next++;
      }
      if (cmd === "plugin:dialog|open") return "/proj";
      if (cmd === "get_file_tree") return tree;
      if (cmd === "read_file") {
        if (args.path in files) return files[args.path];
        throw "not found";
      }
      if (cmd === "terminal_profiles") return [{ id: "bash", name: "bash", program: "bash", args: [] }];
      if (cmd === "pty_spawn") {
        const id = next++;
        setTimeout(() => emit("pty://data", { id, data: ansi }), 50);
        return id;
      }
      if (cmd.startsWith("plugin:")) return null;
      throw `${cmd}: no backend in the theme audit`; // like the web build: every view degrades
    },
  };
}

const server = await createServer({ configFile: "vite.config.ts", logLevel: "error", server: { port: 1432, strictPort: true } });
await server.listen();
const browser = await chromium.launch();
const problems = [];

async function palette(page, label) {
  await page.keyboard.press("Control+Shift+P");
  await page.waitForTimeout(200);
  await page.keyboard.type(label);
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
}

for (const theme of THEMES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(mock, { theme, ansi: ANSI, notebook: NOTEBOOK });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`${theme}: ${e.message}`));
  const shot = (name) => page.screenshot({ path: `${OUT}/${theme}-${name}.jpg`, type: "jpeg", quality: 70 });
  const step = async (name, fn) => {
    try {
      await fn();
      await shot(name);
    } catch (e) {
      problems.push(`${theme} ${name}: ${String(e.message ?? e).split("\n")[0]}`);
    } finally {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(150);
    }
  };

  await page.goto("http://localhost:1432/");
  await page.waitForTimeout(2500);
  await step("editor", async () => {
    await page.getByRole("button", { name: "Open folder" }).first().click();
    await page.waitForTimeout(600);
    await page.locator('[data-path="/proj/src/app.ts"]').click();
    await page.waitForTimeout(1500);
  });
  for (const m of ["File", "Edit", "View"]) {
    await step(`menu-${m.toLowerCase()}`, async () => {
      await page.locator(".fahh-titlebar button", { hasText: new RegExp(`^${m}$`) }).click();
      await page.waitForTimeout(300);
    });
  }
  await step("explorer-context-menu", async () => {
    await page.locator('[data-path="/proj/src/app.ts"]').click({ button: "right" });
    await page.waitForTimeout(300);
  });
  await step("tab-context-menu", async () => {
    await page.locator(".dv-tab", { hasText: "app.ts" }).first().click({ button: "right" });
    await page.waitForTimeout(300);
  });
  await step("command-palette", async () => {
    await page.keyboard.press("Control+Shift+P");
    await page.waitForTimeout(300);
  });
  await step("dialog", async () => {
    await page.locator('[data-path="/proj/src/styles.css"]').click({ button: "right" });
    await page.waitForTimeout(200);
    await page.getByRole("menuitem", { name: "Delete" }).or(page.locator("button", { hasText: /^Delete$/ })).first().click();
    await page.waitForTimeout(300);
  });
  await step("problems", () => palette(page, "Problems"));
  await step("terminal", async () => {
    await palette(page, "Terminal");
    await page.waitForTimeout(800);
  });
  await step("notebook", async () => {
    await page.locator('[data-path="/proj/demo.ipynb"]').click();
    await page.waitForTimeout(1500);
  });
  await step("settings", () => palette(page, "Settings"));
  await step("fahh-local", () => palette(page, "Fahh Local (AI agent)"));
  await step("agent-mode", async () => {
    await palette(page, "Switch to Agent Mode");
    await page.waitForTimeout(500);
  });
  await page.goto("http://localhost:1432/");
  await page.waitForTimeout(2000);
  await step("canvas", async () => {
    await palette(page, "Spatial Canvas Mode");
    await page.waitForTimeout(1500);
  });
  await ctx.close();
  console.log(`${theme}: done`);
}

await browser.close();
await server.close();
console.log(problems.length ? `Problems:\n${problems.join("\n")}` : "No problems");
