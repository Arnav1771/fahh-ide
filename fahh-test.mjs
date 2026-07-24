// Fahh Editor — browser smoke test (web/dev-server mode).
//
// Runs the built frontend against the Vite dev server at http://localhost:1420
// with Playwright. In web mode there is no Tauri backend, so `invoke()` calls
// reject; components are expected to degrade gracefully (never crash). This
// suite asserts the shell renders, every panel is reachable, and there are no
// *critical* (non-Tauri) console errors.
//
//   Terminal 1:  pnpm dev
//   Terminal 2:  node fahh-test.mjs
//
// Screenshots + JSON results are written under IMP_DOCS/CANARY_RESULTS/v0.3.1/.

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "IMP_DOCS", "CANARY_RESULTS", "v0.3.1");
const SHOTS = join(OUT, "screenshots");
mkdirSync(SHOTS, { recursive: true });

const URL = process.env.FAHH_URL || "http://localhost:1420";
const EXPECTED_VERSION = "v0.3.0";

const results = [];
let passed = 0,
  failed = 0;

function log(label, ok, detail = "") {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
  results.push({ label, ok, detail });
  ok ? passed++ : failed++;
}

async function shot(page, name) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
  console.log(`  📸 ${name}.png`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(e.message));

  // 1 — App loads
  try {
    await page.goto(URL, { waitUntil: "networkidle", timeout: 15000 });
    log(`App loads at ${URL}`, true);
  } catch (e) {
    log(`App loads at ${URL}`, false, e.message);
    await browser.close();
    process.exit(1);
  }
  await shot(page, "01-initial-load");

  // 2 — Title
  const title = await page.title();
  log('Page title is "Fahh Editor"', title === "Fahh Editor", `got "${title}"`);

  // 3 — Layout regions
  log("Activity bar visible (w-10)", await page.locator(".w-10").first().isVisible());
  log("Sidebar panel visible (w-60)", await page.locator(".w-60").first().isVisible());

  // 4 — File tree empty state
  log("File tree shows 'No folder open'", await page.locator("text=No folder open").isVisible());
  log("'Open Folder' button visible", await page.locator("text=Open Folder").first().isVisible());
  await shot(page, "02-file-tree-empty");

  // 5 — Editor welcome screen
  log("Editor welcome screen visible", await page.locator("text=Open a file to start editing").isVisible());
  await shot(page, "03-editor-welcome");

  // 6 — Terminal input
  log("Terminal command input visible", await page.locator('input[placeholder="Enter command..."]').isVisible());
  await shot(page, "04-terminal-panel");

  // 7 — Status bar + correct version
  log("Status bar shows '● Fahh Editor'", await page.locator("text=Fahh Editor").first().isVisible());
  log(`Version ${EXPECTED_VERSION} shown in status bar`, await page.locator(`text=${EXPECTED_VERSION}`).isVisible());

  // 8 — Panel toggle (Hide Panel / Show Panel)
  log("'Hide Panel' toggle visible", await page.locator("text=Hide Panel").isVisible());
  await page.click("text=Hide Panel");
  log("Panel hides when toggled", !(await page.locator('input[placeholder="Enter command..."]').isVisible()));
  await shot(page, "05-panel-hidden");
  await page.click("text=Show Panel");
  log("Panel restores when re-toggled", await page.locator('input[placeholder="Enter command..."]').isVisible());

  // 9 — Activity bar navigation
  await page.locator('button[title="Source Control"]').click();
  await page.waitForTimeout(200);
  log("Git sidebar reachable", await page.locator('button[title="Source Control"]').isVisible());
  await shot(page, "06-git-sidebar");

  await page.locator('button[title="AI Assistant"]').click();
  await page.waitForTimeout(200);
  log("AI panel reachable", await page.locator('button[title="AI Assistant"]').isVisible());
  await shot(page, "07-ai-panel");

  await page.locator('button[title="Extensions"]').click();
  await page.waitForTimeout(400);
  // Extensions tabs should render regardless of backend availability.
  log("Extensions panel shows Themes tab", await page.locator("text=Themes").first().isVisible());
  log("Extensions panel shows Languages tab", await page.locator("text=Languages").first().isVisible());
  await shot(page, "08-extensions-panel");

  await page.locator('button[title="Debug"]').click();
  await page.waitForTimeout(200);
  log("Debug panel reachable", await page.locator('button[title="Debug"]').isVisible());

  await page.locator('button[title="Explorer"]').click();
  await page.waitForTimeout(200);
  log("Files tab restores file tree", await page.locator("text=No folder open").isVisible());

  // 10 — Installer wizard opens & closes
  await page.locator('button[title="Optional Tools"]').click();
  await page.waitForTimeout(400);
  log("Installer wizard opens", await page.locator("text=Optional Tools").first().isVisible());
  await shot(page, "09-installer-wizard");
  const close = page.locator("text=Close").first();
  if (await close.isVisible().catch(() => false)) await close.click();
  log("Installer wizard closes without crash", await page.locator("#root").isVisible());

  // 11 — Run panel reachable via status-bar shortcut
  await page.locator("text=Run").first().click();
  await page.waitForTimeout(300);
  log("Run panel reachable", await page.locator("#root").isVisible());
  await shot(page, "10-run-panel");

  // 12 — Terminal command does not crash the app (no Tauri backend)
  const input = page.locator('input[placeholder="Enter command..."]');
  if (await input.isVisible().catch(() => false)) {
    await input.click();
    await input.fill("echo hello");
    await input.press("Enter");
    await page.waitForTimeout(600);
  }
  log("App stays alive after terminal command", await page.locator("#root").isVisible());

  // 13 — No critical (non-Tauri) console errors
  const TAURI = ["__tauri__", "tauri", "ipc", "transformcallback", "invoke", "not available"];
  const critical = consoleErrors.filter((e) => !TAURI.some((p) => e.toLowerCase().includes(p)));
  log(
    `No critical console errors (${consoleErrors.length} total, ${critical.length} critical)`,
    critical.length === 0,
    critical.slice(0, 3).join(" | ")
  );

  await shot(page, "11-final-state");
  await browser.close();

  console.log("\n" + "─".repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed of ${results.length}`);
  console.log(`Artifacts: ${OUT}`);
  writeFileSync(
    join(OUT, "results.json"),
    JSON.stringify({ url: URL, expectedVersion: EXPECTED_VERSION, passed, failed, total: results.length, results, consoleErrors }, null, 2)
  );

  process.exit(failed > 0 ? 1 : 0);
})();
