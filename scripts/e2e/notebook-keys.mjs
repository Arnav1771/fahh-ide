// Real-app check: notebook command-mode keys act on the selected cell, also while a cell runs.
// Start the installed app with CDP on a folder you can write to, then:
//   set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333 & "Fahh Editor\fahh-editor.exe" C:\some\folder
//   node scripts/e2e/notebook-keys.mjs C:\some\folder
// Needs a Python with ipykernel for the folder (the first cell sleeps so the keys land mid-run).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: node scripts/e2e/notebook-keys.mjs <folder open in Fahh>");
const file = path.join(dir, "nb-keys.ipynb");
const code = (src) => ({ cell_type: "code", id: Math.random().toString(16).slice(2, 10), metadata: {}, execution_count: null, outputs: [], source: [src] });
fs.writeFileSync(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { name: "python3", display_name: "Python 3", language: "python" } }, cells: [{ cell_type: "markdown", id: "k0", metadata: {}, source: ["# keys"] }, code("import time\ntime.sleep(8)"), code("x = 1")] }, null, 1));
const cells = () => JSON.parse(fs.readFileSync(file, "utf8")).cells.map((c) => c.cell_type[0] + ":" + [].concat(c.source).join("").split("\n")[0]);

const browser = await chromium.connectOverCDP(process.env.FAHH_CDP || "http://127.0.0.1:9333");
const page = browser.contexts()[0].pages()[0];
const wait = (ms) => page.waitForTimeout(ms);
const until = async (fn, ms = 6000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(300)) if (fn()) return true; return false; };
let failed = 0;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -- ${cells().join(" | ")}`); if (!ok) failed++; };

await page.keyboard.press("Escape");
await page.keyboard.press("Control+p"); await wait(400); await page.keyboard.type("nb-keys.ipynb"); await wait(600); await page.keyboard.press("Enter");
const cell = (i) => page.getByTestId("nb-cell").nth(i);
await cell(2).waitFor({ timeout: 20000 }); await wait(1500);
const select = async (i) => { await cell(i).getByText(/^In \[/).click(); await wait(200); }; // the In [ ] label, not the Run button next to it

await cell(1).hover(); await cell(1).getByRole("button", { name: "Run this cell" }).click(); // sleeps: the keys below land while it runs
await select(2);
await page.keyboard.press("b");
check("B adds a code cell below the selected cell, while a cell runs", await until(() => cells().join() === "m:# keys,c:import time,c:x = 1,c:"));
await page.keyboard.press("Alt+ArrowUp");
check("Alt+Up moves the selected (new) cell up", await until(() => cells().join() === "m:# keys,c:import time,c:,c:x = 1"));
await page.keyboard.press("m");
check("M turns the selected cell into markdown", await until(() => cells()[2] === "m:"));
await page.keyboard.press("a");
check("A adds a code cell above it", await until(() => cells().join() === "m:# keys,c:import time,c:,m:,c:x = 1"));
await page.keyboard.press("Alt+ArrowDown");
check("Alt+Down moves the selected (new) cell down", await until(() => cells().join() === "m:# keys,c:import time,m:,c:,c:x = 1"));
await page.keyboard.press("y");
check("Y on a code cell leaves it code", await until(() => cells()[3] === "c:"));
fs.rmSync(file, { force: true });
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
