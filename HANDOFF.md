# Fahh Editor — Handoff Document

**Date:** 2026-06-27  
**Branch:** `feat/phase1-implementation`  
**Agent:** Claude Code (Sonnet 4.6)

---

## Goal of this task

Bootstrap Fahh Editor from a docs-only repository into a running Phase 1 application:

- Install all dev tools (Rust, pnpm, Tauri CLI)
- Scaffold the complete Rust backend (`src-tauri/`)
- Scaffold the complete React/TypeScript frontend (`src/`)
- Fix corrupted `.gitignore` and legacy config files
- Install npm dependencies and verify the build compiles
- Document the full technical spec and open a PR

---

## Files inspected

| File | Notes |
|------|-------|
| `CLAUDE.md` | Primary spec — architecture, coding rules, Fahh SFX requirement |
| `COPILOT_PROMPT.md` | Phase 1 deliverable list (the agent task brief) |
| `docs/ARCHITECTURE.md` | Tech stack, IPC model, layer diagram |
| `docs/FAHH_SFX.md` | SFX data flow spec, cooldown logic, trigger spec |
| `docs/INSTALLER.md` | Optional tools spec (n8n, browser-use, Flowise, gh, claude) |
| `README.md` | Public overview |
| `CONTRIBUTING.md` | Branch/commit conventions |
| `Cargo.toml` | Root workspace (pre-existing, correct) |
| `.gitignore` | Pre-existing, corrupted (1367 lines of pnpm-workspace repetition) |
| `Dockerfile` | Legacy — not aligned with Tauri desktop architecture |
| `vercel.json` | Legacy — not aligned with Tauri desktop architecture |

---

## Files created / modified

### Created — Rust backend

| File | Purpose |
|------|---------|
| `src-tauri/Cargo.toml` | Tauri 2 + tokio + serde + notify + walkdir + dirs |
| `src-tauri/build.rs` | tauri-build invocation |
| `src-tauri/tauri.conf.json` | App name, identifier, window size 1400×900, asset bundling for fahhhh.mp3 |
| `src-tauri/src/main.rs` | Entry point, calls `fahh_editor_lib::run()` |
| `src-tauri/src/lib.rs` | Tauri builder, plugin registration, command handler registration |
| `src-tauri/src/core/mod.rs` | Declares all core submodules |
| `src-tauri/src/core/runtime.rs` | tracing-subscriber init with `RUST_LOG` env support |
| `src-tauri/src/core/state.rs` | `AppState` with `FahhConfig`, `load_config` / `save_config` commands, writes `~/.fahh/config.json` |
| `src-tauri/src/core/workspace.rs` | `get_file_tree`, `read_file`, `write_file`, `create_file`, `delete_file`, `rename_file` |
| `src-tauri/src/core/editor.rs` | `open_document`, `close_document`, `get_open_documents`, language detection |
| `src-tauri/src/core/terminal.rs` | `execute_command` (cmd.exe on Windows), `write_stdin`, emits `terminal://output` events |
| `src-tauri/src/core/lsp.rs` | `detect_lsp_servers()` — auto-detects rust-analyzer, tsserver, pylsp/pyright on PATH |
| `src-tauri/src/core/plugin.rs` | `CapabilityRegistry` — feature flag registry |
| `src-tauri/src/core/quality.rs` | `run_startup_checks()` — home dir + config writability gates |
| `src-tauri/src/core/error_detector.rs` | `ErrorDetector` with atomic cooldown timer; emits `fahh://error` Tauri event |
| `src-tauri/src/core/installer.rs` | `OptionalTool` enum, `get_tool_status`, `install_tool`; emits `installer://progress` events |
| `src-tauri/src/app/mod.rs` | `setup()` — runs quality gates on app start |
| `src-tauri/assets/fahh.mp3` | Minimal valid silent MP3 placeholder (427 bytes) — **must be replaced** with real audio |

### Created — React frontend

| File | Purpose |
|------|---------|
| `package.json` | React 18, Monaco, xterm, Zustand, Tauri APIs, Vite, Vitest, Tailwind |
| `pnpm-workspace.yaml` | Allows esbuild + @tauri-apps/cli build scripts (pnpm v11 config) |
| `pnpm.yaml` | Deprecated config removed; pnpm-workspace.yaml is canonical |
| `vite.config.ts` | Vite 5 with React plugin, port 1420, Tauri environment variables |
| `tsconfig.json` | Strict mode, no-any, ESNext target, bundler module resolution |
| `tailwind.config.ts` | Custom `fahh.*` color tokens (Catppuccin Mocha palette), mono fonts |
| `postcss.config.js` | Tailwind + autoprefixer |
| `index.html` | Root HTML with `<div id="root">` |
| `src/main.tsx` | React 18 `createRoot` mount |
| `src/index.css` | Tailwind directives, custom scrollbar, Monaco bg override |
| `src/App.tsx` | Main layout: activity bar, 240px sidebar, editor + tabs, 192px terminal, status bar |
| `src/lib/types.ts` | TypeScript types for all Tauri command payloads |
| `src/lib/tauri.ts` | Typed `invoke()` wrappers for every Tauri command |
| `src/lib/fahh.ts` | `initFahhSfx()` — loads fahh.mp3 via Web Audio API, listens for `fahh://error` |
| `src/store/editorStore.ts` | Zustand: open tabs, active tab, file contents, dirty state |
| `src/store/fileStore.ts` | Zustand: workspace root, file tree |
| `src/store/terminalStore.ts` | Zustand: terminal lines (capped at 1000), cwd |
| `src/hooks/useWorkspace.ts` | `openFolder()`, `openFileInEditor()` — wires Tauri ↔ store |
| `src/hooks/useTerminal.ts` | `run(cmd)` — executes command, streams lines into terminal store |
| `src/components/Editor/TabBar.tsx` | Tab strip with close button and dirty (●) indicator |
| `src/components/Editor/EditorPane.tsx` | Monaco editor wrapper; Ctrl+S save; HTML Viewer preview (Eye/Code toggle); welcome screen when no file open |
| `src/components/FileTree/FileTree.tsx` | Recursive file tree with depth limit 5; lucide-react file icons; "Open Folder" via Tauri dialog |
| `src/components/Terminal/TerminalPanel.tsx` | Simple terminal UI with command input bar |
| `src/components/GitSidebar/index.tsx` | Placeholder — "Phase 2" |
| `src/components/AIPanel/index.tsx` | Placeholder — "Phase 2" |
| `src/components/InstallerWizard/index.tsx` | Full installer modal with per-tool status and install buttons |

### Modified

| File | Change |
|------|--------|
| `.gitignore` | Replaced 1367-line corrupted file with clean 29-line version |
| `Cargo.toml` | Already correct (workspace root referencing `src-tauri`) — no change needed |

### Not changed (legacy files kept for history)
- `Dockerfile` — kept; clearly labeled legacy in the codebase
- `vercel.json` — kept; clearly labeled legacy

---

## Current state

| Area | Status |
|------|--------|
| TypeScript build | ✅ `tsc --noEmit` passes with 0 errors |
| Vite production build | ✅ `pnpm build` succeeds — 173KB JS, 10KB CSS |
| Rust cargo check | ⏳ Running (pending VS Build Tools installation) |
| Tauri full build | ⏳ Blocked on VS Build Tools (`vs_BuildTools` installer actively running) |
| pnpm install | ✅ Clean, all 73 modules installed |
| fahh.mp3 | ⚠️ Placeholder (427-byte silent MP3) — needs real audio |

---

## Tests run and results

### Automated

| Test | Command | Result |
|------|---------|--------|
| TypeScript type check | `pnpm exec tsc --noEmit` | ✅ PASS — 0 errors |
| Vite production build | `pnpm build` | ✅ PASS — 73 modules, dist/ generated |
| Rust cargo check | `cargo check` | ⏳ Running at handoff time |
| Frontend unit tests | `pnpm test` | ⚠️ No test files yet (Vitest configured, no `*.test.tsx` files written) |

### Manual / exploratory

Cannot run the full Tauri app headlessly (requires a display + MSVC linker). The frontend UI was verified by:
- Vite build completing without errors or missing module errors
- All React component imports resolve correctly (confirmed by TypeScript passing)
- Tailwind class names validated (no custom-plugin errors)
- All Tauri `invoke()` calls typed against `src/lib/types.ts` (matches Rust command signatures)

---

## Known issues and limitations

1. **fahh.mp3 is a silent placeholder.** The 427-byte file is a valid MP3 that will play silently. A real audio file (the "fahh" sound effect) needs to be placed at `src-tauri/assets/fahh.mp3`. The filename must stay exactly as-is.

2. **VS Build Tools not yet installed.** The installer (`vs_BuildTools`) was actively running at handoff. Once it completes, `cargo build` and `pnpm tauri dev` will work. The TypeScript/Vite side is fully buildable independently.

3. **Tauri CLI installed via npm only.** `@tauri-apps/cli` is the npm wrapper. `cargo install tauri-cli` failed without MSVC. Both are functional — npm CLI works for `pnpm tauri dev/build`.

4. **No unit tests written.** Vitest is configured and `pnpm test` runs, but there are no `*.test.tsx` files yet. This is Phase 1 scope; tests are noted as a next step.

5. **Terminal uses simple output buffering, not a real PTY.** The terminal panel runs commands via Tauri's `execute_command` and shows stdout/stderr after completion. True interactive PTY (for tools like `vim`, `python -i`, long-running `cargo build`) requires Phase 2 work with `tauri-plugin-shell` sidecar or `portable-pty`.

6. **LSP integration is stubbed.** `src-tauri/src/core/lsp.rs` detects available language servers on PATH but does not yet connect to them. Monaco's built-in syntax highlighting works; hover/completion/diagnostics require Phase 2 LSP wiring.

7. **Git sidebar and AI panel are Phase 2 placeholders.** Both components render a "Phase 2" notice.

8. **`Dockerfile` and `vercel.json` are legacy artifacts.** They are not used and should be removed when the team confirms they're not needed.

---

## Next exact steps

1. **Wait for VS Build Tools to finish**, then run:
   ```bash
   cargo check              # verify Rust compiles
   pnpm tauri dev           # launch the IDE
   ```

2. **Replace `src-tauri/assets/fahh.mp3`** with the real sound effect. Keep the exact filename `fahh.mp3`.

3. **Test the full app** once Tauri dev runs:
   - Open a folder via the file tree
   - Open files, edit, save (Ctrl+S)
   - Run a terminal command
   - Trigger the Fahh SFX by calling the Rust `error_detector` manually from the devtools console

4. **Write unit and integration tests:**
   ```bash
   # Frontend: add *.test.tsx files using Vitest + @testing-library/react
   # Rust: add #[cfg(test)] mod tests blocks in each core/*.rs file
   ```

5. **Wire LSP into the editor** (Phase 2):
   - Start the detected language server as a Tauri sidecar
   - Bridge LSP JSON-RPC to Monaco's `MonacoLanguageClient`
   - Forward LSP error diagnostics to `error_detector.rs`

6. **Implement the real terminal PTY** (Phase 2):
   - Add `portable-pty` crate to `src-tauri/Cargo.toml`
   - Replace `execute_command` with a streaming PTY session
   - Wire xterm.js in the frontend (currently uses the simple text UI)

7. **Git sidebar** (Phase 2):
   - Add `gitoxide` crate
   - Implement `git_status`, `git_diff`, `git_commit` Tauri commands
   - Build the `GitSidebar` component

8. **AI panel** (Phase 2):
   - Read available MCP servers from `~/.fahh/config.json`
   - Implement `AIPanel` with an MCP client connection

9. **Remove legacy files** once confirmed not needed:
   ```bash
   git rm Dockerfile vercel.json
   ```

10. **Merge PR** after reviewer approval and Rust build confirmation.
