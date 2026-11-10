// Headless check of the Source Control view: the whole app in Chromium with the Tauri
// bridge faked (a tiny in-memory git that answers the git_* commands), driven like a
// user: pick a repository, stage, commit with Ctrl+Enter, stage a hunk, resolve a
// conflict, switch branch from the status bar, initialise an empty folder.
//   node scripts/scm-check/run.mjs [screenshot-dir]
// The real git work is covered by the Rust tests in src-tauri/src/core/git.rs.
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const OUT = path.resolve(process.argv[2] ?? "scm-check-shots");
fs.mkdirSync(OUT, { recursive: true });

const bridge = () => {
  const ch = (p, status, staged = false) => ({ path: p, status, staged });
  const repos = {
    "/work/api": { branch: "main", upstream: "origin/main", staged: [], unstaged: [ch("src/app.ts", "modified"), ch("notes.md", "untracked")] },
    "/work/web": { branch: "dev", upstream: null, staged: [], unstaged: [ch("index.html", "conflicted")] },
  };
  const calls = (window.__calls = []);
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    transformCallback: () => next++,
    unregisterCallback() {},
    convertFileSrc: (p) => p,
    async invoke(cmd, args = {}) {
      if (cmd.startsWith("plugin:event|")) return next++;
      if (cmd.startsWith("git_")) calls.push({ cmd, ...args });
      const r = repos[args.path];
      switch (cmd) {
        case "git_repositories":
          return args.path === "/work"
            ? Object.entries(repos).map(([root, x]) => ({ root, name: root.split("/").pop(), branch: x.branch, changes: x.staged.length + x.unstaged.length }))
            : [];
        case "git_status":
          if (!r) return { is_repo: false, repo_root: "", branch: null, unborn: false, staged: [], unstaged: [], upstream: null, ahead: 0, behind: 0 };
          return { is_repo: true, repo_root: args.path + "/", branch: r.branch, unborn: false, staged: r.staged, unstaged: r.unstaged, upstream: r.upstream, ahead: 0, behind: 0 };
        case "git_current_branch":
          return r?.branch ?? null;
        case "git_stash_list":
          return [];
        case "git_stage": {
          const c = r.unstaged.find((x) => x.path === args.file);
          r.unstaged = r.unstaged.filter((x) => x !== c);
          r.staged.push({ ...c, status: c.status === "untracked" ? "added" : c.status, staged: true });
          return null;
        }
        case "git_commit":
          r.staged = [];
          return "abc1234def5678";
        case "git_diff":
          return "diff --git a/notes.md b/notes.md\n--- /dev/null\n+++ b/notes.md\n@@ -0,0 +1,2 @@\n+# Notes\n+todo\n";
        case "git_apply_hunk":
        case "git_init":
        case "git_checkout":
          return null;
        case "git_resolve_conflict":
          r.unstaged = r.unstaged.filter((x) => x.path !== args.file);
          r.staged.push(ch(args.file, "modified", true));
          return null;
        case "git_branches":
          return [
            { name: r.branch, remote: false, current: true, upstream: r.upstream },
            { name: "feature/login", remote: false, current: false, upstream: null },
            { name: "origin/release", remote: true, current: false, upstream: null },
          ];
        case "read_dir":
        case "read_directory":
          return { name: "work", path: "/work", is_dir: true, children: [] };
        default:
          throw `${cmd}: not available in this preview`;
      }
    },
  };
};

const server = await createServer({ configFile: "vite.config.ts", logLevel: "error", server: { port: 1434, strictPort: true } });
await server.listen();
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const lastCall = (page, cmd) => page.evaluate((c) => window.__calls.filter((x) => x.cmd === c).pop() ?? null, cmd);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => {
    const where = (e.stack ?? e.message).split("\n").slice(0, 3).join(" ");
    // xterm's Viewport throws when the hidden terminal panel resizes headless; not ours.
    if (!where.includes("@xterm")) errors.push(where);
  });
  await page.addInitScript(bridge);
  await page.addInitScript(() => {
    localStorage.setItem("fahh-onboarded", "1");
    localStorage.setItem("fahh-layout-mode", "editor");
    localStorage.setItem("fahh-skip-restore", "1");
  });
  await page.goto("http://localhost:1434/");
  await page.waitForSelector(".dockview-theme-fahh", { timeout: 60000 });
  await page.evaluate(async () => {
    (await import("/src/lib/workbench.ts")).revealView("git");
    const { useFileStore } = await import("/src/store/fileStore.ts");
    useFileStore.getState().setRoot("/work");
    useFileStore.getState().setTree({ name: "work", path: "/work", is_dir: true, children: [] });
  });
  const scm = page.getByTestId("git-sidebar");

  // 1. Repositories picker
  await page.getByTestId("git-repos").waitFor();
  const repoRows = await page.getByTestId("git-repos").getByRole("button").count();
  check("repositories picker lists both repos", repoRows === 2, `${repoRows} rows`);
  check("first repo selected, its changes shown", (await scm.getByTestId("git-change-row").count()) === 2);
  await page.screenshot({ path: path.join(OUT, "1-repos-and-changes.png") });

  // 2. Stage one file
  await scm.getByRole("button", { name: "Stage src/app.ts" }).click();
  await scm.getByText("Staged Changes").waitFor();
  const staged = await lastCall(page, "git_stage");
  check("stage goes to the selected repo", staged?.path === "/work/api" && staged?.file === "src/app.ts", JSON.stringify(staged));

  // 3. Commit with Ctrl+Enter
  await scm.getByTestId("git-commit-message").fill("feat: first");
  await scm.getByTestId("git-commit-message").press("Control+Enter");
  await scm.getByText("Committed abc1234").waitFor();
  const commit = await lastCall(page, "git_commit");
  check("Ctrl+Enter commits the message", commit?.message === "feat: first" && commit?.amend === false, JSON.stringify(commit));
  check("commit box cleared", (await scm.getByTestId("git-commit-message").inputValue()) === "");

  // 4. Hunk staging from the diff
  await scm.getByText("notes.md").click();
  await page.getByTestId("git-diff").getByRole("button", { name: "Stage" }).click();
  const hunk = await lastCall(page, "git_apply_hunk");
  check("hunk Stage applies hunk 0 of notes.md", hunk?.hunk === 0 && hunk?.file === "notes.md" && hunk?.discard === false, JSON.stringify(hunk));
  await page.screenshot({ path: path.join(OUT, "2-diff-hunks.png") });

  // 5. Switch repo, resolve a conflict
  await page.getByTestId("git-repos").getByRole("button", { name: /web/ }).click();
  await page.getByTestId("git-merge-group").waitFor();
  await page.screenshot({ path: path.join(OUT, "3-merge-conflict.png") });
  await page.getByTestId("git-merge-group").getByRole("button", { name: "Incoming" }).click();
  await page.getByTestId("git-merge-group").waitFor({ state: "detached" });
  const res = await lastCall(page, "git_resolve_conflict");
  check("Accept Incoming resolves in the web repo", res?.path === "/work/web" && res?.choice === "incoming", JSON.stringify(res));

  // 6. Branch picker from the status bar
  await page.getByTestId("status-git-branch").click();
  await page.getByRole("dialog", { name: "Branches" }).waitFor();
  await page.getByRole("option", { name: /feature\/login/ }).waitFor();
  await page.screenshot({ path: path.join(OUT, "4-branch-picker.png") });
  const search = page.getByRole("dialog", { name: "Branches" }).getByRole("combobox");
  await search.fill("feature/lo");
  await search.press("Enter");
  await page.waitForFunction(() => window.__calls.some((c) => c.cmd === "git_checkout"));
  const co = await lastCall(page, "git_checkout");
  check("picking a branch checks it out", co?.branch === "feature/login" && co?.path === "/work/web", JSON.stringify(co));
  check("status bar offers Publish for a branch with no upstream", (await page.getByTestId("status-git-sync").getAttribute("title")) === "Publish Branch");

  // 7. A folder that is not a repository
  await page.evaluate(async () => (await import("/src/store/fileStore.ts")).useFileStore.getState().setRoot("/empty"));
  await page.getByTestId("git-empty").waitFor();
  await page.screenshot({ path: path.join(OUT, "5-not-a-repo.png") });
  await page.getByRole("button", { name: "Initialise repository" }).click();
  await page.waitForFunction(() => window.__calls.some((c) => c.cmd === "git_init"));
  check("Initialise calls git_init on the open folder", (await lastCall(page, "git_init"))?.path === "/empty");

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("run", false, e.message);
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} checks passed; screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
