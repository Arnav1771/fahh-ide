# Fahh Editor — Technical Specification

**Version:** 0.2.0  
**Last updated:** 2026-06-27

---

## Architecture overview

Two-process model. Rust owns the OS surface; React owns the UI. Communication via Tauri IPC (invoke/emit).

```
Frontend (WebView2 on Windows / WebKit on macOS+Linux)
  React 18 · TypeScript strict · Monaco · Zustand · TailwindCSS
  ┌──────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────┐
  │ FileTree │  │ EditorPane  │  │ RunPanel    │  │ Terminal │
  └──────────┘  └─────────────┘  └─────────────┘  └──────────┘
                    ↕ invoke() / emit() (Tauri IPC)
Rust backend (Tauri 2 core)
  workspace.rs · terminal.rs · error_detector.rs · runner.rs
  lsp_client.rs · debugger.rs · formatter.rs · state.rs · plugin.rs
  Plugins: tauri-plugin-shell · tauri-plugin-dialog · tauri-plugin-fs
                    ↓ OS syscalls
  File system · Processes · LSP servers · DAP adapters
```

---

## Tech stack

### Rust backend

| Crate | Version | Purpose |
|-------|---------|---------|
| `tauri` | 2.11.x | App framework, WebView bridge, IPC |
| `tauri-plugin-shell` | 2.x | Shell/sidecar process management |
| `tauri-plugin-dialog` | 2.x | Native file/folder picker |
| `tauri-plugin-fs` | 2.x | Sandboxed filesystem access |
| `tokio` | 1.x | Async runtime (full) |
| `serde` + `serde_json` | 1.x | IPC serialization |
| `anyhow` | 1.x | Error handling with context |
| `tracing` + `tracing-subscriber` | 0.1/0.3 | Structured logging |
| `walkdir` | 2.x | Recursive directory traversal |
| `dirs` | 5.x | Home/config directory paths |
| `which` | 6.x | Executable PATH lookup |
| `lazy_static` | 1.x | Global DAP session state |
| `notify` + `notify-debouncer-mini` | 6.x / 0.4 | File watcher |

### React frontend

| Package | Version | Purpose |
|---------|---------|---------|
| `react` + `react-dom` | 18.x | UI framework |
| `@tauri-apps/api` | 2.x | `invoke()`, `listen()`, events |
| `@tauri-apps/plugin-dialog` | 2.x | File picker from frontend |
| `@tauri-apps/plugin-fs` | 2.x | Frontend fs access |
| `@tauri-apps/plugin-shell` | 2.x | Shell from frontend |
| `@monaco-editor/react` | 4.x | Monaco editor React wrapper |
| `@xterm/xterm` | 5.x | Terminal emulator (Phase 2 PTY) |
| `zustand` | 4.x | Global state |
| `vite` | 5.x | Dev server + bundler |
| `typescript` | 5.x | Strict type system |
| `tailwindcss` | 3.x | Utility CSS |
| `vitest` | 2.x | Unit tests |

---

## Tauri commands (full list)

All registered in `src-tauri/src/lib.rs` via `generate_handler!`.  
All have typed TypeScript wrappers in `src/lib/tauri.ts`.  
All require capability grants in `src-tauri/capabilities/default.json`.

### Filesystem

```typescript
getFileTree(root: string) → FileEntry           // recursive, depth 5, skips node_modules/target
readFile(path: string) → string
writeFile(path: string, content: string) → void
createFile(path: string) → void
deleteFile(path: string) → void                 // works on files and directories
renameFile(from: string, to: string) → void
```

### Editor

```typescript
openDocument(path: string) → Document           // returns {path, language, dirty}
closeDocument(path: string) → void
getOpenDocuments() → Document[]
```

### Terminal

```typescript
executeCommand(command: string, args: string[], cwd?: string) → CommandOutput
writeStdin(pid: number, data: string) → void    // stub — Phase 2 PTY
```

### Code Runner (Phase 2 — Rust exists, UI wiring incomplete)

```typescript
runFile(config: RunConfig) → RunResult
// RunConfig: { path, language, args?, cwd?, env? }
// RunResult: { pid, exit_code, duration_ms }
// Streams lines via "runner://output" events: { pid, line, stream: "stdout"|"stderr"|"info" }

stopRun(pid: number) → void
```

### LSP Client (Phase 2 — Rust exists, Monaco wiring incomplete)

```typescript
lspStart(language: string, workspace: string) → void
// Auto-detects server binary (rust-analyzer, tsserver, pylsp, gopls, clangd, jdtls...)
// Forwards server→client messages via "lsp://message" events: { language, payload }

lspSend(language: string, message: string) → void   // raw JSON-RPC message to server
lspStop(language: string) → void
```

### DAP Debugger (Phase 2 — Rust exists, UI wiring incomplete)

```typescript
debugStart(config: DapConfig) → number          // returns session ID
// DapConfig: { adapter, language, program, args?, cwd?, env?, stop_on_entry? }
// Adapters: "python" (debugpy), "node" (--inspect), "go" (delve), "lldb"
// Emits "dap://event" events: { session_id, event, body }

debugContinue(sessionId: number) → void
debugStepOver(sessionId: number) → void
debugStepIn(sessionId: number) → void
debugStop(sessionId: number) → void
debugSetBreakpoints(sessionId: number, file: string, lines: number[]) → void
```

### Formatter (Phase 2 — Rust exists, UI wiring incomplete)

```typescript
formatFile(path: string, language: string) → string  // returns formatted content
// Python → black --quiet -
// JS/TS/JSON → npx prettier --stdin-filepath <path>
// Go → gofmt
// Rust → rustfmt --edition 2021
// C/C++ → clang-format
```

### Installer

```typescript
getToolStatus() → ToolStatus[]
// ToolStatus: { tool, installed, version }
// Tools: n8n, browser-use, flowise, gh, claude

installTool(toolName: string) → void
// Streams progress via "installer://progress" events: { tool, status, message }
```

### Plugin Registry (Phase 2 — Rust exists, UI wiring incomplete)

```typescript
getPlugins() → Plugin[]
getThemes() → Plugin[]
getLanguagePacks() → Plugin[]
getFormatterPlugins() → Plugin[]
getSnippetPlugins() → Plugin[]
// Plugin: { id, name, description, version, kind, author, extensions?, command?, builtin, monaco_theme? }
```

### Config

```typescript
loadConfig() → FahhConfig
saveConfig(config: FahhConfig) → void
// FahhConfig: { sfx_cooldown_secs?, last_workspace?, installed_tools[], theme? }
// Stored at: ~/.fahh/config.json
```

---

## Events emitted by Rust → received by frontend

| Event | Payload | Source module |
|-------|---------|---------------|
| `fahh://error` | null | `error_detector.rs` |
| `terminal://output` | `{stdout, stderr, exit_code}` | `terminal.rs` |
| `runner://output` | `{pid, line, stream}` | `runner.rs` |
| `installer://progress` | `{tool, status, message}` | `installer.rs` |
| `lsp://message` | `{language, payload}` | `lsp_client.rs` |
| `dap://event` | `{session_id, event, body}` | `debugger.rs` |

---

## Fahh SFX data flow

```
Rust: error_detector::ErrorDetector::trigger(app)
  → checks AtomicU64 timestamp vs cooldown (default 3s)
  → if elapsed: app.emit("fahh://error", ())
  → JS: fahh.ts listen("fahh://error")
  → Web Audio API: AudioContext.createBufferSource() → destination.start()
  → plays src-tauri/assets/fahhhh.mp3

NOTE: Current fahhhh.mp3 is a 427-byte silent placeholder.
Replace with real audio file. Filename MUST stay fahhhh.mp3 (4 h's).
```

---

## Capability grants (`src-tauri/capabilities/default.json`)

Every plugin IPC call requires an explicit grant. Without this file, all dialog/fs/shell calls silently fail. Key grants:

```json
{
  "permissions": [
    "core:default", "core:event:default", "core:window:default", "core:webview:default",
    "dialog:default", "dialog:allow-open", "dialog:allow-save",
    "fs:default", "fs:read-all", "fs:write-all",
    "fs:allow-read-text-file", "fs:allow-write-text-file", "fs:allow-read-dir",
    "fs:allow-mkdir", "fs:allow-remove", "fs:allow-rename", "fs:allow-exists",
    "fs:scope-home-recursive", "fs:scope-desktop-recursive", "fs:scope-document-recursive",
    "shell:default", "shell:allow-open", "shell:allow-execute", "shell:allow-spawn"
  ]
}
```

**Platform casing is critical:** `"macOS"` not `"macos"` in the `platforms` array.

---

## Color system (Tailwind custom tokens — Catppuccin Mocha)

| Token | Hex | Usage |
|-------|-----|-------|
| `fahh-bg` | `#1e1e2e` | Main editor background |
| `fahh-sidebar` | `#181825` | Sidebar, activity bar, status bar |
| `fahh-surface` | `#313244` | Panels, borders, hover |
| `fahh-accent` | `#cba6f7` | Active tabs, buttons |
| `fahh-text` | `#cdd6f4` | Primary text |
| `fahh-muted` | `#6c7086` | Secondary text |
| `fahh-error` | `#f38ba8` | Error output, stderr |
| `fahh-warn` | `#fab387` | Dirty file indicator (●) |
| `fahh-success` | `#a6e3a1` | Installed tools |
| `fahh-info` | `#89b4fa` | Terminal info lines |

Website uses separate tokens: `#050510` bg, `#7c3aed` violet, `#e11d48` rose.

---

## GitHub Actions CI/CD

### `release.yml` — triggered on `v*` tags or `workflow_dispatch`

1. `create-release` job: find-or-create GitHub Release (handles "already_exists" race)
2. `build` job (4 matrix): `ubuntu-22.04`, `macos-latest` (×2), `windows-latest`
   - Linux deps: `libwebkit2gtk-4.1-dev libssl-dev librsvg2-dev patchelf libayatana-appindicator3-dev`
   - Node: `lts/*`
   - Tauri action: `tauri-apps/tauri-action@v0` with `releaseId` from create-release step
   - This avoids the race condition of multiple runners creating the same release

### `ci.yml` — on every push to main/feat/**

- Frontend: `tsc --noEmit`, `pnpm build`, `pnpm test`
- Rust: `cargo check`, `cargo test`, `cargo clippy`

---

## GitHub Pages site structure

| URL | File | Description |
|-----|------|-------------|
| `/` | `docs/index.html` | Landing page — Space Mono headlines, animated editor mockup, FAHH waveform demo, platform downloads |
| `/docs.html` | `docs/docs.html` | Documentation — sidebar nav, code blocks, API reference |
| `/play.html` | `docs/play.html` | Web IDE — Monaco + Pyodide + JS eval + FAHHHH SFX |

Deployed from: `gh-pages` branch (orphan, root `index.html`)  
Served by: GitHub Pages at `https://arnav1771.github.io/fahh-ide/`

---

## Environment setup (fresh machine)

```bash
# 1. Prerequisites
winget install Rustlang.Rustup OpenJS.NodeJS
npm install -g pnpm

# 2. VS Build Tools (Windows — MUST run as Administrator)
winget install Microsoft.VisualStudio.2022.BuildTools \
  --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

# 3. Clone and install
git clone https://github.com/Arnav1771/fahh-ide.git
cd fahh-ide
pnpm install

# 4. Dev
pnpm tauri dev           # Full IDE with hot reload

# 5. Frontend only (no Rust needed)
pnpm dev                 # Vite at http://localhost:1420

# 6. Release build
pnpm tauri build         # Output: src-tauri/target/release/bundle/
```

### WSL (Ubuntu 24.04) setup

```bash
# Run as root to avoid sudo hang in non-interactive sessions
wsl -d Ubuntu -u root bash -c "
  apt-get install -y libwebkit2gtk-4.1-dev libssl-dev librsvg2-dev patchelf libayatana-appindicator3-dev build-essential curl git gstreamer1.0-plugins-good gstreamer1.0-libav
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && apt-get install -y nodejs
  npm install -g pnpm
  git clone https://github.com/Arnav1771/fahh-ide.git /root/fahh-ide
  cd /root/fahh-ide && pnpm install
  cargo install tauri-cli --version '^2' --locked
  DISPLAY=:0 pnpm tauri dev
"
```

---

## Known bugs and their fixes

| Bug | Root cause | Fix applied |
|-----|-----------|-------------|
| App crashes on startup | `shell.sidecar: false` in tauri.conf.json — unknown field | Removed `sidecar` field |
| Open Folder does nothing | Missing `src-tauri/capabilities/default.json` | Created capabilities file |
| Open Folder still fails in WSL | No `xdg-desktop-portal` in WSL | Added text input fallback in FileTree.tsx |
| CI builds fail — wrong platform name | `"macos"` should be `"macOS"` in capabilities | Fixed casing |
| CI builds fail — invalid permission names | `fs:allow-create-dir` doesn't exist (it's `fs:allow-mkdir`) | Fixed to exact valid names |
| Multiple CI runners race to create release | Each runner tried to create the same GitHub Release | Added `create-release` job with find-or-create logic |
| Linux AppImage black screen in WSL | No GPU/DRI3 in WSL — WebKit uses software rendering | Expected behavior; works on real Linux with GPU |
| fahhhh.mp3 doesn't play on Linux | GStreamer missing `text/html` decoder | Install `gstreamer1.0-plugins-good gstreamer1.0-libav` |
| apt-get update hangs in WSL | Ubuntu Pro/ESM sources try to contact `esm.ubuntu.com` without credentials | Install with `-u root` (no sudo hang), use timeout |
