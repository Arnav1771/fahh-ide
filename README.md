# Fahh Editor

> A spatial AI code editor with loud opinions. Built with Tauri 2, Rust, Monaco, and React.

**[Download v0.6.5](https://github.com/Arnav1771/fahh-ide/releases/tag/v0.6.5)** · **[Website](https://fahhide.duckdns.org)** · **[Wiki Docs](https://github.com/Arnav1771/fahh-ide/wiki)** · **[Playground](https://fahhide.duckdns.org/play.html)**

---

## The Core Philosophy

Every time your code has an LSP error or build failure, Fahh Editor plays `fahh.mp3`. It has a strict 3-second cooldown window so 40 cascading errors trigger exactly one sound.

Coupled with a **2D infinite spatial canvas**, the **Fahh Local coding agent**, **VS Code Multi-Terminal Split View**, **File Icon Themes**, and **Monaco Error Lens**, Fahh Editor is designed for hyper-focused, joyful developer flow.

---

## Download v0.6.5

| Platform | Installer | Size |
|----------|-----------|------|
| Windows 10/11 (x64) | [Fahh.Editor_0.6.5_x64-setup.exe](https://github.com/Arnav1771/fahh-ide/releases/download/v0.6.5/Fahh.Editor_0.6.5_x64-setup.exe) | ~6.1MB |
| Windows (MSI) | [Fahh.Editor_0.6.5_x64_en-US.msi](https://github.com/Arnav1771/fahh-ide/releases/download/v0.6.5/Fahh.Editor_0.6.5_x64_en-US.msi) | ~7.8MB |
| macOS (Apple Silicon) | [Fahh.Editor_0.6.5_aarch64.dmg](https://github.com/Arnav1771/fahh-ide/releases/download/v0.6.5/Fahh.Editor_0.6.5_aarch64.dmg) | ~7.5MB |
| macOS (Intel) | [Fahh.Editor_0.6.5_x64.dmg](https://github.com/Arnav1771/fahh-ide/releases/download/v0.6.5/Fahh.Editor_0.6.5_x64.dmg) | ~7.6MB |
| Linux (AppImage) | [Fahh.Editor_0.6.5_amd64.AppImage](https://github.com/Arnav1771/fahh-ide/releases/download/v0.6.5/Fahh.Editor_0.6.5_amd64.AppImage) | ~83MB |
| Linux (Debian/Ubuntu) | [Fahh.Editor_0.6.5_amd64.deb](https://github.com/Arnav1771/fahh-ide/releases/download/v0.6.5/Fahh.Editor_0.6.5_amd64.deb) | ~7.9MB |
| Linux (Fedora/RHEL) | [Fahh.Editor-0.6.5-1.x86_64.rpm](https://github.com/Arnav1771/fahh-ide/releases/download/v0.6.5/Fahh.Editor-0.6.5-1.x86_64.rpm) | ~7.9MB |

> **Native Performance**: Built on Tauri 2 with native OS web engines (WebView2 on Windows, WebKitGTK on Linux, WebKit on macOS). Not Electron — 10× lighter memory footprint and instant startup.

---

## What's in Fahh Editor v0.6.5

| Capability | Hotkey / Status | What It Does |
|------------|-----------------|--------------|
| **CATE Spatial Canvas** | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> | Infinite 2D zooming canvas with 1:1 crisp focus, camera centering, readability toolbar (`Wrap`, `Map`, font stepper 12-28px, <kbd>Alt</kbd>+<kbd>1</kbd>), floating traffic-light window nodes, and radar Minimap with teleport shortcuts. |
| **Fahh Local Agent** | <kbd>Ctrl</kbd>+<kbd>L</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> | Autonomous coding agent with FIFO prompt queueing, real-time mid-turn steering (<kbd>Ctrl</kbd>+<kbd>Enter</kbd>), syntax-highlighted code containers, 1-click clipboard copy, and Monaco caret insertion. |
| **Workspace Search & Replace** | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> | Full-workspace text and regex search with case-sensitivity, whole-word matching, glob inclusions/exclusions, and batch multi-file replace. |
| **Auto-Save & Workspace Portability** | Native Menu / <kbd>Ctrl</kbd>+<kbd>S</kbd> | Debounced 1000ms background saving, window blur persistence, and portable `.fahh-workspace` configuration export and import. |
| **VS Code Multi-Terminal & Split View** | <kbd>Ctrl</kbd>+<kbd>\`</kbd> / <kbd>Ctrl</kbd>+<kbd>\\</kbd> | Multi-tab terminal manager with side-by-side / stacked split panes, shell switcher (PowerShell, CMD, Git Bash, WSL), status dots, and one-click split toggles. |
| **File Icon Themes** | Themes tab | Colourful Material Icon Theme icons (MIT, vendored subset) in the explorer, tabs, breadcrumbs, Quick Open and search; Fahh Colour and Minimal line-glyph alternatives. |
| **Native PDF & Media Preview** | Built-in | Native WebView2-accelerated PDF viewer with zoom controls, text selection, page navigation, and system reader handoff without third-party extensions. |
| **Multi-Window Support** | `fahh <folder>` / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> | Open and manage multiple distinct projects in independent Fahh Editor windows simultaneously without replacing active workspaces. |
| **`@` Mentions** | Type `@` in the Fahh Local prompt | Popover that inserts a reference (`@problems`, `@terminal`, `@git`, `@codebase`, or a workspace file) into the prompt. |
| **Monaco Error Lens** | Built-in | Inline colored diagnostics drawn directly at the tail of offending code lines — no mouse hovering required. |
| **AI Conventional Commits** | Git Sidebar | One-click synthesis of structured Conventional Commits (`feat`, `fix`, `test`, `docs`) from staged diffs. |
| **Open VSX Marketplace** | Extensions tab | Browse, search, and install from 50,000+ community extensions with detail drawer, direct `.vsix` download links, and native feature callouts. |
| **The Fahh SFX Engine** | Built-in | Audible feedback on compile/LSP errors, Python and Rust syntax errors (no language server needed), and crashed runs, with a strict 3000ms cooldown window. |
| **Tabs & Navigation** | <kbd>Ctrl</kbd>+<kbd>Tab</kbd> / <kbd>Alt</kbd>+<kbd>←</kbd> | Drag to reorder, middle-click to close, right-click for Close Others / to the Right / All, Copy Path, Reveal in File Explorer; recently-used tab cycling, Reopen Closed Tab (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>), back / forward history. |
| **Open Recent & Session Restore** | File > Open Recent | The last 10 folders and workspaces; at launch the last one reopens with its tabs back in their dock groups (can be turned off). |
| **Settings** | <kbd>Ctrl</kbd>+<kbd>,</kbd> | Font, size, wrap, minimap, line numbers, tab size, auto save, fahh volume and lifetime count, terminal font size; applied live to every editor. |
| **Desktop Shell** | Native | Native desktop MenuBar, file symbol breadcrumbs, unbuffered Python runner, bottom dock (Problems, Debug Console, Terminal, Run). |

**Removed after v0.6.3:** Composer (Ctrl+I), Inline Edit (Ctrl+K), ghost-text completions, REA Code Analysis, the Ports and Output panels, the terminal "Fix with AI" button and terminal image paste (Alt+V). They were simulated: canned templates behind a timer, hard-coded sample data, or text placeholders, with no real model or data behind them. The real AI feature is Fahh Local (below). Ctrl+K and Ctrl+I go back to Monaco, and Ctrl+W / Ctrl+N now close the tab (asking first if unsaved) and open a new file.

---

## First run

No account, no signup: everything stays on your machine. The first launch opens a short tour over the real editor, five steps, each one a thing to do (every step has Skip, and so does the whole tour):

1. **Sound:** ring the bell, set the volume or mute, and keep the fahh or pick your own sound file.
2. **Code:** Open Folder, Open Recent, or a VS Code `.code-workspace` (WSL folders work on Windows). Or break the one-line try-it box and hear it.
3. **Look:** Fahh Gold, Fahh Dark or Fahh Light, applied as you click; move Explorer to the right and back. Drag any view anywhere; View > Reset Layout undoes it.
4. **Fahh Local** (optional): pick a provider, paste a key, Test connection.
5. **Check Setup:** git, Python, Node, cargo, WSL and the language servers, with versions or the install command for what is missing. Plus the once-a-day update check (Settings > Updates turns it off).

It shows once. **Help > Welcome** brings it back; **Help > Check Setup…** (or "Fahh: Check Setup" in the palette) reruns the check any time.

---

## Try it without installing

**[play.fahh →](https://arnav1771.github.io/fahh-ide/play.html)**

Real Python, JavaScript, and TypeScript execution in your browser via Pyodide. No install. Includes the FAHHHH sound effect on errors.

---

## Development setup

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust + Cargo | 1.78+ | `winget install Rustlang.Rustup` |
| Node.js | 20+ | `winget install OpenJS.NodeJS` |
| pnpm | 9+ | `npm install -g pnpm` |
| VS Build Tools (Windows) | 2022 | See below |

**Windows — VS Build Tools (required for Rust compilation):**
```powershell
# Run as Administrator
winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

**Linux:**
```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libssl-dev librsvg2-dev patchelf libayatana-appindicator3-dev build-essential
```

### Run

```bash
git clone https://github.com/Arnav1771/fahh-ide.git
cd fahh-ide
pnpm install
pnpm tauri dev        # full IDE with Rust backend + hot reload
# or
pnpm dev              # frontend only at http://localhost:1420
```

### Build release

```bash
pnpm tauri build
# Output: src-tauri/target/release/bundle/
```

### Tests

```bash
pnpm exec tsc --noEmit    # type check
pnpm test                 # 261 unit tests across 30 suites
cd src-tauri && cargo clippy -- -D warnings && cargo test
```

The vitest suite covers the CATE Spatial Canvas zoom/pan store, Monaco Error Lens diagnostics,
the unsaved-tab guard, the Fahh Local agent state, the SFX cooldown rule, LSP marker bridges,
and native Tauri IPC wrappers.

---

## Fahh Local (AI agent)

Fahh Editor ships with **no AI provider and no API key**. The robot icon opens
Fahh Local, a coding agent that runs on your machine with your own key: chat,
a card per tool call (read, search, edit, run), approvals you can edit before
a command runs, per-file diff review and "revert turn". Modes: **Ask** (approve
every edit and command), **Auto-edit** (edits apply, commands still ask),
**Plan** (read-only; writes `.fahh/plans/<id>.md`, then an Implement button).

| Provider | Base URL |
|----------|----------|
| Groq | `https://api.groq.com/openai/v1` |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Ollama | `http://localhost:11434/v1` |
| Anthropic | `https://api.anthropic.com` |

The key is kept in the app's `localStorage` and sent only to the provider; it is
never written into your project. Rules live per project in
`.fahh/permissions.json` (deny always wins), project instructions in
`AGENTS.md` or `.fahh/rules.md`. Details: [IMP_DOCS/FAHH_LOCAL.md](IMP_DOCS/FAHH_LOCAL.md).

From a terminal: `fahh-agent --provider groq --mode auto-edit "add a test for foo"`
(keys from `GROQ_API_KEY`, `GEMINI_API_KEY`, `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`,
`ANTHROPIC_API_KEY`); no prompt starts a REPL.

### Run in WSL (Ubuntu)

```bash
wsl -d Ubuntu -u root bash -c "
  apt-get install -y libwebkit2gtk-4.1-dev libssl-dev librsvg2-dev patchelf libayatana-appindicator3-dev build-essential curl git gstreamer1.0-plugins-good gstreamer1.0-libav
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && apt-get install -y nodejs
  npm install -g pnpm && cargo install tauri-cli --version '^2' --locked
  git clone https://github.com/Arnav1771/fahh-ide.git /root/fahh-ide
  cd /root/fahh-ide && pnpm install
  DISPLAY=:0 pnpm tauri dev
"
```

---

## The Fahh SFX

`src-tauri/assets/fahh.mp3` — **never rename it.**

Plays when:
- LSP diagnostic error appears in the open file
- Build task fails

Has a 3-second atomic cooldown. Configurable in `~/.fahh/config.json`:
```json
{ "sfx_cooldown_secs": 5 }
```

### What ships in the repo

The bundled `fahh.mp3` is **a synthesized stand-in, not the meme clip.** It is a
two-tone descending blip generated with ffmpeg — no copyrighted audio is
committed to this repository. Measured with `ffmpeg -af volumedetect`:

| Property | Value |
|----------|-------|
| Duration | 0.470 s |
| mean_volume | -6.3 dB |
| max_volume | -1.2 dB |
| Encoding | mono, 44.1 kHz, 128 kbps MP3 (~8 KB) |

It is genuinely audible — it is there so the signature feature is demonstrably
working out of the box, not so it sounds like the meme.

### Swapping in your own sound

**In the app:** Settings > Fahh > Error sound > Change sound… (also step 1 of the welcome tour). Any mp3, wav, ogg or m4a up to 5 MB; Fahh keeps its own copy, and Reset to default brings the fahh back.

**In a build of your own,** drop your clip over the bundled one:

```bash
cp /path/to/your-sound.mp3 src-tauri/assets/fahh.mp3
pnpm tauri dev     # or `pnpm tauri build` for a release bundle
```

Rules:

- The filename **must stay `fahh.mp3`** — it is referenced by
  `src-tauri/tauri.conf.json` (resource bundling) and `src/lib/fahh.ts`
  (`resolveResource("assets/fahh.mp3")`).
- It must be a real MP3 the WebView can decode (`decodeAudioData`); mono or
  stereo, any sample rate.
- Keep it short. Anything over ~2 s overlaps itself on repeated errors — the
  3-second cooldown is the only thing spacing playbacks out.
- If the file fails to decode, `src/lib/fahh.ts` logs a warning and the editor
  keeps working silently; it does not crash.

To regenerate the stand-in tone from scratch, see the ffmpeg invocation
recorded in `docs/FAHH_SFX.md`.

---

## Config file

Stored at `~/.fahh/config.json`, auto-created on first run:
```json
{
  "sfx_cooldown_secs": 3,
  "last_workspace": "/path/to/project",
  "installed_tools": ["gh", "claude"],
  "theme": "fahh-dark"
}
```

---

## Documentation

| Doc | Contents |
|-----|---------|
| [IMP_DOCS/HANDOFF.md](IMP_DOCS/HANDOFF.md) | Full project state, what works, next steps |
| [IMP_DOCS/TECH_SPEC.md](IMP_DOCS/TECH_SPEC.md) | Architecture, all Tauri commands, data flows |
| [IMP_DOCS/PROMPT_TRAIL.md](IMP_DOCS/PROMPT_TRAIL.md) | Every decision and lesson from the build session |
| [IMP_DOCS/STARTER_PROMPT.md](IMP_DOCS/STARTER_PROMPT.md) | Copy-paste prompt to onboard any AI model |
| [IMP_DOCS/CANARY_RESULTS/](IMP_DOCS/CANARY_RESULTS/) | E2E verification reports (17/17 passing) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Tech stack and design decisions |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
| [CLAUDE.md](CLAUDE.md) | Guide for AI agents working in this repo |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome.

The project follows [Conventional Commits](https://www.conventionalcommits.org/). CI runs TypeScript check, Vite build, and Rust clippy on every push.

---

## License

MIT
