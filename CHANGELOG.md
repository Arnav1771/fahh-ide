# Changelog

All notable changes to Fahh Editor are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

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
