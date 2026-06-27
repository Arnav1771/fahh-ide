# Fahh Editor — Handoff Document

**Last updated:** 2026-06-27  
**Version:** v0.2.0  
**Repo:** https://github.com/Arnav1771/fahh-ide  
**Live site:** https://arnav1771.github.io/fahh-ide/  
**Web IDE:** https://arnav1771.github.io/fahh-ide/play.html

---

## What is this project?

**Fahh Editor** is a cross-platform desktop IDE built with Tauri 2 (Rust backend) + React 18 + TypeScript (frontend). Its defining feature: every time your code has an error (LSP diagnostic, build failure), it plays `fahhhh.mp3` — a sound effect. The filename has 4 h's. Do not rename it.

---

## Current working state (v0.2.0)

### What works right now

| Feature | Status | Notes |
|---------|--------|-------|
| App installs on Windows | ✅ | NSIS .exe installer (3MB) |
| App launches on Windows | ✅ | After fixing `shell.sidecar` crash |
| Monaco editor | ✅ | Syntax highlighting, Ctrl+S save |
| File tree (Explorer sidebar) | ✅ | Open Folder via dialog OR manual path input |
| Terminal panel | ✅ | Runs cmd.exe commands, streams output |
| Run panel | ✅ | Python selector + ▶ Run button |
| Debug panel UI | ✅ | Breakpoints/callstack/variables UI ready |
| 5 built-in themes | ✅ | Fahh Dark, Fahh Light, GitHub Dark, Dracula, Solarized |
| Theme switcher | ✅ | Live — status bar updates |
| Extensions panel | ✅ | Language packs, formatters, snippets listed |
| Installer wizard | ✅ | n8n/browser-use/Flowise/gh/claude install |
| GitHub Pages site | ✅ | Landing page + docs + web IDE |
| Web IDE (play.html) | ✅ | Python (Pyodide), JS, TS run in browser |
| Multi-platform release | ✅ | Windows .msi/.exe, macOS .dmg (arm64+x64), Linux .AppImage/.deb/.rpm |
| CI/CD | ✅ | GitHub Actions — builds all 4 platforms on every `v*` tag |
| `pnpm tauri dev` in WSL | ✅ | Compiled and ran 13 minutes |

### What doesn't work yet (Phase 2)

| Feature | Status | Blocker |
|---------|--------|---------|
| `pnpm tauri dev` on Windows | ❌ | MSVC linker needs VS Build Tools (install manually as Admin) |
| fahhhh.mp3 plays a real sound | ⚠️ | Current file is silent placeholder (427 bytes) |
| LSP completions in editor | ❌ | `lsp_client.rs` detects servers but doesn't wire them to Monaco yet |
| DAP debugging (step through) | ❌ | `debugger.rs` exists but UI wiring incomplete |
| Code execution (Run button) | ⚠️ | `runner.rs` exists but IPC not fully wired to RunPanel |
| Git sidebar | ❌ | Phase 2 placeholder |
| AI panel with MCP | ❌ | Phase 2 placeholder |
| Open Folder native dialog on Linux/WSL | ⚠️ | Falls back to text input (xdg-desktop-portal not in WSL) |

---

## Repository structure

```
fahh-ide/
├── src-tauri/                  ← Rust backend (Tauri 2)
│   ├── src/
│   │   ├── main.rs             ← Binary entry point
│   │   ├── lib.rs              ← Tauri builder + all command registration
│   │   ├── core/
│   │   │   ├── editor.rs       ← Document model, language detection
│   │   │   ├── workspace.rs    ← File system ops (tree, read, write...)
│   │   │   ├── terminal.rs     ← Command execution via cmd.exe/sh
│   │   │   ├── error_detector.rs ← Fahh SFX trigger (atomic cooldown)
│   │   │   ├── installer.rs    ← Optional tools (n8n, Flowise, gh, claude)
│   │   │   ├── state.rs        ← FahhConfig, ~/.fahh/config.json
│   │   │   ├── lsp_client.rs   ← LSP server spawn + JSON-RPC bridge
│   │   │   ├── runner.rs       ← Code execution (18+ languages)
│   │   │   ├── debugger.rs     ← DAP client (Python/Node/Go/LLDB)
│   │   │   ├── formatter.rs    ← Prettier/Black/gofmt/rustfmt/clang-format
│   │   │   ├── plugin.rs       ← Plugin registry (themes, lang packs, formatters)
│   │   │   ├── lsp.rs          ← LSP server auto-detection on PATH
│   │   │   ├── runtime.rs      ← tracing-subscriber init
│   │   │   └── quality.rs      ← Startup acceptance gates
│   │   └── app/
│   │       └── mod.rs          ← App setup(), quality gates
│   ├── assets/
│   │   └── fahhhh.mp3          ← THE SOUND FILE (4 h's, 427 bytes — replace with real audio!)
│   ├── capabilities/
│   │   └── default.json        ← Tauri 2 capability grants (dialog, fs, shell)
│   ├── icons/                  ← All 16 required icon files (auto-generated violet squares)
│   ├── Cargo.toml              ← v0.2.0, tauri 2.x, tokio, serde, anyhow, etc.
│   ├── build.rs                ← tauri-build invocation
│   └── tauri.conf.json         ← com.fahh.editor, 1400×900, fahhhh.mp3 bundled
├── src/                        ← React + TypeScript frontend
│   ├── components/
│   │   ├── Editor/
│   │   │   ├── EditorPane.tsx  ← Monaco editor, Ctrl+S save, theme prop
│   │   │   └── TabBar.tsx      ← Tabs with dirty indicator (●)
│   │   ├── FileTree/
│   │   │   └── FileTree.tsx    ← Explorer + Open Folder (dialog + text input fallback)
│   │   ├── Terminal/
│   │   │   └── TerminalPanel.tsx ← Command input + output display
│   │   ├── RunPanel/           ← Language selector + ▶ Run button
│   │   ├── DebugPanel/         ← DAP toolbar, breakpoints, callstack, variables
│   │   ├── ThemePanel/         ← 5 theme swatches with live apply
│   │   ├── ExtensionsPanel/    ← Themes/Languages/Formatters tabs
│   │   ├── LspBridge/          ← Non-rendering LSP lifecycle manager
│   │   ├── InstallerWizard/    ← Optional tools modal
│   │   ├── AIPanel/            ← Phase 2 placeholder
│   │   └── GitSidebar/         ← Phase 2 placeholder
│   ├── store/
│   │   ├── editorStore.ts      ← Open tabs, active file, content, dirty
│   │   ├── fileStore.ts        ← Workspace root, file tree
│   │   ├── terminalStore.ts    ← Terminal output lines (capped 1000)
│   │   ├── runnerStore.ts      ← Run panel state, output, pid
│   │   ├── debugStore.ts       ← DAP session, breakpoints, frames, vars
│   │   └── themeStore.ts       ← Active theme (persisted to localStorage)
│   ├── hooks/
│   │   ├── useWorkspace.ts     ← openFolder(), openFileInEditor()
│   │   └── useTerminal.ts      ← run(cmd) → terminal store
│   ├── lib/
│   │   ├── types.ts            ← All TypeScript payload types
│   │   ├── tauri.ts            ← Typed invoke() wrappers for all commands
│   │   └── fahh.ts             ← Web Audio API player for fahh://error event
│   ├── App.tsx                 ← Root layout: activity bar + sidebar + editor + terminal + statusbar
│   ├── main.tsx                ← ReactDOM.createRoot mount
│   └── index.css               ← Tailwind directives + scrollbar styles
├── docs/                       ← GitHub Pages site
│   ├── index.html              ← Landing page (Space Mono, animated editor mockup)
│   ├── docs.html               ← Documentation (sidebar nav, API reference)
│   └── play.html               ← Web IDE (Monaco + Pyodide + JS eval)
├── IMP_DOCS/                   ← This folder — for AI handoff
│   ├── HANDOFF.md              ← This file
│   ├── TECH_SPEC.md            ← Architecture + API reference
│   └── PROMPT_TRAIL.md         ← Session history, decisions, lessons
├── .github/
│   └── workflows/
│       ├── release.yml         ← Multi-platform release on v* tags
│       └── ci.yml              ← TS check + Rust clippy on every PR
├── package.json                ← pnpm, React 18, Monaco, xterm, Zustand, Vite
├── pnpm-workspace.yaml         ← allowBuilds: {esbuild: true}
├── vite.config.ts              ← Port 1420, Tauri env vars
├── tsconfig.json               ← strict, no-any, ESNext
├── tailwind.config.ts          ← fahh.* Catppuccin Mocha color tokens
└── CLAUDE.md                   ← Original AI agent spec (source of truth for feature intent)
```

---

## Key environment facts

- **Node.js:** v24.x on Windows, v24.18.0 in WSL
- **pnpm:** v11.9.0
- **Rust:** 1.96.0 (stable)
- **Tauri:** 2.11.3
- **Config file:** `~/.fahh/config.json`
- **App identifier:** `com.fahh.editor`
- **WSL user for dev:** `dell` (but runs as `root` for Tauri dev in WSL due to sudo hang)
- **GitHub account:** `Arnav1771` (2nd account — credentials in Windows Credential Manager as `Arnav1771@github.com`)
- **Git local config:** `user.name = Arnav1771`, `user.email = 60522445+Arnav1771@users.noreply.github.com`

---

## How to install VS Build Tools (for `pnpm tauri dev` on Windows)

This is the one remaining manual step. Run in Terminal **as Administrator**:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --silent --accept-package-agreements --accept-source-agreements --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.Windows11SDK.26100 --includeRecommended"
```

After install completes (~15-25 min), run `pnpm tauri dev` from the repo root.

---

## How to restart `pnpm tauri dev` in WSL (fast — caches built)

```bash
wsl -d Ubuntu -u root bash -c "
  export PATH=/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  export HOME=/root DISPLAY=:0 WAYLAND_DISPLAY=wayland-0 RUST_LOG=info
  cd /root/fahh-ide && git pull origin main && pnpm install && pnpm tauri dev
"
```

First run: ~23 minutes (Tauri CLI + app compile). Subsequent runs: ~2-3 minutes (incremental).

---

## How to cut a new release

1. Make all changes, PR them into `main`
2. Push a tag: `git tag v0.X.0 && git push origin v0.X.0`  
   OR via GitHub API (the token is in the Windows Credential Manager under `Arnav1771`)
3. CI builds all 4 platforms automatically
4. Update `docs/index.html` download links with the new version number
5. Push updated docs to `gh-pages` branch

---

## Critical rules (from CLAUDE.md)

1. **Never rename `fahhhh.mp3`** — 4 h's, lives at `src-tauri/assets/fahhhh.mp3`
2. **Never remove the SFX** — it is a core feature
3. **No Docker** — all optional tools run as local processes
4. **TypeScript strict mode** — no `any`
5. **No `unwrap()` in Rust production paths** — use `?` or handle explicitly
6. **Every Tauri command needs a typed TypeScript wrapper in `src/lib/tauri.ts`**
7. **Every Tauri command needs a capability grant in `src-tauri/capabilities/default.json`**

---

## Next steps for Phase 2 (in priority order)

1. **Wire Run panel to `run_file` command** — the Rust code exists, the UI exists, connect them
2. **Wire LSP to Monaco** — `lsp_client.rs` spawns servers, `LspBridge.tsx` sends messages, need to wire responses back to Monaco's `MonacoLanguageClient`
3. **Replace `fahhhh.mp3` placeholder** — add a real sound file (the current one is silent)
4. **Git sidebar** — add `gitoxide` crate, implement `git_status`/`git_commit` commands
5. **Real PTY terminal** — replace batch-mode `execute_command` with a streaming PTY using `portable-pty`
6. **AI panel** — read MCP servers from `~/.fahh/config.json`, implement chat UI
7. **Install VS Build Tools** on the Windows dev machine to enable `pnpm tauri dev` on Windows
