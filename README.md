# Fahh Editor

> A spatial AI code editor with loud opinions. Built with Tauri 2, Rust, Monaco, and React.

**[Download v0.6.2](https://github.com/Arnav1771/fahh-ide/releases/tag/v0.6.2)** · **[Website](https://fahhide.duckdns.org)** · **[Wiki Docs](https://github.com/Arnav1771/fahh-ide/wiki)** · **[Playground](https://fahhide.duckdns.org/play.html)**

---

## The Core Philosophy

Every time your code has an LSP error or build failure, Fahh Editor plays `fahh.mp3`. It has a strict 3-second cooldown window so 40 cascading errors trigger exactly one sound.

Coupled with a **2D infinite spatial canvas**, **Cursor-grade Composer**, **VS Code Multi-Terminal Split View**, **File Icon Themes**, and **Monaco Error Lens**, Fahh Editor is designed for hyper-focused, joyful developer flow.

---

## Download v0.6.2

| Platform | Installer | Size |
|----------|-----------|------|
| Windows 10/11 (x64) | [Fahh.Editor_0.6.2_x64-setup.exe](https://github.com/Arnav1771/fahh-ide/releases/download/v0.6.2/Fahh.Editor_0.6.2_x64-setup.exe) | ~6.1MB |
| Windows (MSI) | [Fahh.Editor_0.6.2_x64_en-US.msi](https://github.com/Arnav1771/fahh-ide/releases/download/v0.6.2/Fahh.Editor_0.6.2_x64_en-US.msi) | ~7.8MB |
| macOS (Apple Silicon) | [Fahh.Editor_0.6.2_aarch64.dmg](https://github.com/Arnav1771/fahh-ide/releases/download/v0.6.2/Fahh.Editor_0.6.2_aarch64.dmg) | ~7.5MB |
| macOS (Intel) | [Fahh.Editor_0.6.2_x64.dmg](https://github.com/Arnav1771/fahh-ide/releases/download/v0.6.2/Fahh.Editor_0.6.2_x64.dmg) | ~7.6MB |
| Linux (AppImage) | [Fahh.Editor_0.6.2_amd64.AppImage](https://github.com/Arnav1771/fahh-ide/releases/download/v0.6.2/Fahh.Editor_0.6.2_amd64.AppImage) | ~83MB |
| Linux (Debian/Ubuntu) | [Fahh.Editor_0.6.2_amd64.deb](https://github.com/Arnav1771/fahh-ide/releases/download/v0.6.2/Fahh.Editor_0.6.2_amd64.deb) | ~7.9MB |
| Linux (Fedora/RHEL) | [Fahh.Editor-0.6.2-1.x86_64.rpm](https://github.com/Arnav1771/fahh-ide/releases/download/v0.6.2/Fahh.Editor-0.6.2-1.x86_64.rpm) | ~7.9MB |

> **Native Performance**: Built on Tauri 2 with native OS web engines (WebView2 on Windows, WebKitGTK on Linux, WebKit on macOS). Not Electron — 10× lighter memory footprint and instant startup.

---

## What's in Fahh Editor v0.6.2

| Capability | Hotkey / Status | What It Does |
|------------|-----------------|--------------|
| **CATE Spatial Canvas** | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> | Infinite 2D zooming canvas with 1:1 crisp focus, camera centering, readability toolbar (`Wrap`, `Map`, font stepper 12-28px, <kbd>Alt</kbd>+<kbd>1</kbd>), floating traffic-light window nodes, and radar Minimap with teleport shortcuts. |
| **VS Code Multi-Terminal & Split View** | <kbd>Ctrl</kbd>+<kbd>\`</kbd> / <kbd>Ctrl</kbd>+<kbd>\\</kbd> | Multi-tab terminal manager with side-by-side / stacked split panes, shell switcher (PowerShell, CMD, Git Bash, WSL), status dots, and one-click split toggles. |
| **File Icon Themes** | Themes tab / Open VSX | Dynamic SVG file & folder icon engine supporting Material Icon Theme, Seti UI, Catppuccin Pastel, and Modern Minimal with auto-activation from Open VSX. |
| **Native PDF & Media Preview** | Built-in | Native WebView2-accelerated PDF viewer with zoom controls, text selection, page navigation, and system reader handoff without third-party extensions. |
| **Multi-Window Support** | `fahh <folder>` / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> | Open and manage multiple distinct projects in independent Fahh Editor windows simultaneously without replacing active workspaces. |
| **Cursor Composer** | <kbd>Ctrl</kbd>+<kbd>I</kbd> | Multi-file autonomous editing agent with dynamic file chips, side-by-side unified diff review, and batch Accept/Reject controls. |
| **Inline Edit** | <kbd>Ctrl</kbd>+<kbd>K</kbd> | Floating Monaco prompt pill for in-place code transformations with live diff previews. |
| **`@` Mentions Engine** | Type `@` in prompt | Context resolution popover dynamically attaching `@problems`, `@terminal`, `@git`, `@codebase`, and workspace files. |
| **Monaco Error Lens** | Built-in | Inline colored diagnostics drawn directly at the tail of offending code lines — no mouse hovering required. |
| **Predictive Ghost Text** | <kbd>Tab</kbd> to accept | Monaco inline completions provider predicting multi-line snippets ahead of the caret across 12+ languages. |
| **Terminal "Fix with AI"** | Hover stderr | One-click button on terminal errors automatically launching Composer with pre-attached terminal diagnostic context. |
| **AI Conventional Commits** | Git Sidebar | One-click synthesis of structured Conventional Commits (`feat`, `fix`, `test`, `docs`) from staged diffs. |
| **REA Code Analysis** | Activity Bar CPU | AST Symbol recovery, GNU `strings` binary string extractor with byte offsets, and 16-byte hex dump inspector. |
| **Open VSX Marketplace** | Extensions tab | Browse, search, and install from 50,000+ community extensions with detail drawer, direct `.vsix` download links, and native feature callouts. |
| **The Fahh SFX Engine** | Built-in | Audible feedback on compile/LSP errors with a strict 3000ms cooldown window. |
| **Desktop Shell** | Native | Native desktop MenuBar, file symbol breadcrumbs, unbuffered Python runner, multi-tab bottom dock. |

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
pnpm test                 # 243 unit tests across 26 suites
cd src-tauri && cargo clippy -- -D warnings && cargo test
```

The vitest suite covers the complete logic: Composer multi-file diffs and `@` mentions,
CATE Spatial Canvas zoom/pan store, Monaco Error Lens diagnostics, Ghost Text inline completions,
the SFX cooldown rule, LSP marker bridges, and native Tauri IPC wrappers.

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

Drop your own clip over the bundled one:

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
