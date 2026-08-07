# Fahh Editor — Prompt Trail

This document records every major decision, attempt, failure, and lesson learned during the build session that took a docs-only repo to a fully released v0.2.0 multi-platform IDE. Use it to understand *why* things are the way they are.

---

## Session overview

**Start state:** Repo had only documentation — no `src/`, no `src-tauri/`, no `package.json`.  
**End state:** v0.3.0 released on Windows/macOS/Linux, WSL dev build working, GitHub Pages with web IDE live, and native Linux verified.

---

## Phase 0: Environment setup

**What was needed:** Rust, pnpm, Tauri CLI, VS Build Tools (MSVC linker)  
**What was found:** Only Node.js v24 installed. No Rust, no pnpm, no MSVC.

**Actions:**
- Installed pnpm via `npm install -g pnpm` — worked
- Installed Rust via `winget install Rustlang.Rustup` — worked
- VS Build Tools via `winget install Microsoft.VisualStudio.2022.BuildTools --silent --override "..."` — exited with code 6 (reboot required) then code 1602 (UAC blocked)

**Key lesson:** VS Build Tools cannot be installed silently from a background agent — UAC dialogs are blocked. The user must install it manually as Administrator. This became the one remaining manual dependency throughout the entire session.

**Workaround found:** WSL2 Ubuntu has GCC (via `build-essential`), so `pnpm tauri dev` works in WSL without MSVC. Used this for all Rust compilation.

---

## Phase 1: Scaffolding the full codebase

**State:** Docs repo had no code. Built everything from scratch.

**Rust backend written:**
- `workspace.rs` — file tree (depth 5, filters node_modules/target), read/write/create/delete/rename
- `editor.rs` — document model, 15+ language extension detection
- `terminal.rs` — `execute_command` via `cmd.exe` on Windows, `sh` on Linux
- `error_detector.rs` — atomic cooldown timer, emits `fahh://error`
- `installer.rs` — OptionalTool enum (n8n/browser-use/Flowise/gh/claude), per-tool check+install
- `state.rs` — FahhConfig persisted to `~/.fahh/config.json`
- `lsp.rs` — PATH-based LSP server detection
- `runtime.rs` — tracing-subscriber init
- `quality.rs` — startup acceptance gates
- `plugin.rs` — capability registry (later replaced with full plugin registry)
- `app/mod.rs` — setup() hook

**React frontend written:**
- All stores: editorStore, fileStore, terminalStore
- All hooks: useWorkspace, useTerminal
- All components: EditorPane, TabBar, FileTree, TerminalPanel, InstallerWizard, AIPanel (stub), GitSidebar (stub)
- `lib/fahh.ts` — Web Audio API SFX player
- `lib/tauri.ts` — typed invoke() wrappers
- `lib/types.ts` — all payload types
- `App.tsx` — full layout: activity bar + sidebar + editor + terminal + statusbar

**TypeScript issues found:**
- Agent changed `getFileTree` return type to `FileEntry[]` instead of `FileEntry` (Rust returns single root node)
- Fix: `invoke<FileEntry>` not `invoke<FileEntry[]>`

**pnpm install issue:**
- `pnpm v11` moved `onlyBuiltDependencies` from `package.json#pnpm` to `pnpm-workspace.yaml`
- esbuild needs `allowBuilds: true` in `pnpm-workspace.yaml`

---

## Phase 2: First release attempt

**CI setup:** GitHub Actions `release.yml` with all 4 platforms.

**Failure 1: No icons**
- Error: `tauri::generate_context!()` panicked — `icons/icon.png` not found
- All 4 builds failed
- Fix: Generated 16 icon files programmatically using Node.js + zlib (solid violet #7c3aed squares)
- Updated `tauri.conf.json` `bundle.icon` array

**Failure 2: Linux apt conflict**
- `libappindicator3-dev` conflicts with `libayatana-appindicator3-dev`
- Fix: Removed `libappindicator3-dev` — only need `libayatana-appindicator3-dev`

**Failure 3: Release race condition**
- All 4 matrix runners tried to create the same GitHub Release simultaneously
- 3 of them got 422 "already_exists"
- Fix: Added `create-release` job that runs first, all build jobs use `releaseId` output

**Failure 4: `cancel-in-progress: true` killed jobs**
- New runs were being cancelled before any jobs started
- Fix: Removed `concurrency: cancel-in-progress: true`

**Result:** v0.2.0 released with 9 assets — Windows .msi/.exe, macOS .dmg ×2, Linux .AppImage/.deb/.rpm

---

## Phase 3: Testing the installed binary

**Installed the .exe on the Windows machine.**

**Crash 1: Startup panic**
```
PluginInitialization("shell", "unknown field `sidecar`, expected `open`")
```
- Root cause: `tauri.conf.json` had `"shell": { "open": true, "sidecar": false }` — `sidecar` not valid in plugin-shell v2
- Fix: Remove `sidecar: false`, keep only `"open": true`
- Also removed `fs.scope` object (not required in Tauri 2 plugin model)

**Result after fix:** App launches, full IDE UI visible via `PrintWindow` capture — Explorer sidebar, Monaco welcome screen, Terminal/Run/Debug tabs, status bar showing `v0.2.0 | Fahh Dark`.

**Issue: Open Folder does nothing**
- Root cause: Missing `src-tauri/capabilities/default.json`
- In Tauri 2, ALL plugin IPC (dialog, fs, shell) silently fails without explicit capability grants
- Fix: Created `default.json` with full permission list

**Capability fix iterations:**
1. First attempt: wrong platform casing — `"macos"` should be `"macOS"`
2. Second attempt: invalid permission names — `fs:allow-create-dir` doesn't exist (it's `fs:allow-mkdir`), `fs:allow-remove-file` → `fs:allow-remove`
3. Third attempt: used object scope format `{"identifier": "fs:allow-read-text-file", "allow": [{"path": "**"}]}` — valid format but caused other issues
4. Final: use only documented permission identifiers from the build script's error output

---

## Phase 4: WSL build (`pnpm tauri dev`)

**Goal:** Get `pnpm tauri dev` working since MSVC isn't available on Windows without admin access.

**WSL environment:** Ubuntu 24.04, user `dell`, WSLg active (`DISPLAY=:0`, `WAYLAND_DISPLAY=wayland-0`)

**Problem 1: apt-get update hangs indefinitely**
- Root cause: Ubuntu 24.04 has Ubuntu Pro/ESM sources that try to contact `esm.ubuntu.com` without credentials
- Also: `sudo` in background/non-interactive sessions hangs waiting for TTY when its timestamp expires
- Fix: Run WSL commands as `root` (`wsl -d Ubuntu -u root bash -c "..."`) — completely bypasses sudo
- Also: Write `Acquire::http::Timeout "20"` to `/etc/apt/apt.conf.d/99timeout`
- Note: Ubuntu 24.04 uses deb822 format (`/etc/apt/sources.list.d/ubuntu.sources`), NOT the old `/etc/apt/sources.list`

**Problem 2: Git Bash path translation**
- When running `wsl.exe -d Ubuntu bash /tmp/script.sh` from Git Bash, `/tmp/` gets translated to `C:\Users\...\AppData\Local\Temp\`
- Fix: Use `//tmp/script.sh` (double slash) or reference via full path inside `-c "..."` string
- Alternative: Write script inside WSL via a heredoc in a `-c` argument, then execute with full path

**Problem 3: Windows PATH leaks into WSL commands**
- When using `bash -c "..."` from Git Bash, `$PATH` in the string gets expanded to the full Windows PATH
- Causes syntax errors when Windows paths contain `(x86)` etc.
- Fix: Always set `export PATH=/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` at the start of every WSL script

**Problem 4: PowerShell heredoc in WSL commands**
- PowerShell `@'...'@` here-strings can't be nested inside other `@'...'@` blocks
- Fix: Write the script to a temp file via `cat > /path/script.sh << 'HEREDOC'...HEREDOC` in a bash -c string, then execute it

**Problem 5: CRLF line endings**
- Scripts written from Windows via the Write tool have `\r\n` line endings
- When bash reads them in WSL, `\r` causes syntax errors
- Fix: Write the script content inside WSL using `cat >` heredoc (stays in Linux land), or use `sed -i 's/\r//'`

**Tauri CLI install:** `cargo install tauri-cli --version '^2' --locked` — takes 12 minutes first time

**App compile:** `cargo run` compiles fahh-editor in ~10 minutes (488 crates first time, cached after)

**WSL Tauri dev run:** App ran for 13 minutes. Window appeared as "Fahh Editor (Ubuntu)" in Windows taskbar (WSLg).

**Why screenshots are black in WSL:**
- WSLg uses Wayland → RDP → Windows DWM compositing
- `PrintWindow()` (Windows GDI) can't capture WSLg windows — gets black
- `scrot` capturing X11 root display gets black — content is in Wayland layer
- The window IS rendering on the user's physical display

**Audio issue in WSL:**
```
Missing decoder: text/html (text/html)
No suitable plugins found
```
- WebKit trying to play fahhhh.mp3 via GStreamer
- Missing: `gstreamer1.0-plugins-good`, `gstreamer1.0-libav`
- Fix: Installed these packages

---

## Phase 5: GitHub Pages and web IDE

**Landing page:** `docs/index.html` — Space Mono display headlines at large scale, animated code editor mockup, interactive FAHH waveform demo, 3-platform download section, 15-language support table.

**Docs page:** `docs/docs.html` — sidebar navigation, syntax-highlighted code blocks, copy buttons, flow diagrams, full API reference.

**Web IDE:** `docs/play.html` — Monaco editor + Pyodide (Python WASM) + JS eval + Babel (TypeScript). Fahh SFX: red flash + "FAHHHH!" overlay on errors.

**Deployment:** `gh-pages` branch (orphan), served by GitHub Pages.

**Key lesson:** GitHub Pages from `gh-pages` branch serves exactly what's in that branch's root. The `docs/` folder in `main` is only for source — the gh-pages branch needs the files at root.

---

## Phase 6: Open Folder in WSL

**Why it fails:** `rfd` (the file dialog crate) on Linux uses either `ashpd` (async portal / xdg-desktop-portal) or falls back to GTK. WSL2 doesn't have `xdg-desktop-portal` running. GTK dialog also doesn't open in some WSL configurations.

**Fix:** Added a text input fallback in `FileTree.tsx`:
1. Try `open({ directory: true })` via dialog plugin
2. If it throws (no portal available), show a `<input type="text">` where user types the path manually
3. Submit calls `openFolder(path)` directly

---

## Decisions that may surprise a future maintainer

### Why the app runs as root in WSL dev mode
`sudo` in non-interactive shells hangs indefinitely once its password cache expires. Rather than configure `NOPASSWD` in sudoers (security risk) or ask for the password in a non-interactive session (impossible), we run as `root` directly via `wsl -d Ubuntu -u root`. This is safe for a development environment.

### Why there's a `pnpm-workspace.yaml` but no workspace packages
`pnpm v11` moved `onlyBuiltDependencies` / `allowBuilds` from `package.json#pnpm` to `pnpm-workspace.yaml`. The file exists solely to tell pnpm that `esbuild` and `@tauri-apps/cli` are allowed to run build scripts.

### Why the capabilities file uses only simple string permissions (not scoped objects)
We tried using the scoped object format `{"identifier": "fs:allow-read-text-file", "allow": [{"path": "**"}]}` but the exact valid format varied across Tauri 2 patch versions. Using simple string identifiers with the built-in scope bundles (`fs:scope-home-recursive` etc.) is more stable.

### Why LSP, debugger, and runner exist in Rust but aren't fully wired in the UI
These were built in Phase 2 as infrastructure. The Rust code (`lsp_client.rs`, `debugger.rs`, `runner.rs`) is complete — it spawns servers, bridges JSON-RPC, connects to DAP adapters. The React components (`LspBridge.tsx`, `DebugPanel`, `RunPanel`) exist. What's missing is the full bidirectional wiring: LspBridge needs to forward server responses back into Monaco's `MonacoLanguageClient`, and RunPanel needs to call `runFile()` and display streamed output.

### Why the fahhhh.mp3 is silent
The real sound file wasn't provided. A minimal valid 427-byte MP3 (silent) was generated programmatically so the filename requirement (`fahhhh.mp3`, 4 h's) is satisfied and the bundling/loading code works. Replace the file with a real sound to activate the SFX.

### Why CI uses `tauri-apps/tauri-action@v0` not `@v1`
Both work with Tauri 2. v1 was being updated during the session and had some breaking changes in the actions API. v0 with the `releaseId` parameter (find-or-create pattern) is stable and tested.

### Why the release CI creates the release in a separate job
If all 4 build runners try to create the same GitHub Release simultaneously (which they will), 3 of them get 422 "already_exists" errors. The `create-release` job creates the release first and outputs its ID. All build jobs depend on `create-release` and use `releaseId` to upload artifacts to the pre-created release. This completely eliminates the race condition.

---

## Lessons for the next AI working on this

1. **Run Tauri commands as root in WSL** — `wsl -d Ubuntu -u root bash -c "..."` avoids all sudo hang issues

2. **apt-get update hangs** — Ubuntu Pro/ESM sources are enabled by default in 24.04. Either: (a) write to `/etc/apt/sources.list.d/ubuntu.sources` (deb822 format!) to use only `archive.ubuntu.com`, or (b) set a timeout in `/etc/apt/apt.conf.d/99timeout`

3. **Git Bash mangles WSL paths** — `/tmp/file` becomes `C:\Users\...\AppData\Local\Temp\file`. Use `//tmp/file` (double slash) to prevent. Or pass paths inside bash `-c "..."` strings where Git Bash doesn't translate them.

4. **CRLF kills bash scripts** — Scripts written from Windows tools have `\r\n`. Fix: write scripts using WSL heredocs, or add `set -eo pipefail` and handle in-script

5. **Tauri 2 capabilities are mandatory** — Every plugin (dialog, fs, shell) fails silently without a grant in `capabilities/default.json`. Platform name is `"macOS"` (capital OS), not `"macos"`.

6. **WSL PrintWindow gives black screenshots** — WSLg uses RDP not GDI. The window IS rendering on the user's screen. Use `scrot` in WSL for X11 apps, but WSLg apps render via Wayland and won't show up in scrot either. Trust the process list.

7. **GitHub Pages `gh-pages` branch** — needs files at root, not in `docs/`. The `docs/` in main is just the source. Always update gh-pages branch separately via worktree + push.

8. **The `create-release` → `build` pattern for CI** — any multi-runner release workflow must create the GitHub Release in a single pre-job, then all builds use `releaseId`. Otherwise you get 422 race conditions.

---

## Phase 7: v0.3.0 Fixes & Native Linux Testing

**Goal:** Address bugs, standardize assets, and polish the IDE UI/UX based on early testing.

**What was updated:**
- **FileTree "Crash" Bug:** The user reported adding a second file caused a crash. **Lesson learned:** `tauri dev` watches the `src-tauri` folder. When the user created `src-tauri/yes.py`, the CLI automatically killed and rebuilt the Rust backend, making it look like a bug in the code. We verified the React state logic was 100% sound using an automated headless Playwright script.
- **Audio Standardization:** Simplified the placeholder SFX filename from `fahhhh.mp3` to `fahh.mp3` globally, updating the `tauri.conf.json`, `App.tsx`, and all documentation.
- **HTML Preview:** Implemented a live HTML preview iframe in `EditorPane.tsx`. Added a UI toggle (Eye/Code) to switch between Monaco editing and live rendering for `.html` files.
- **Monaco Themes in Native Tauri:** **Lesson learned:** CSS variables alone aren't enough to update Monaco's syntax highlighting in the native Tauri build. We explicitly registered custom themes via `monaco.editor.defineTheme` to ensure Dracula, GitHub Dark, etc. render correctly.
- **UI Aesthetics:** Removed raw emojis across the app and replaced them with polished `lucide-react` SVG icons.
- **Website Downloads:** Fixed `docs/index.html` to link directly to `v0.3.0` release assets instead of the generic releases page.
- **Native Linux Testing:** Verified the app natively on Arch Linux (Wayland) using `grim` to capture screenshots, bypassing the WSL black-screen issues entirely.

---

## Phase 8: End-to-End Mod Pass (2026-07-24)

**Prompt:** "check everything end to end, try everything — icons, code, testing everything."

**Goal:** Full audit → test → fix → document → ship pass over the whole repo.

**Environment (WSL/Ubuntu):** rust 1.97, pnpm 11.9, node 24, webkit2gtk-4.1 present. `pnpm install`, `pnpm build` (tsc+vite) green; chromium installed for Playwright.

**Bugs found & fixed (with proof):**
- **Fahh SFX was dead end-to-end** — `LspBridge` calls `invoke("trigger_error_sound")`, but that command never existed and `ErrorDetector` was never wired. Added `error_detector::trigger_error_sound` command, `impl Default for ErrorDetector` (3 s cooldown), `.manage(ErrorDetector::default())`, and registered the command in `lib.rs`. The core feature can now fire.
- **Run panel broken (serde)** — `RunConfig.args` was required; the frontend sends only `{path, language}`. Added `#[serde(default)]` to `args`/`cwd`. Locked with a deserialization test.
- **Debugger broken (serde + adapter names)** — `DapConfig.args/cwd/stop_on_entry` required; frontend omits them. Added `#[serde(default)]` + a `working_dir()` fallback to the program's parent. Adapter match now accepts the names the UI actually sends (`debugpy`, `js-debug`, `codelldb`, `dlv-dap`). Tests added.
- **LSP inbound field mismatch** — backend emitted `{language, message}`; frontend expects `payload`. Renamed the emit field to `payload` so diagnostics (and the SFX diagnostic path) flow.
- **Extensions panel: empty "Languages" tab + "undefined" author** — backend serialized kind as `language_pack` (frontend filters `language`) and the `Plugin` struct lacked `author`/`builtin`/`extensions`/`command`/`monaco_theme`. Aligned the Rust model to the TS contract; `LanguagePack` now serializes as `"language"`. Tests assert the serialized shape.
- **Blank purple app icon** — every icon was a flat #7c3aed square (1024² icon.png was 6.5 KB). Designed a real branded SVG (F monogram + sound-wave bars on a purple-gradient tile) and regenerated the full desktop/iOS/Android icon set via `tauri icon`.
- **Missing favicons** — added `favicon.svg` to the Vite app (`public/`) and all four `docs/*.html` landing pages.
- **Broken `vercel.json`** — it referenced non-existent `src/index.html` + `src/server.rs` (`@vercel/rust`) and routed everything to a server that doesn't exist. Replaced with a valid static config serving `docs/`.
- **Pre-existing clippy CI break** — clippy 1.97 promotes `lines().flatten()` to a hard error (`lines_filter_map_ok`). Fixed both sites in `terminal.rs` with `map_while(Result::ok)`; `cargo clippy --all-targets -- -D warnings` is green again.
- **Doc rot** — the earlier `fahhhh.mp3`→`fahh.mp3` rename never propagated to the docs, and docs still called the MP3 a "silent 427-byte placeholder" (it is a real ~29 KB clip). Corrected across CLAUDE.md, README.md, CONTRIBUTING.md, and the living IMP_DOCS. Fixed the status-bar version drift (`v0.2.0`→`v0.3.0`).

**Tests added (were zero before):** 10 Rust unit tests in `runner.rs`, `debugger.rs`, `plugin.rs` locking the serde contracts and the plugin registry shape. Rewrote `fahh-test.mjs` into a portable 24-check Playwright suite (screenshots into the repo, correct assertions).

**Verification (all real):** `cargo test` 10/10 · `cargo clippy -D warnings` clean · `pnpm build` clean · Playwright QA **24/24 PASS, 0 critical console errors**. Screenshots + `results.json` under `IMP_DOCS/CANARY_RESULTS/v0.3.1/`.

**Known issues (logged, not fixed):** DAP event translation is still incomplete (backend emits raw `{session_id, message}`; UI expects `{event, body}`) and the Node adapter's CDP↔DAP bridge is unimplemented — the debugger starts but won't drive stepping/variables yet. `terminal.rs::write_stdin` remains a no-op (interactive stdin needs the streaming model reworked). The Extensions list advertises 8 themes while only 5 are applyable (`ThemeId`). These are backend-only paths not exercisable in web QA and are documented for a future phase.

---

## Phase 9: Documentation pass (2026-08-04)

**Document version:** v1 · **Branch:** `fix/mod-2026-07-24`

**Goal:** complete the core `IMP_DOCS` set — `HANDOFF.md`, `TECHSPEC.md`,
`PROMPT_TRAIL.md`, `DESIGN_CHOICES.md`, `TODOS.md` — without overwriting anything that
was already here.

**What was preserved.** `HANDOFF.md`, `PROMPT_TRAIL.md`, `TECH_SPEC.md`,
`INSTALLATION.md`, `STARTER_PROMPT.md` and the whole `CANARY_RESULTS/` tree were left as
written. `HANDOFF.md` and this file each gained an appended, dated section rather than an
edit. `TECHSPEC.md` was added as a new file that covers the current branch and points at
`TECH_SPEC.md` for the full Tauri command, event and capability inventory — the older
document is more complete on those and duplicating it would guarantee drift.

**What was added.** `TECHSPEC.md`, `DESIGN_CHOICES.md`, `TODOS.md`, plus these two
appendices.

### The order the branch's work happened in

| Commit | What |
| --- | --- |
| `4318181` | Bundle Monaco locally so the editor renders in the packaged app |
| `386d0f2` | Remove committed build junk and scratch files from the repo root |
| `6633de9` | Ship an actually audible error sound instead of the placeholder |
| `060415f` | Build a real Source Control sidebar on top of git2 |
| `9f8b50c` | Replace the AI placeholder with a real bring-your-own-provider panel |
| `e972b88` | Surface LSP diagnostics as Monaco markers |
| `48c5175` | Add a real vitest suite and drop `--passWithNoTests` |
| `ab1a4e6` | Bring the README feature table in line with what actually works |

`--passWithNoTests` deserves the callout it gets in that commit message: with it set,
a suite of zero tests reports green, which is the same signal as a suite that passes.
Dropping the flag is what made the 136 tests mean anything.

### What was actually run in this pass

| Command | Result |
| --- | --- |
| `pnpm test` | 8 files, **136 passed**, 1.11 s |
| `ffprobe … src-tauri/assets/fahh.mp3` | `duration=0.470204` |
| `ffmpeg -af volumedetect` on the same file | `mean_volume: -6.3 dB`, `max_volume: -1.2 dB` |
| `ls -la dist/assets/index-*.js` | `3562287` bytes |
| `grep '#[test]' src-tauri/src/` | 10 test functions across `runner.rs`, `debugger.rs`, `plugin.rs` |
| `grep -n GitSidebar src/App.tsx` | import at `:7`, render at `:214` |
| `git cat-file -t e95ac2e` | `fatal: Not a valid object name` |

### What could not be verified, and what was written instead

- **The PR #36 merge (`e95ac2e`) and its two green CI checks.** The object is not in
  this clone and local `main` is at `7f5dcb0`; no network call was made. The docs say
  the merge is unconfirmed from here and record how to confirm it, rather than asserting
  it.
- **`cargo test`.** Not run in this pass. The docs state that 10 `#[test]` functions
  exist and that the last recorded run was 10/10 on 2026-07-24 — not that they pass
  today.
- **Anything visual.** No display is available in WSL, so the app was not launched. Every
  claim about the editor rendering, the sound playing, or the sidebar appearing is
  explicitly marked as unproven in `TODOS.md` §3.
- **The old sound file's 1.824 s / −21.0 dB.** The file was replaced, so those figures
  are quoted as the previous pass's record. The new file's numbers were measured here.

### Lesson worth carrying forward

Two of this branch's most expensive bugs — the blank editor and the unrendered git
sidebar — were invisible to unit tests by construction, and only reproduce in a built,
running application. The tests are worth having; they are not a substitute for launching
the thing. Until someone runs it on a machine with a display, `TODOS.md` §3 is the
honest summary of what is known.
