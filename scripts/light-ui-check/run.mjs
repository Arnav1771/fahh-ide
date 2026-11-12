// Headless check of light-theme popovers and the Settings editor controls (the views dropdown,
// the Font family picker, the Word wrap checkbox) in a light and a dark theme, against a fake
// Tauri bridge (like scripts/scm-check). Run from the repo root:
//   node scripts/light-ui-check/run.mjs [screenshot-dir]
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const OUT = path.resolve(process.argv[2] ?? "light-ui-check-shots");
const PORT = Number(process.env.PORT ?? 1437);
fs.mkdirSync(OUT, { recursive: true });

function mock(theme) {
  localStorage.setItem("fahh-theme", theme);
  localStorage.setItem("fahh-onboarded", "1");
  localStorage.setItem("fahh-skip-restore", "1");
  localStorage.removeItem("fahh-layout-mode");
  let n = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    transformCallback: () => n++,
    unregisterCallback() {},
    convertFileSrc: (p) => p,
    async invoke(cmd) {
      if (cmd.startsWith("plugin:")) return null;
      throw `${cmd}: not available in this preview`;
    },
  };
}

const server = await createServer({ configFile: "vite.config.ts", logLevel: "error", server: { port: PORT, strictPort: true } });
await server.listen();
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
// Background colour of an element, and the page's own background, as rgb() strings.
const bgOf = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    return el && { el: getComputedStyle(el).backgroundColor, page: getComputedStyle(document.body).backgroundColor, scheme: getComputedStyle(el).colorScheme };
  }, sel);

try {
  for (const theme of ["fahh-light", "fahh-dark"]) {
    const light = theme === "fahh-light";
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(mock, theme);
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/`, { timeout: 180000 });
    await page.waitForSelector(".dockview-theme-fahh", { timeout: 120000 });
    await page.waitForTimeout(1500);

    // 1. The side bar's views dropdown (dockview's tab overflow list)
    await page.locator(".dv-tabs-overflow-dropdown-default").first().click();
    await page.locator(".dv-tabs-overflow-container").waitFor();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, `${theme}-views-dropdown.png`) });
    const dd = await bgOf(page, ".dv-tabs-overflow-container");
    check(`${theme}: views dropdown uses the theme background`, dd?.el === dd?.page, JSON.stringify(dd));
    const gap = await page.evaluate(() => getComputedStyle(document.querySelector(".dv-tabs-overflow-container .dv-default-tab")).columnGap);
    check(`${theme}: dropdown icons have a gap before the label`, gap !== "normal" && parseFloat(gap) > 0, gap);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // 2. Settings: Word wrap checkbox, Font family picker
    await page.keyboard.press("Control+,");
    await page.locator("#set-wrap").waitFor({ timeout: 15000 });
    await page.locator("#set-wrap").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${theme}-settings.png`) });
    const cb = await bgOf(page, "#set-wrap");
    check(`${theme}: checkbox drawn ${light ? "light" : "dark"}`, cb?.scheme === (light ? "light" : "dark"), JSON.stringify(cb));
    const picker = page.getByTestId("font-picker");
    if (await picker.count()) {
      await picker.click();
      await page.getByRole("menuitem", { name: /^Fira Code/ }).waitFor();
      await page.screenshot({ path: path.join(OUT, `${theme}-font-picker.png`) });
      const fonts = await page.$$eval("[role=menu] [role=menuitem] span.flex-1", (els) => els.map((e) => e.style.fontFamily).filter(Boolean).length);
      check(`${theme}: font names drawn in their own font`, fonts >= 10, `${fonts} styled`);
      await page.getByRole("menuitem", { name: /^Fira Code/ }).click();
      const stored = await page.evaluate(async () => (await import("/src/store/settingsStore.ts")).useSettingsStore.getState().fontFamily);
      check(`${theme}: picking Fira Code stores a CSS list`, stored === "Fira Code, monospace", stored);
      await picker.click();
      await page.getByRole("menuitem", { name: /Custom/ }).click();
      await page.getByLabel("Custom font list").fill("Iosevka, Consolas, monospace");
      const custom = await page.evaluate(async () => (await import("/src/store/settingsStore.ts")).useSettingsStore.getState().fontFamily);
      check(`${theme}: Custom… keeps a typed list`, custom === "Iosevka, Consolas, monospace", custom);
      await page.screenshot({ path: path.join(OUT, `${theme}-font-custom.png`) });
    }
    await ctx.close();
  }
} catch (e) {
  check("run", false, String(e.message ?? e).split("\n")[0]);
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} checks passed; screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
