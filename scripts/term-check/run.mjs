// Headless check of the docked terminal: wheel scrolls the scrollback, Shift+wheel too, and a
// panel resize reaches the shell (pty_resize). Run: node scripts/term-check/run.mjs
import { createServer } from "vite";
import { chromium } from "playwright";
import assert from "node:assert/strict";

const server = await createServer({ configFile: "vite.config.ts", server: { port: 1431, strictPort: true } });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  await page.goto("http://localhost:1431/scripts/term-check/index.html");
  await page.waitForFunction(() => document.querySelector(".xterm-rows")?.textContent?.includes("line 500"), null, { timeout: 30000 });
  const spawn = await page.evaluate(() => window.calls.find(([c]) => c === "pty_spawn")[1]);
  console.log("spawned at", spawn.cols, "x", spawn.rows);
  assert.ok(spawn.cols > 50 && spawn.rows > 5, "spawned at the panel's size");

  const top = () => page.evaluate(() => document.querySelector(".xterm-viewport").scrollTop);
  const bottom = await top();
  const box = await page.locator(".xterm-screen").boundingBox();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(300);
  const afterWheel = await top();
  console.log("scrollTop", bottom, "-> wheel up ->", afterWheel);
  assert.ok(afterWheel < bottom, "wheel scrolled the scrollback");

  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, -600);
  await page.keyboard.up("Shift");
  await page.waitForTimeout(300);
  const afterShift = await top();
  console.log("-> Shift+wheel up ->", afterShift);
  assert.ok(afterShift < afterWheel, "Shift+wheel scrolled the scrollback");

  await page.evaluate(() => (document.getElementById("box").style.cssText = "width:600px;height:500px;display:flex"));
  await page.waitForTimeout(500);
  const resizes = await page.evaluate(() => window.calls.filter(([c]) => c === "pty_resize").map(([, a]) => a));
  console.log("pty_resize calls", JSON.stringify(resizes));
  const last = resizes.at(-1);
  assert.ok(last && last.cols < spawn.cols && last.rows > spawn.rows, "resize reached the shell with the new size");
  console.log("OK");
} finally {
  await browser.close();
  await server.close();
}
