// Headless end-to-end checks of the terminal panel (xterm + TerminalPanel + ptySessions) against
// a fake PTY backend (index.html). Run from the repo root: node scripts/term-check/run.mjs
// The PTY layer itself (real shells, process trees) is covered by `cargo test pty`.
import { createServer } from "vite";
import { chromium } from "playwright";

const server = await createServer({ configFile: "vite.config.ts", logLevel: "error", server: { port: 1431, strictPort: true } });
await server.listen();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:1431" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const results = [];
async function check(name, fn) {
  try {
    const note = await fn();
    results.push([name, "PASS", note ?? ""]);
  } catch (e) {
    results.push([name, "FAIL", String(e.message ?? e).split("\n")[0]]);
  }
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}
const calls = (cmd) => page.evaluate((c) => window.calls.filter(([x]) => x === c).map(([, a]) => a), cmd);
const clearCalls = () => page.evaluate(() => (window.calls.length = 0));
const pane = (i = 0) => page.locator('[data-testid="terminal-pane"]').nth(i);
const screenText = (i = 0) => pane(i).locator(".xterm-rows").innerText();
async function waitText(needle, i = 0, timeout = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await screenText(i)).includes(needle)) return Date.now() - t0;
    await page.waitForTimeout(25);
  }
  throw new Error(`no "${needle}" on screen: ${(await screenText(i)).slice(-200)}`);
}
async function typeLine(text, i = 0) {
  await pane(i).locator(".xterm-screen").click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}
const scrollTop = (i = 0) => pane(i).locator(".xterm-viewport").evaluate((el) => el.scrollTop);
async function wheel(dy, { shift = false, i = 0 } = {}) {
  const b = await pane(i).locator(".xterm-screen").boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.wheel(0, dy);
  if (shift) await page.keyboard.up("Shift");
  await page.waitForTimeout(150);
}
const lastSpawn = () => page.evaluate(() => window.allCalls.filter(([c]) => c === "pty_spawn").at(-1)[1]);
/** The size the shell was last given (spawn or resize). */
const ptySize = () => page.evaluate(() => window.allCalls.filter(([c]) => c === "pty_spawn" || c === "pty_resize").at(-1)[1]);
const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

try {
  await page.goto("http://localhost:1431/scripts/term-check/index.html");
  await page.waitForSelector(".xterm-screen");
  await waitText("$ ");

  await check("spawn: starts in the workspace folder at the panel's real size", async () => {
    const s = await lastSpawn();
    ok(s.cwd === "/home/me/agent-proj", `cwd ${s.cwd}`);
    ok(s.cols > 80 && s.rows > 10, `${s.cols}x${s.rows}`);
    return `${s.cols}x${s.rows}`;
  });

  await check("reload: the old page's shells are killed before the first spawn", async () => {
    const order = await page.evaluate(() => window.calls.map(([c]) => c).filter((c) => c === "pty_reset" || c === "pty_spawn"));
    ok(order[0] === "pty_reset", order.join(","));
  });

  await check("input: typed text echoes, Enter runs the line", async () => {
    await typeLine("echo hello-fahh");
    await waitText("\nhello-fahh");
  });

  await check("input: unicode", async () => {
    await typeLine("echo héllo ✓ 日本");
    await waitText("héllo ✓ 日本");
  });

  await check("input: Ctrl+C with no selection interrupts (sends ^C)", async () => {
    await clearCalls();
    await pane().locator(".xterm-screen").click();
    await page.keyboard.press("Control+c");
    await page.waitForTimeout(100);
    ok((await calls("pty_write")).some((a) => a.data === "\x03"), "no \\x03 sent");
  });

  await check("paste: multi-line text with Ctrl+Shift+V (and Ctrl+V)", async () => {
    await page.evaluate(() => navigator.clipboard.writeText("echo p1\necho p2\n"));
    await clearCalls();
    await page.keyboard.press("Control+Shift+v");
    await waitText("\np2");
    const sent = (await calls("pty_write")).map((a) => a.data).join("");
    ok(sent.includes("echo p1\recho p2\r"), JSON.stringify(sent));
    // Windows: plain Ctrl+V pastes as well (elsewhere it stays the shell's literal-next, ^V)
    await page.evaluate(() => Object.defineProperty(navigator, "platform", { get: () => "Win32" }));
    await clearCalls();
    await page.keyboard.press("Control+v");
    await page.waitForTimeout(200);
    const sent2 = (await calls("pty_write")).map((a) => a.data).join("");
    ok(sent2.includes("echo p1\recho p2\r") && !sent2.includes("\x16"), JSON.stringify(sent2));
  });

  await check("output: 10k lines arrive and render promptly", async () => {
    const t0 = Date.now();
    await typeLine("seq 10000");
    await waitText("\n10000\n", 0, 5000);
    const ms = Date.now() - t0;
    ok(ms < 3000, `${ms} ms`);
    return `${ms} ms`;
  });

  await check("output: a very long line wraps", async () => {
    const cols = (await ptySize()).cols;
    await typeLine("long 500");
    await waitText("xxxxxxxxxx");
    const rows = (await screenText()).split("\n").filter((l) => /^x{10,}$/.test(l.trim()));
    ok(rows.length >= Math.floor(500 / cols), `${rows.length} rows of x at ${cols} cols`);
    return `${rows.length} rows`;
  });

  await check("scroll: mouse wheel scrolls the scrollback (normal buffer)", async () => {
    await typeLine("seq 300");
    await waitText("\n300\n");
    const before = await scrollTop();
    await wheel(-500);
    const after = await scrollTop();
    ok(after < before, `${before} -> ${after}`);
    return `${before} -> ${after}`;
  });

  await check("scroll: Shift+wheel scrolls the scrollback", async () => {
    const before = await scrollTop();
    await wheel(-500, { shift: true });
    const after = await scrollTop();
    ok(after < before, `${before} -> ${after}`);
  });

  await check("scroll: Shift+PageUp / Shift+PageDown", async () => {
    await pane().locator(".xterm-screen").click();
    await page.keyboard.press("End"); // typing scrolls to the bottom
    await typeLine("echo bottom");
    await waitText("bottom");
    const before = await scrollTop();
    await page.keyboard.press("Shift+PageUp");
    await page.waitForTimeout(150);
    const up = await scrollTop();
    await page.keyboard.press("Shift+PageDown");
    await page.waitForTimeout(150);
    const down = await scrollTop();
    ok(up < before && down > up, `${before} -> ${up} -> ${down}`);
  });

  await check("scroll: scrollbar is there (viewport overflow-y: scroll, styled thumb)", async () => {
    const v = await pane().locator(".xterm-viewport").evaluate((el) => ({ oy: getComputedStyle(el).overflowY, sh: el.scrollHeight, ch: el.clientHeight }));
    ok(v.oy === "scroll" && v.sh > v.ch, JSON.stringify(v));
  });

  await check("scroll: an app with mouse mode gets the wheel; Shift+wheel still scrolls", async () => {
    await typeLine("mouse");
    await page.waitForTimeout(100);
    await clearCalls();
    const before = await scrollTop();
    await wheel(-300);
    const reports = (await calls("pty_write")).filter((a) => a.data.startsWith("\x1b[<6"));
    ok(reports.length > 0, "no SGR wheel report sent");
    ok((await scrollTop()) === before, "the scrollback moved too");
    await wheel(-300, { shift: true });
    ok((await scrollTop()) < before, "Shift+wheel did not scroll");
    await typeLine("nomouse");
  });

  await check("scroll: alt-buffer app (vim/less) gets arrow keys for the wheel", async () => {
    await typeLine("alt");
    await waitText("ALT SCREEN");
    await clearCalls();
    await wheel(-200);
    const keys = (await calls("pty_write")).map((a) => a.data).join("");
    ok(/\x1b(\[|O)A/.test(keys), JSON.stringify(keys));
    await typeLine("noalt");
    await waitText("bottom");
  });

  await check("resize: a container resize fits and sends one debounced pty_resize", async () => {
    await clearCalls();
    for (const [w, h] of [[800, 400], [700, 450], [640, 500]]) {
      await page.evaluate(([w, h]) => Object.assign(document.getElementById("box").style, { width: `${w}px`, height: `${h}px` }), [w, h]);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(300);
    const s = await lastSpawn();
    const r = await calls("pty_resize");
    ok(r.length === 1, `${r.length} calls: ${JSON.stringify(r)}`);
    ok(r[0].cols < s.cols && r[0].rows > s.rows, JSON.stringify(r[0]));
    return `${s.cols}x${s.rows} -> ${r[0].cols}x${r[0].rows}`;
  });

  await check("resize: maximise and restore (a big jump and back)", async () => {
    await clearCalls();
    await page.evaluate(() => Object.assign(document.getElementById("box").style, { width: "1180px", height: "780px" }));
    await page.waitForTimeout(300);
    await page.evaluate(() => Object.assign(document.getElementById("box").style, { width: "640px", height: "500px" }));
    await page.waitForTimeout(300);
    const r = await calls("pty_resize");
    ok(r.length === 2 && r[0].rows > r[1].rows, JSON.stringify(r));
  });

  await check("panel closed/moved while running: the shell lives on and the scrollback comes back", async () => {
    await clearCalls();
    await page.evaluate(() => window.unmount());
    await page.waitForTimeout(100);
    await page.evaluate(() => window.mount());
    await waitText("bottom");
    ok((await calls("pty_spawn")).length === 0, "spawned again");
    ok((await calls("pty_kill")).length === 0, "killed");
    ok((await calls("pty_resize")).length <= 1, "resize storm");
  });

  for (const zoom of [0.5, 1, 1.5]) {
    await check(`selection + copy (Ctrl+Shift+C and Ctrl+C) at canvas zoom ${zoom * 100}%`, async () => {
      await page.evaluate((z) => (document.getElementById("box").style.transform = `scale(${z})`), zoom);
      await typeLine("echo ABCDEFGHIJ");
      await waitText("\nABCDEFGHIJ");
      await page.waitForTimeout(150); // let the prompt's line feed render
      // where the text really is on screen (scaled): its row, and the width of its 10 cells
      const geo = await pane().evaluate((el) => {
        const row = [...el.querySelectorAll(".xterm-rows > div")].findLast((r) => r.textContent.trim() === "ABCDEFGHIJ");
        const range = document.createRange();
        range.selectNodeContents(row);
        const t = range.getBoundingClientRect();
        const r = row.getBoundingClientRect();
        return { y: r.top + r.height / 2, left: t.left, width: t.width };
      });
      const cw = geo.width / 10;
      await page.mouse.move(geo.left + cw * 0.2, geo.y);
      await page.mouse.down();
      await page.mouse.move(geo.left + cw * 2.5, geo.y, { steps: 3 });
      await page.mouse.move(geo.left + cw * 4.8, geo.y, { steps: 3 });
      await page.mouse.up();
      await page.evaluate(() => navigator.clipboard.writeText(""));
      await page.keyboard.press("Control+Shift+c");
      await page.waitForTimeout(100);
      const a = await clipboard();
      ok(a === "ABCDE", `Ctrl+Shift+C copied ${JSON.stringify(a)}`);
      await page.evaluate(() => navigator.clipboard.writeText(""));
      await clearCalls();
      await page.keyboard.press("Control+c");
      await page.waitForTimeout(100);
      ok((await clipboard()) === "ABCDE", "Ctrl+C with a selection did not copy");
      ok(!(await calls("pty_write")).some((x) => x.data === "\x03"), "Ctrl+C with a selection also interrupted");
      await page.evaluate(() => (document.getElementById("box").style.transform = ""));
    });
  }

  await check("right-click: the textarea moves under the pointer (native Copy/Paste menu)", async () => {
    const b = await pane().locator(".xterm-screen").boundingBox();
    await page.mouse.click(b.x + 200, b.y + 100, { button: "right" });
    const ta = await pane().locator("textarea.xterm-helper-textarea").boundingBox();
    ok(Math.abs(ta.x + 10 - (b.x + 200)) < 30 && Math.abs(ta.y + 10 - (b.y + 100)) < 30, JSON.stringify(ta));
  });

  await check("tabs: New Terminal adds and shows a second tab; clicking switches back", async () => {
    await clearCalls();
    await page.getByRole("button", { name: "New Terminal" }).click();
    await page.waitForTimeout(200);
    ok((await page.getByTestId("terminal-tab").count()) === 2, "not 2 tabs");
    ok((await calls("pty_spawn")).length === 1, "no spawn");
    await page.getByTestId("terminal-tab").first().click();
    await waitText("ABCDEFGHIJ");
  });

  await check("tabs: rename by double-click", async () => {
    await page.getByTestId("terminal-tab").first().dblclick();
    await page.getByLabel("Terminal name").fill("server");
    await page.keyboard.press("Enter");
    ok((await page.getByTestId("terminal-tab").first().innerText()).includes("server"), await page.getByTestId("terminal-tab").first().innerText());
  });

  await check("split: two labelled panes, one tab 'A, B', focused outline, both get a prompt", async () => {
    await clearCalls();
    await page.getByRole("button", { name: "Split Terminal" }).click();
    await page.waitForTimeout(300);
    ok((await page.getByTestId("terminal-pane").count()) === 2, "not 2 panes");
    const labels = await page.getByTestId("terminal-pane-label").allInnerTexts();
    ok(labels[0] === "server — agent-proj" && labels[1] === "PowerShell — agent-proj", JSON.stringify(labels));
    const tabs = await page.getByTestId("terminal-tab").allInnerTexts();
    ok(tabs.some((t) => t.includes("server, PowerShell")), JSON.stringify(tabs));
    ok((await pane(1).getAttribute("data-focused")) === "true", "right pane not marked focused");
    await waitText("$ ", 1);
    await pane(0).locator(".xterm-screen").click();
    ok((await pane(0).getAttribute("data-focused")) === "true", "clicking the left pane did not focus it");
  });

  await check("split: kill one pane with its X; the other stays", async () => {
    await clearCalls();
    await pane(1).getByRole("button", { name: /Kill terminal/ }).click();
    await page.waitForTimeout(150);
    ok((await page.getByTestId("terminal-pane").count()) === 1, "pane not removed");
    ok((await calls("pty_kill")).length === 1, "shell not killed");
  });

  await check("exit: `exit 3` keeps the tab and says 'Process exited (code 3)'", async () => {
    await page.getByTestId("terminal-tab").nth(1).click();
    await typeLine("exit 3");
    await waitText("Process exited (code 3)");
  });

  await check("exit: `exit` (code 0) closes the tab", async () => {
    await page.getByRole("button", { name: "New Terminal" }).click();
    await waitText("$ ");
    const n = await page.getByTestId("terminal-tab").count();
    await typeLine("exit");
    await page.waitForTimeout(200);
    ok((await page.getByTestId("terminal-tab").count()) === n - 1, "tab still there");
  });

  await check("kill: the trash kills every tab down to none; empty state offers New Terminal", async () => {
    await clearCalls();
    while ((await page.getByTestId("terminal-tab").count()) > 0) {
      await page.getByRole("button", { name: "Kill Terminal", exact: true }).click();
      await page.waitForTimeout(100);
    }
    ok(await page.getByTestId("terminal-empty").isVisible(), "no empty state");
    ok((await calls("pty_kill")).length >= 1, "no pty_kill");
    await page.getByTestId("terminal-empty").getByRole("button", { name: "New Terminal" }).click();
    await waitText("$ ");
  });

  await check("spawn failure: the tab says Couldn't start ...", async () => {
    await page.evaluate(() => window.termStore.getState().createSession("broken", "Broken"));
    await waitText("Couldn't start broken: Could not start nope.exe");
  });

  await check("no page errors", async () => ok(errors.length === 0, errors.join(" | ")));
} finally {
  await browser.close();
  await server.close();
}

const w = Math.max(...results.map((r) => r[0].length));
for (const [n, s, note] of results) console.log(`${s}  ${n.padEnd(w)}  ${note}`);
const failed = results.filter((r) => r[1] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
