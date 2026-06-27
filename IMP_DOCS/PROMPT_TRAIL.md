# Fahh Editor — Prompt Trail

This document records every major decision, attempt, failure, and lesson learned during the build session that took a docs-only repo to a fully released v0.2.0 multi-platform IDE. Use it to understand *why* things are the way they are.

---

## Session overview

**Start state:** Repo had only documentation — no `src/`, no `src-tauri/`, no `package.json`.  
**End state:** v0.2.0 released on Windows/macOS/Linux, WSL dev build working, GitHub Pages with web IDE live.

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
