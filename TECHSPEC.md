# Fahh Editor — Technical Specification

**Version:** 0.1.0 (Phase 1)  
**Last updated:** 2026-06-27

---

## Architecture overview

Fahh Editor is a **cross-platform desktop IDE** built with Tauri 2. It uses a split-process architecture:

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (WebView2 / WebKit)                               │
│  React 18 + TypeScript + Monaco + Zustand + TailwindCSS     │
│                                                              │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────────────┐  │
│  │ FileTree   │ │ EditorPane   │ │ TerminalPanel        │  │
│  │ (sidebar)  │ │ (Monaco)     │ │ (command runner)     │  │
│  └────────────┘ └──────────────┘ └──────────────────────┘  │
│                    ↑ IPC (invoke / event)                    │
├────────────────────┼────────────────────────────────────────┤
│  Tauri Core (Rust)                                           │
│  ┌──────────────┬──────────────┬──────────────┬──────────┐  │
│  │ workspace.rs │ terminal.rs  │ error_       │ state.rs │  │
│  │ (fs ops)     │ (exec cmd)   │ detector.rs  │ (config) │  │
│  └──────────────┴──────────────┴──────────────┴──────────┘  │
│                                                              │
│  Plugins: tauri-plugin-shell, tauri-plugin-dialog,           │
│           tauri-plugin-fs                                    │
└─────────────────────────────────────────────────────────────┘
         ↓ OS calls
   File system, processes, LSP servers
```

---

## Tech stack and dependencies

### Rust backend (`src-tauri/`)

| Crate | Version | Purpose |
|-------|---------|---------|
| `tauri` | 2.x | App framework, WebView bridge, IPC |
| `tauri-plugin-shell` | 2.x | Sidecar process management |
| `tauri-plugin-dialog` | 2.x | Native file picker dialog |
| `tauri-plugin-fs` | 2.x | Sandboxed filesystem access |
| `tauri-build` | 2.x | Build-time code generation |
| `tokio` | 1.x | Async runtime (full feature set) |
| `serde` + `serde_json` | 1.x | Serialization for IPC payloads |
| `anyhow` | 1.x | Error handling with context |
| `tracing` | 0.1 | Structured logging |
| `tracing-subscriber` | 0.3 | Log sink with `RUST_LOG` env support |
| `notify` | 6.x | Filesystem change watcher |
| `notify-debouncer-mini` | 0.4 | Debounced watcher wrapper |
| `walkdir` | 2.x | Recursive directory traversal |
| `dirs` | 5.x | Home dir / config dir paths |

### React frontend (`src/`)

| Package | Version | Purpose |
|---------|---------|---------|
| `react` + `react-dom` | 18.x | UI framework |
| `@tauri-apps/api` | 2.x | `invoke()`, `listen()`, event bus |
| `@tauri-apps/plugin-dialog` | 2.x | File picker from frontend |
| `@tauri-apps/plugin-fs` | 2.x | Frontend fs access |
| `@tauri-apps/plugin-shell` | 2.x | Shell command API |
| `@monaco-editor/react` | 4.x | Monaco editor React wrapper |
| `@xterm/xterm` | 5.x | Terminal emulator (Phase 2 PTY) |
| `@xterm/addon-fit` | 0.10 | Auto-resize terminal to container |
| `@xterm/addon-web-links` | 0.11 | Clickable URLs in terminal |
| `zustand` | 4.x | Global state management |
| `vite` | 5.x | Dev server + bundler |
| `typescript` | 5.x | Type system (strict mode) |
| `tailwindcss` | 3.x | Utility-first CSS |
| `vitest` | 2.x | Unit test runner |

---

## Data flow

### Opening a file

```
User clicks file in FileTree
  → FileNode.handleClick()
  → useWorkspace.openFileInEditor(path)
  → tauri.ts: readFile(path) → invoke("read_file", {path})
  → Rust: workspace::read_file() → std::fs::read_to_string()
  → Returns content string
  → editorStore.openFile(doc, content)
  → EditorPane re-renders with Monaco editor showing content
```

### Saving a file

```
User presses Ctrl+S in EditorPane
  → EditorPane.handleSave()
  → tauri.ts: writeFile(path, content) → invoke("write_file", {path, content})
  → Rust: workspace::write_file() → std::fs::write()
  → editorStore.markDirty(path, false)
  → TabBar updates dirty indicator (● removed)
```

### Fahh SFX trigger

```
Rust: error_detector::ErrorDetector::trigger(app)
  → Checks atomic cooldown timestamp (default 3s)
  → If cooldown passed: app.emit("fahh://error", ())
  → JS: fahh.ts listen("fahh://error", handler)
  → Web Audio API: AudioContext → BufferSource → destination.play()
  → User hears "fahhhh" sound
```

Currently, `trigger()` must be called manually from Rust code that detects errors
(e.g., LSP diagnostic callbacks, build output parser). LSP wiring is Phase 2.

### Terminal execution

```
User types command, presses Enter in TerminalPanel
  → useTerminal.run(command)
  → tauri.ts: executeCommand(command, [], cwd)
  → invoke("execute_command", {command, args, cwd})
  → Rust: terminal::execute_command() → std::process::Command("cmd /C ...")
  → Waits for completion, returns stdout + stderr + exit_code
  → terminalStore.addLine(stdout)
  → React re-renders TerminalPanel
  → Also emits Tauri event "terminal://output" (for future streaming)
```

### Config persistence

```
State stored at: ~/.fahh/config.json
Schema: FahhConfig {
  sfx_cooldown_secs?: number,   // default: 3
  last_workspace?: string,      // last opened folder path
  installed_tools: string[],    // ["n8n", "gh", ...]
  theme?: string                // reserved for Phase 2
}
```

---

## Module reference

### Rust (`src-tauri/src/`)

```
lib.rs               — Tauri app builder, plugin chain, command handler registration
main.rs              — Binary entry point
app/mod.rs           — setup() hook: runs quality gates on startup
core/
  runtime.rs         — tracing-subscriber init (RUST_LOG env, compact format)
  state.rs           — AppState (FahhConfig in Mutex), load/save config commands
  workspace.rs       — File system commands (tree, read, write, create, delete, rename)
  editor.rs          — Document metadata (language detection, open/close tracking)
  terminal.rs        — Command execution, stdout/stderr capture, terminal events
  lsp.rs             — LSP server auto-detection (rust-analyzer, tsserver, pylsp/pyright)
  error_detector.rs  — ErrorDetector: atomic cooldown, emits fahh://error event
  installer.rs       — OptionalTool enum, per-tool check + install, progress events
  plugin.rs          — CapabilityRegistry (feature flags)
  quality.rs         — Startup acceptance gates (home dir, config writability)
```

### TypeScript (`src/`)

```
lib/types.ts         — Shared payload types (FileEntry, Document, FahhConfig, etc.)
lib/tauri.ts         — Typed invoke() wrappers for all Tauri commands
lib/fahh.ts          — Web Audio API player, Tauri event listener for fahh://error
store/editorStore.ts — Tabs, active file, content cache, dirty state
store/fileStore.ts   — Workspace root path, file tree
store/terminalStore.ts — Terminal output lines (capped at 1000), cwd
hooks/useWorkspace.ts  — openFolder(), openFileInEditor() — wires Tauri → stores
hooks/useTerminal.ts   — run(cmd) — executes command, writes to terminal store
components/
  Editor/TabBar.tsx          — Tab strip (close button, dirty indicator)
  Editor/EditorPane.tsx      — Monaco wrapper (Ctrl+S save, welcome screen)
  FileTree/FileTree.tsx      — Recursive tree (depth 5, emoji icons, open folder)
  Terminal/TerminalPanel.tsx — Terminal UI (output log + command input)
  GitSidebar/index.tsx       — Placeholder (Phase 2)
  AIPanel/index.tsx          — Placeholder (Phase 2)
  InstallerWizard/index.tsx  — Optional tools modal (status check + install buttons)
App.tsx              — Root layout: activity bar + sidebar + editor + terminal + statusbar
main.tsx             — ReactDOM.createRoot mount
index.css            — Tailwind base, scrollbar styles
```

---

## API contracts (Tauri commands)

All commands are registered in `src-tauri/src/lib.rs` via `.invoke_handler(tauri::generate_handler![...])`.

### Filesystem commands

```typescript
get_file_tree(root: string) → FileEntry
read_file(path: string) → string
write_file(path: string, content: string) → void
create_file(path: string) → void
delete_file(path: string) → void
rename_file(from: string, to: string) → void
```

### Editor commands

```typescript
open_document(path: string) → Document
close_document(path: string) → void
get_open_documents() → Document[]
```

### Terminal commands

```typescript
execute_command(command: string, args: string[], cwd?: string) → CommandOutput
write_stdin(pid: number, data: string) → void
```

### Installer commands

```typescript
get_tool_status() → ToolStatus[]
install_tool(toolName: string) → void  // async, streams via "installer://progress" events
```

### Config commands

```typescript
load_config() → FahhConfig
save_config(config: FahhConfig) → void
```

### Tauri events emitted by Rust

| Event | Payload | Source |
|-------|---------|--------|
| `fahh://error` | `null` | `error_detector.rs` — plays SFX |
| `terminal://output` | `{stdout, stderr, exit_code}` | `terminal.rs` — terminal output stream |
| `installer://progress` | `{tool, status, message}` | `installer.rs` — install progress |

---

## Environment setup instructions

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust + Cargo | 1.78+ | `winget install Rustlang.Rustup` |
| Node.js | 20+ | winget or nodejs.org |
| pnpm | 9+ | `npm install -g pnpm` |
| Visual Studio Build Tools 2022 | — | `winget install Microsoft.VisualStudio.2022.BuildTools` with C++ workload |
| WebView2 Runtime | — | Pre-installed on Windows 11 |

On Linux, additionally: `sudo apt install libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev`

### First-time setup

```bash
git clone https://github.com/Arnav1771/fahh-ide.git
cd fahh-ide
pnpm install
```

### Development

```bash
pnpm tauri dev
# This starts Vite dev server on :1420, then compiles + launches the Tauri window
```

### Frontend-only (no Rust)

```bash
pnpm dev           # Vite dev server only at http://localhost:1420
pnpm build         # Production Vite build to dist/
```

### Rust-only

```bash
cd src-tauri
cargo check        # Type check without linking
cargo test         # Run Rust unit tests
```

### Production build

```bash
pnpm tauri build   # Compiles everything, generates installer in src-tauri/target/release/bundle/
```

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `RUST_LOG` | `info` | Rust log level (error/warn/info/debug/trace) |
| `TAURI_ENV_DEBUG` | unset | Enable source maps in Vite build |
| `TAURI_ENV_PLATFORM` | auto | Override platform for build target selection |

---

## Deployment notes

- **Target platform:** Desktop (Windows, macOS, Linux) via Tauri 2 bundler
- **Bundled assets:** `src-tauri/assets/fahhhh.mp3` is bundled into the app package via `tauri.conf.json#bundle.resources`
- **No Docker.** Per project policy (`CLAUDE.md`): all optional tools run as local processes, no containers
- **No server.** Fahh Editor is a fully local desktop app. `vercel.json` and `Dockerfile` in the repo are legacy artifacts from a prior iteration
- **Config location:** `~/.fahh/config.json` (auto-created on first run)
- **App identifier:** `com.fahh.editor`
- **Window:** 1400×900, resizable

### Release bundle outputs (after `pnpm tauri build`)

| Platform | Output |
|----------|--------|
| Windows | `src-tauri/target/release/bundle/msi/*.msi` |
| macOS | `src-tauri/target/release/bundle/macos/*.app` + `.dmg` |
| Linux | `src-tauri/target/release/bundle/deb/*.deb` + `.AppImage` |

---

## Color system (Tailwind custom tokens)

Based on Catppuccin Mocha palette:

| Token | Hex | Usage |
|-------|-----|-------|
| `fahh-bg` | `#1e1e2e` | Main editor background |
| `fahh-sidebar` | `#181825` | Sidebar, activity bar, status bar |
| `fahh-surface` | `#313244` | Panels, borders, hover states |
| `fahh-accent` | `#cba6f7` | Active tab indicator, buttons, AI icon |
| `fahh-text` | `#cdd6f4` | Primary text |
| `fahh-muted` | `#6c7086` | Secondary text, inactive tabs |
| `fahh-error` | `#f38ba8` | Error output, stderr |
| `fahh-warn` | `#fab387` | Dirty file indicator (●) |
| `fahh-success` | `#a6e3a1` | Installed tool checkmarks |
| `fahh-info` | `#89b4fa` | Terminal command echoes |
