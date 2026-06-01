# Architecture

This document explains the technical decisions behind Fahh Editor and how the
layers connect.

---

## Stack overview

| Layer | Technology | Why |
|-------|-----------|-----|
| Desktop shell | Tauri 2 | Native performance, tiny binary, no Chromium bundled |
| UI framework | React 18 + TypeScript 5 | CATE reference uses this; best Monaco ecosystem |
| Code editor | Monaco Editor | Same engine as VS Code; full LSP protocol support |
| Terminal | xterm.js | Industry standard; supports full PTY |
| Global state | Zustand | Lightweight, no boilerplate, works with Tauri events |
| Styling | TailwindCSS 4 | Utility-first, no runtime overhead |
| Backend language | Rust (tokio) | Fast, safe, async-native; Tauri requires it |
| LSP client | tower-lsp | Async LSP protocol implementation for Rust |
| File watching | notify crate | Cross-platform, async file system events |
| Git operations | gitoxide | Pure Rust git, no shell-out required |
| Audio playback | Web Audio API | Built into the WebView; no extra crate needed |
| AI interface | MCP (Model Context Protocol) | Provider-agnostic; any LLM tool can plug in |

---

## Layer diagram

```
┌─────────────────────────────────────────────────────┐
│          Frontend (React 18 + TypeScript)           │
│  Monaco  │  xterm.js  │  FileTree  │  GitSidebar    │
│  AIPanel │  Canvas    │  InstallerWizard             │
│                  Zustand stores                     │
│              Tauri invoke() / listen()              │
└──────────────────────┬──────────────────────────────┘
                       │ IPC (Tauri commands + events)
┌──────────────────────▼──────────────────────────────┐
│              Rust backend (tokio async)             │
│  editor.rs  │  workspace.rs  │  terminal.rs         │
│  lsp.rs     │  plugin.rs     │  state.rs            │
│  error_detector.rs           │  installer.rs        │
└──────────────────────────────────────────────────────┘
                       │
         ┌─────────────┼──────────────┐
         ▼             ▼              ▼
    Language       File system     Git index
    servers        (notify)        (gitoxide)
    (LSP stdio)
```

---

## Tauri IPC model

The frontend and backend communicate exclusively through Tauri's IPC bridge:

- **Commands** (`invoke`): frontend calls a Rust function and awaits a typed response
- **Events** (`emit` / `listen`): Rust emits events the frontend subscribes to

All Tauri commands are registered in `src-tauri/src/lib.rs`. Every command has
a corresponding TypeScript type declaration in `src/lib/types.ts` and a wrapper
function in `src/lib/tauri.ts`.

---

## The Fahh SFX system

The SFX system is the most important feature in the project. See
[FAHH_SFX.md](FAHH_SFX.md) for the full spec.

Summary:

1. `error_detector.rs` subscribes to LSP diagnostic events (via the LSP client)
   and monitors build task stdout for error patterns
2. On the first error event after the cooldown window, it calls
   `app_handle.emit("fahh://error", payload)`
3. `src/lib/fahh.ts` listens for this event and plays `fahhhh.mp3` using
   the Web Audio API

---

## Optional tools architecture

Optional tools (n8n, browser-use, Flowise, CLIs) are managed by `installer.rs`.
Each tool is modeled as:

```rust
pub enum OptionalTool {
    N8n,
    BrowserUse,
    FlowiseAi,
    GitHubCli,
    ClaudeCli,
}
```

Each variant implements `check_installed() -> bool` and `install(sender) -> Result<()>`
where `sender` is a channel that streams stdout lines back to the frontend in
real time.

Tool state is persisted in `~/.fahh/config.json`.

---

## Canvas mode

The infinite canvas is inspired by CATE's multi-panel layout. Editor tabs can be
dragged out of the tab bar onto the canvas, becoming tiles. The canvas is a
zoomable, pannable surface implemented in `src/components/Canvas/`.

Each tile is an independent Monaco editor instance with its own LSP connection.
Layout is persisted in `~/.fahh/workspace.json`.

---

## AI agent layer

All AI features go through MCP (Model Context Protocol). The AI panel
(`src/components/AIPanel/`) discovers available MCP servers from
`~/.fahh/config.json` and connects to whichever are installed.

Built-in MCP integrations when installed by the user:
- Claude CLI (via `@anthropic-ai/claude-code`)
- n8n (workflow tool calls from the AI panel)
- browser-use (web agent tool calls)

No AI provider is hardcoded. The IDE works without any AI tools installed.

---

## Reference: CATE

`https://github.com/0-AI-UG/cate` is used as the architecture reference for:
- Panel layout and docking system patterns
- File tree and git sidebar UI patterns
- Multi-terminal session management

Fahh Editor does not share code with CATE. The patterns are reimplemented in
this stack (Tauri 2 vs CATE's Electron).
