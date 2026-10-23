# Changelog

All notable changes to Fahh Editor are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added

- **Dockable layout** (dockview 8.5.1): drag Explorer, Search, Source Control, Extensions, Colour Theme, Fahh Local, Problems, Debug Console, Terminal and Run to the left or right side bar, the bottom panel, or the editor area as tabs.
- **Editor splits:** Split Editor Right (Ctrl+\) and Split Editor Down; drag tabs between groups. A file open twice shares one model.
- The layout is **saved per workspace** and restored on launch; **View > Reset Layout** brings back the default (Explorer left, Fahh Local right, panel below).
- Keyboard path for every drag: palette commands "Move <view> to Left Side Bar / Right Side Bar / Panel / Editor Area", plus Toggle Primary / Secondary Side Bar (Ctrl+B / Ctrl+Alt+B) and Toggle Maximized Panel.

### Added (Fahh Local)

- **Sessions**, saved after every step per workspace with their checkpoints: new (**+**, `/clear`), list and switch (clock button, `/ls`, `/resume`, `/continue`), rename (`/title`), delete (**Delete** in the list, `/rm-session`), plus `/steps`, `/fork`, `/revert <step>`, `/undo`, `/export`, `/compact`, `/context`, `/usage`.
- **Modes**: Normal (Ask), Accept Edits, Smart (a judge model screens commands), Plan, Bypass (red badge; deny rules still apply), and one-shot `/ask`.
- **Slash commands**: a `/` menu in the panel and the same commands in the `fahh-agent` REPL, from one table (`src/lib/slash-commands.json`).
- **`/loop <prompt>`**: run, then a reviewer subagent checks the diff and asks for fixes until it approves (3 rounds by default); one step, one `/revert`.
- **Subagents**: `.fahh/agents/*.md` and `~/.fahh/agents/*.md` definitions plus built-in `explore`, `reviewer`, `planner`; a `delegate` tool, `/agents`, `/agent <name> <task>`, per-child Stop, never more permission than the parent.
- `fahh-agent` CLI: `-c`, `-r <id>`, `-p`, `--prompt-file`, `--config`, `--export`, `--fast-model`, `--judge-model`, `models list`, `sessions ls`; bundled next to the editor (`scripts/prepare-sidecar.mjs`).
- `Ctrl+Shift+A` toggles the panel everywhere; `Ctrl+L` too, except in the editor (select line) and terminal (clear).
- A run-status line built from the turn's events (running subagent or tool, or waiting for the model).

### Fixed

- The agent's `get_diagnostics`, the "fahh when the agent adds errors" check and the selection context were always empty: `window.monaco` was never set. `monaco-setup.ts` sets it now.
- Steer (`Ctrl+Enter` while running) waited a fixed 150 ms after Stop and could hit "the agent is already working on a turn"; it now sends once the turn has really ended.
- `core::debugger::tests::free_port_is_actually_free` was flaky: a parallel test could take the released port before the rebind. It now retries.

### Removed (simulated)

- **Alt+V / paste image in the agent panel**: it only typed `[Image: name attached]` into the prompt. No provider path here sends images, so the model never saw one.
- The fixed **"Devin Task Execution Loop / analyzing AST"** banner shown while the agent ran (replaced by the real run-status line).

---

## [0.6.4] — 2026-10-22

### Added

- **Jupyter notebooks (.ipynb)** open in a read-only viewer: markdown, highlighted code, outputs, images, errors (#78).
- **Real file icons** (Material Icon Theme subset, MIT) in the explorer, tabs, breadcrumbs, Quick Open and search, with light-theme variants. Installing an extension no longer switches the icon theme (#79).
- **VS Code workspaces:** `.code-workspace` loads with JSONC, relative folders, `vscode-remote://wsl+` / `file://` URIs and `files.autoSave`; `fahh x.code-workspace` works (#77).
- `test-build.yml`: push `testbuild/*` to get installers for every platform without a release (#77).

### Fixed (Windows / WSL, #77)

- Terminal in a `\\wsl.localhost\...` folder runs in WSL in that folder (it used to run in `C:\Windows`); `cd` keeps working in every shell.
- Run on files in WSL runs inside the distro instead of failing with `os error 267`.
- **+ Shell** (PowerShell / Command Prompt / Bash-WSL) really switches shell.
- New windows (`fahh-win-*`) get the same permissions as the main window.
- Open Folder opens one dialog and reports failures.


### Removed (simulated features)

These looked like features but had nothing behind them, so they are gone rather than kept as demos:

- **Composer (Ctrl+I)**: a timer that wrote canned keyword templates into files. Removed with its store, menu item, palette command and the agent-panel button.
- **Inline Edit (Ctrl+K)**: same canned output. Ctrl+K is no longer captured, so Monaco's Ctrl+K chords work again.
- **Ghost text**: a fixed list of snippets offered as "predictions".
- **REA Code Analysis**: the activity-bar panel, View menu entry, palette command and canvas node. Saved canvas layouts drop the old REA node on load.
- **Ports and Output panels**: hard-coded sample ports and seeded log lines.
- **Terminal "Fix with AI"**: it opened the fake Composer. The agent panel has no way to take a prefilled prompt, so the button is gone; paste the error into Fahh Local instead.
- **Terminal image paste (Alt+V)**: it typed `[Image: name]` into the command line.

### Fixed

- Close Tab, Close All Tabs and the palette's Close Active Tab now ask before discarding unsaved changes, like the tab's own close button. The store's unguarded `closeTab` is removed, so every close goes through `requestClose`.
- Ctrl+W closes the active tab (guarded) and Ctrl+N opens a new untitled file; both were shown in menus but did nothing. The Ctrl+B label is removed (there is no sidebar-hide state).

### Fixed earlier (v0.5.1 "stop losing work", shipped in v0.6.x, recorded late)

- No console window flashes on Windows: every child process is started through `core::proc::cmd`, and CI rejects a bare `Command::new(`.
- Themes paint their own editor background (Fahh Light is readable again).
- Unsaved work is guarded: closing a dirty tab or the window asks first, and the dirty dot clears when undo returns to the saved text.
- Ctrl+S saves from anywhere (explorer, terminal, panels) and shows a toast; a failed save says so.
- Renaming or deleting a file in the explorer keeps its open tab in step (a dirty file asks before it is deleted).
- Focus: the terminal no longer traps Tab (Esc returns to the editor), dialogs trap focus and give it back, Esc closes Optional Tools.
- The sidebar and bottom panel can be dragged (or resized with the arrow keys) and remember their size.
- Terminal: header shows the shell, Up/Down history, Clear (button, Ctrl+L, `clear`).
- Title screen scrolls instead of clipping; the status bar drops low-priority items on narrow windows.

### Added

- **`fahh` command.** `fahh .`, `fahh <folder>`, `fahh <file>[:line]` from any shell, relative to that shell's folder. See docs/FAHH_COMMAND.md.

---

## [0.6.3] — 2026-10-20

### Fixed

- Python and Rust errors are no longer silent without a language server: syntax errors underline, show in Error Lens and play the fahh (Rust via `syn`, Python via your installed interpreter, compiled but never run). The check steps aside once pylsp or rust-analyzer is ready.
- A run that exits with an error now plays the fahh; stopping a run does not.
- Ctrl+L inside the editor selects the line again; Ctrl+Shift+A still toggles Fahh Local everywhere.
- CI on main is green again (clippy).
- Release notes come from `release-notes/<tag>.md` (or are generated from merged PRs) instead of repeating the v0.5.0 text.

### Changed

- The version shown in the app (status bar, menu bar, canvas, About) comes from `package.json`, so it can no longer drift.

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
