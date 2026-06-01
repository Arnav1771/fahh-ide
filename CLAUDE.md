# CLAUDE.md — Fahh Editor Agent Guide

This file tells AI coding agents (Claude Code, GitHub Copilot, Cursor, etc.)
how to navigate, build, and extend this repository. Read this entire file
before making any changes.

---

## What this project is

**Fahh Editor** is a cross-platform desktop IDE built with Tauri 2 (Rust backend)
and React 18 + TypeScript (frontend). It is designed as a VS Code competitor with
a meme personality: whenever a user's code has an error, the IDE plays the
`fahhhh.mp3` sound effect (located at `src-tauri/assets/fahhhh.mp3`).

The IDE also supports optional AI and workflow tools — n8n, browser-use, Flowise AI,
and various CLI tools — installed locally (no Docker) via a first-run setup wizard.

---

## Repository layout

```
fahh-ide/
├── src-tauri/               ← Rust backend (Tauri 2)
│   ├── src/
│   │   ├── main.rs          ← Tauri app entry point
│   │   ├── lib.rs           ← Tauri builder and command registration
│   │   ├── core/
│   │   │   ├── editor.rs    ← Document model, tab management
│   │   │   ├── workspace.rs ← Async file system scanning
│   │   │   ├── terminal.rs  ← Build/run task execution
│   │   │   ├── lsp.rs       ← LSP client abstraction
│   │   │   ├── plugin.rs    ← Capability registry
│   │   │   ├── state.rs     ← Session persistence
│   │   │   ├── runtime.rs   ← Logging, panic boundary
│   │   │   ├── quality.rs   ← Startup acceptance gates
│   │   │   ├── error_detector.rs  ← Fahh SFX trigger (watches LSP + build)
│   │   │   └── installer.rs       ← Optional tools setup wizard backend
│   │   └── app/
│   │       └── mod.rs       ← App bootstrap and orchestration
│   ├── assets/
│   │   └── fahhhh.mp3       ← THE sound file. Do not rename or move.
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                     ← React + TypeScript frontend
│   ├── components/
│   │   ├── Editor/          ← Monaco editor wrapper + tabs
│   │   ├── FileTree/        ← File explorer sidebar
│   │   ├── Terminal/        ← xterm.js terminal panel
│   │   ├── GitSidebar/      ← Git status, diff, commit UI
│   │   ├── AIPanel/         ← AI chat + inline completions
│   │   ├── Canvas/          ← Infinite canvas mode (tiles)
│   │   └── InstallerWizard/ ← First-run optional tools wizard
│   ├── store/               ← Zustand global state stores
│   ├── hooks/               ← Custom React hooks
│   ├── lib/
│   │   └── fahh.ts          ← Fahh SFX player (listens for Tauri events)
│   ├── App.tsx
│   └── main.tsx
├── docs/
│   ├── ARCHITECTURE.md
│   ├── FAHH_SFX.md
│   └── INSTALLER.md
├── CLAUDE.md                ← you are here
├── README.md
├── CONTRIBUTING.md
├── CHANGELOG.md
├── package.json
└── .gitignore
```

---

## How to build

### Prerequisites

- Rust 1.78+ (`rustup update stable`)
- Node.js 20+ and pnpm 9+ (`npm install -g pnpm`)
- Tauri CLI 2: `cargo install tauri-cli --version "^2"`
- On Linux: `sudo apt install libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev`
- On macOS: Xcode Command Line Tools
- On Windows: Visual Studio Build Tools 2022

### Development

```bash
pnpm install
pnpm tauri dev
```

### Production build

```bash
pnpm tauri build
```

### Rust-only tests (backend)

```bash
cargo test
```

### Frontend tests

```bash
pnpm test
```

---

## Critical: the Fahh SFX

The sound file is `src-tauri/assets/fahhhh.mp3` (4 h's in the filename — do not
change this). The flow is:

1. `src-tauri/src/core/error_detector.rs` watches LSP diagnostics and build output
2. On detecting an error (with a 3-second cooldown), it emits Tauri event `fahh://error`
3. `src/lib/fahh.ts` listens for this event and plays the MP3 via the Web Audio API
4. The cooldown is configurable in Settings and stored in `~/.fahh/config.json`

**Never remove the SFX.** It is a core feature, not optional.

---

## Optional tools (installer wizard)

All optional tools run as local processes. No Docker. The installer backend is
`src-tauri/src/core/installer.rs`. It must:

- Detect if a tool is already installed before trying to install
- Stream stdout back to the frontend in real time via Tauri events
- Store state in `~/.fahh/config.json`
- Be idempotent (safe to run twice)

Tools and their install commands:

| Tool | Requires | Install command |
|------|----------|-----------------|
| n8n | Node 18+ | `npm install -g n8n` |
| browser-use | Python 3.11+ | `pip install browser-use && playwright install chromium` |
| Flowise AI | Node 18+ | `npm install -g flowise` |
| GitHub CLI | — | platform-specific, check `gh.io/cli` |
| Claude CLI | Node 18+ | `npm install -g @anthropic-ai/claude-code` |

---

## AI integration

All AI features use Model Context Protocol (MCP) as the standard interface.
Do not hardcode a single AI provider. The AI panel in `src/components/AIPanel/`
should discover available MCP servers from `~/.fahh/config.json` and connect
to whichever ones are installed.

---

## Architecture reference

Use `https://github.com/0-AI-UG/cate` as the reference for:
- Panel layout and docking system
- Infinite canvas (editor tiles on a zoomable surface)
- Git sidebar patterns
- Terminal integration

Do NOT copy code. Understand the patterns and reimplement in this stack.

---

## Coding rules

- Rust: use `anyhow::Result` for errors, `tokio` for async, `tracing` for logging
- TypeScript: strict mode, no `any`, functional components only
- React state: Zustand for global, `useState` for local
- Styling: TailwindCSS 4 utility classes only — no inline styles, no CSS modules
- Never use `unwrap()` in production Rust code — use `?` or handle explicitly
- Every Tauri command must have a corresponding TypeScript type in `src/lib/types.ts`
- The `fahhhh.mp3` filename must never change

---

## Common tasks for agents

**Add a new Tauri command:**
1. Write the handler in the appropriate `src-tauri/src/core/*.rs` file
2. Annotate it with `#[tauri::command]`
3. Register it in `src-tauri/src/lib.rs` in the `.invoke_handler()` call
4. Add the TypeScript type and `invoke()` wrapper in `src/lib/tauri.ts`

**Add a new optional tool to the installer:**
1. Add a variant to the `OptionalTool` enum in `installer.rs`
2. Implement `check_installed()` and `install()` for it
3. Add it to the wizard UI in `src/components/InstallerWizard/`
4. Document it in `docs/INSTALLER.md`

**Modify the Fahh SFX:**
1. The trigger logic lives in `src-tauri/src/core/error_detector.rs`
2. The playback logic lives in `src/lib/fahh.ts`
3. Document changes in `docs/FAHH_SFX.md`
