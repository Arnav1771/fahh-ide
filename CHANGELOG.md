# Changelog

All notable changes to Fahh Editor are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [0.5.0] — 2026-10-08

### Also in this release (added 8 Oct)

- **Built-in browser.** Open any address as an editor tab: Command Palette → "Open Browser…" (type a port like `5173` or a URL), or click the dev-server address that appears in the status bar when the terminal or a run prints one ("Local: http://localhost:5173"). Address bar, reload, **Window** (its own Fahh window, for sites that refuse to be framed) and open-in-your-browser. The page keeps its own origin and cannot reach the editor.
- **Preview button labelled.** The tab-bar action now reads "Preview" / "Source" for Markdown, HTML, SVG and CSV files.
- **First-run welcome.** Three steps on first launch: errors make a sound, AI is optional, open a project; reopen with "Show Welcome".
- **AI Composer.** Code blocks in AI replies have Copy and "Apply to file" (asks first, replaces only that file's open tab, unsaved until Ctrl+S); context chips; an error auto-fix prompt; an LSP request/response correlator (not wired in yet).
- **Contributor setup.** Issue and PR templates, CONTRIBUTING with pnpm and cargo, a welcome message on new PRs.

### Earlier 0.5.0 work (2 Oct)

Tested end to end as the real desktop app in WSL. The tools were tauri-driver and WebKitWebDriver, against the real Rust backend, real files and real processes. That run found the bugs fixed below. Then a programmer's session, done entirely in the Fahh window, pushed a project to GitHub: [Arnav1771/fahh-hello](https://github.com/Arnav1771/fahh-hello).

### Added

**Previews, modelled on VS Code** (`markdown-language-features`, `media-preview`)
- **Shortcuts:** Ctrl+K V opens the preview beside the editor; Ctrl+Shift+V swaps the editor for the preview. The same actions sit at the right of the tab bar.
- **Markdown:**
  - Live as you type, and scroll sync follows the editor's top line.
  - Double-click a block to jump to its source line.
  - Relative images load from disk.
  - Links open in the browser, or in the editor for local files.
  - Rendered with markdown-it with raw HTML off, sanitised with DOMPurify, in a shadow root.
- **HTML:**
  - Rendered in a sandboxed frame that can never reach the editor (no `allow-same-origin`).
  - Scripts are off until you allow them for that file.
  - The page's own CSS and images load.
- **Images** (PNG, JPEG, GIF, WebP, …):
  - Open straight into the viewer instead of as garbled text.
  - Fit or 100%; click to zoom in, Ctrl+click to zoom out, Ctrl+wheel to zoom.
  - Pixelated from 3×.
  - Dimensions and file size are shown.
- **SVG:** previews beside its source, live.
- **CSV/TSV:** shown as a table, with quoted fields handled.
- **Local files and the asset protocol:** previews load local files through Tauri's asset protocol. It starts with an empty scope, and only the folder you opened (or the opened file's folder) is allowed, like VS Code's `localResourceRoots`.

**Editor**
- **Quick Open (Ctrl+P):** fuzzy-find any file in the opened folder. Build output folders are skipped. Ctrl+P no longer opens the print dialog.

**Terminal**
- **`cd` sticks:** `mkdir hello && cd hello`, then `git init`, now initialises `hello`. Every command used to run in the folder the terminal started in. The prompt shows where you are.
- **`fahh .` / `fahh <folder>`:** opens a folder in the explorer from the terminal, like VS Code's `code .`.

**Status bar**
- **Language-server status item:** shows "rust ✓", or "rust ✕" with the reason on hover.

### Fixed
- **Debugging connected to the wrong program.** Adapters had fixed ports (debugpy 5678, node 9229, dlv 2345, lldb-dap 4711), and 5678 is n8n's default. With n8n running, Start Debug connected to n8n's web server and reported a session that did not exist. Each session now gets a free port.
- **A missing debug adapter now fails fast, with how to install it** (for example `python3 -m pip install debugpy`). It used to wait 10 s, or worse. The Debug panel now says why; before, the reason only went to the developer console. An adapter that never answers is killed instead of left running.
- **The Run panel hung on fast programs.** A script that printed and exited before `run_file` returned its pid lost its output and stayed on "● Running" forever. Events are now buffered until the pid is known and then replayed (`lib/runEvents.ts`).
- **A language server that died at start was reported as running.** Every keystroke then logged "Broken pipe". For example, `rust-analyzer` is a rustup shim until the component is installed. The start is now checked, and the server's own error is shown. The opened folder is now the language server's workspace, not the file's parent folder.
- **Drop-downs were unreadable on Linux.** WebKitGTK drew `<select>` as a white GTK box with the theme's light text on it.

### Tests
- 184 unit tests (28 new) and 17 Rust tests (7 new).
- A native end-to-end suite of 108 checks on the real app:
  - every backend command;
  - every panel;
  - rust-analyzer diagnostics turning into a fahh;
  - the AI chat against a local Ollama;
  - restart persistence.
- A native preview and Quick Open suite (24 checks).
- Two recorded programmer sessions, 19 and 25 checks, pushing to GitHub entirely from the Fahh window.

---

## [0.4.0] — 2026-10-02

The fahh you can see. Researched against Cursor, Windsurf, Zed, VS Code and
JetBrains (2025–26): every one of them treats sound as a quiet accessibility
signal. Fahh makes the error moment the identity, and borrows their rules for
keeping it bearable: react to transitions, never cover the code, one-click mute.

### Added
- **The fahh moment.** When the error count in the file you are editing goes up:
  - the editor region shakes for 280 ms;
  - a red edge glow fades in and out;
  - the first error line pulses;
  - a **FAHH** chip slams in the corner, clear of the minimap and never over the code.
- **Combos.** Repeat errors within 12 s count up (**FAHH ×2, ×3…**), and each one sounds a little louder and lower.
- **Clean.** Fixing the last error plays a soft two-note chime, shows a **CLEAN** chip and runs a gold sweep along the status bar.
- **Intensity: Epic / Subtle / Off,** and a mute button.
  - Both are in the status bar and the command palette, and both are remembered.
  - Under `prefers-reduced-motion`, Epic steps down to Subtle.
- **Status-bar HUD.**
  - Live error and warning counts for the file on screen; click them to jump to the next problem.
  - A clean-streak timer, the live combo and the session fahh count.
  - It replaces the old "● Fahh Editor" dot, which was always green.
- **Command palette** (Ctrl+Shift+P or F1).
  - Every panel, all six themes, next/previous problem, the fahh settings and optional tools.
  - Fuzzy search, keycap hints, recently used first.
- **Title screen** in place of "Open a file to start editing":
  - the FAHH wordmark;
  - a bell that rings the fahh on purpose;
  - the main actions with their shortcuts.

### Fixed
- **Monaco's own checkers never triggered the fahh.** TypeScript, JavaScript, JSON, CSS and HTML errors showed squiggles but made no sound; only language-server diagnostics did. All markers now feed one engine, which applies one cooldown, so a single burst of errors is still one fahh.
- **Every JSX tag and import in a .tsx file was flagged as an error.** Each file now gets its own Monaco model with its real extension, and JSX parses. The import and typing errors that come from not seeing `node_modules` are ignored. A side benefit: each tab keeps its own undo history.
- **Opening a broken file no longer fahhs.** Only errors you introduce by typing count.
- **The browser preview could not play the sound.** The bundled `fahh.mp3` is now the fallback when the Tauri resource is unavailable.

### Tests
- 156 unit tests (15 new: the fahh engine, palette search, model paths, editor actions).
- 27-check browser run of the new flows; theme suite 21/21; smoke test 24/24.

---

## [Unreleased]

### Added
- Initial Rust backend foundation (editor, workspace, terminal, LSP, plugin, state, runtime, quality)
- `fahhhh.mp3` asset — the core Fahh SFX sound file
- Architecture SVG diagram

---

## [0.1.0] — upcoming

### Planned
- Tauri 2 app shell with React 18 + TypeScript frontend
- Monaco Editor integration with tab management
- xterm.js integrated terminal
- Fahh SFX system: LSP error detection + audio playback
- File tree sidebar with live file watching
- First-run optional tools installer wizard (n8n, browser-use, Flowise, CLIs)
- Basic LSP client wired to diagnostics panel
- Git sidebar (status, stage, commit, branch switcher)
- Settings panel with Fahh SFX toggle and cooldown config
- MCP-based AI panel

---

[Unreleased]: https://github.com/Arnav1771/fahh-ide/compare/HEAD...HEAD
