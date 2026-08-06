# Fahh Editor

> A cross-platform desktop IDE that plays a sound every time your code has an error. Built with Tauri 2, Rust, and React.

**[Download v0.3.0](https://github.com/Arnav1771/fahh-ide/releases/latest)** · **[Try it in the browser](https://arnav1771.github.io/fahh-ide/play.html)** · **[Docs](https://arnav1771.github.io/fahh-ide/docs.html)**

---

## The one feature

Every time your code has an LSP error or build failure, Fahh Editor plays `fahh.mp3`. It has a 3-second cooldown. You can't remove it.

---

## Download

| Platform | Installer | Size |
|----------|-----------|------|
| Windows 10/11 (x64) | [Fahh.Editor_0.3.0_x64-setup.exe](https://github.com/Arnav1771/fahh-ide/releases/download/v0.3.0/Fahh.Editor_0.3.0_x64-setup.exe) | ~3MB |
| Windows (MSI) | [Fahh.Editor_0.3.0_x64_en-US.msi](https://github.com/Arnav1771/fahh-ide/releases/download/v0.3.0/Fahh.Editor_0.3.0_x64_en-US.msi) | ~4.5MB |
| macOS (Apple Silicon) | [Fahh.Editor_0.3.0_aarch64.dmg](https://github.com/Arnav1771/fahh-ide/releases/download/v0.3.0/Fahh.Editor_0.3.0_aarch64.dmg) | ~4.5MB |
| macOS (Intel) | [Fahh.Editor_0.3.0_x64.dmg](https://github.com/Arnav1771/fahh-ide/releases/download/v0.3.0/Fahh.Editor_0.3.0_x64.dmg) | ~4.6MB |
| Linux (AppImage) | [Fahh.Editor_0.3.0_amd64.AppImage](https://github.com/Arnav1771/fahh-ide/releases/download/v0.3.0/Fahh.Editor_0.3.0_amd64.AppImage) | ~79MB |
| Linux (Debian/Ubuntu) | [Fahh.Editor_0.3.0_amd64.deb](https://github.com/Arnav1771/fahh-ide/releases/download/v0.3.0/Fahh.Editor_0.3.0_amd64.deb) | ~5MB |

> **Windows**: The installer is small (3MB) because it uses the system WebView2 runtime pre-installed on Windows 10/11. Not Electron — 10× smaller binary.

---

## What works in v0.3.0

| Feature | Status |
|---------|--------|
| Monaco editor (VS Code engine) | ✅ Full syntax highlighting, 15+ languages, Ctrl+S save |
| File explorer | ✅ Open folder, recursive tree, depth-5, context menu (Rename/Delete/Copy Path) |
| New file creation | ✅ Click 📄 in explorer → inline name input |
| 5 built-in themes | ✅ Fahh Dark, Fahh Light, GitHub Dark, Dracula, Solarized Dark — Monaco syntax colors change |
| Terminal | ✅ Runs shell commands (`pip install`, `node`, `python`, etc.) |
| Run panel | ✅ One-click code execution for Python, JS, TS, Go, Rust, Java, C++ |
| Debug panel UI | ✅ Breakpoints, call stack, variables — DAP wiring in progress |
| Optional tools installer | ✅ n8n, Flowise, browser-use, GitHub CLI, Claude CLI |
| Right-click context menu | ✅ No browser Share/Reload — custom IDE menu only |
| F5 / Ctrl+R blocked | ✅ Page reload can't wipe your code |
| Task Manager name | ✅ Shows "Fahh Editor" not "WebView2 Gpu Process" |
| Cross-platform builds | ✅ Windows, macOS (arm64 + x64), Linux (AppImage/deb/rpm) |
| Fahh SFX | ✅ Wired and audible — ships a synthesized stand-in tone, swap in your own clip |
| LSP (completions/hover) | 🔧 Server detection works, Monaco wiring in Phase 2 |
| Step-through debugger | 🔧 DAP client exists, UI wiring in Phase 2 |
| Git sidebar | 🔧 Phase 2 |
| AI panel (MCP) | 🔧 Phase 2 |

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
