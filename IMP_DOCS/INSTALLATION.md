# Fahh Editor — Installation Guide

**Version:** v0.3.0  
**Last updated:** 2026-06-28  
**Download page:** https://arnav1771.github.io/fahh-ide/download.html  
**Landing page:** https://arnav1771.github.io/fahh-ide/  
**Web IDE (try without installing):** https://arnav1771.github.io/fahh-ide/play.html  
**GitHub Releases:** https://github.com/Arnav1771/fahh-ide/releases/tag/v0.3.0

---

## Option A: Install the release binary (recommended)

No build tools required. Just download and run.

### Windows

1. Download [`Fahh.Editor_0.3.0_x64-setup.exe`](https://github.com/Arnav1771/fahh-ide/releases/download/v0.3.0/Fahh.Editor_0.3.0_x64-setup.exe) (~3MB)
2. Double-click to install (installs to `AppData\Local\Fahh Editor\`, no admin required)
3. Find **Fahh Editor** in Start Menu or on Desktop

> **Windows 10/11**: WebView2 is pre-installed. No extra runtime needed.  
> **Windows 7/8**: Not supported (requires WebView2 which needs Win 10 1803+).

#### MSI installer (IT/enterprise)
```powershell
msiexec /i Fahh.Editor_0.3.0_x64_en-US.msi /quiet
```

#### Silent NSIS install
```powershell
.\Fahh.Editor_0.3.0_x64-setup.exe /S
```

#### Uninstall
```
Start Menu → Fahh Editor → Uninstall
# or
"C:\Users\<user>\AppData\Local\Fahh Editor\uninstall.exe" /S
```

---

### macOS

1. Download the correct `.dmg` for your Mac:
   - **Apple Silicon (M1/M2/M3/M4):** `Fahh.Editor_0.3.0_aarch64.dmg`
   - **Intel:** `Fahh.Editor_0.3.0_x64.dmg`
2. Open the `.dmg`, drag **Fahh Editor** to Applications
3. First launch: right-click → Open (to bypass Gatekeeper unsigned warning)

---

### Linux

#### AppImage (universal, any distro)
```bash
chmod +x Fahh.Editor_0.3.0_amd64.AppImage
./Fahh.Editor_0.3.0_amd64.AppImage
```

#### Debian/Ubuntu .deb
```bash
sudo dpkg -i Fahh.Editor_0.3.0_amd64.deb
# If missing deps:
sudo apt-get install -f
# Launch:
fahh-editor
```

#### RPM (Fedora/RHEL)
```bash
sudo rpm -i Fahh.Editor-0.3.0-1.x86_64.rpm
```

#### Linux prerequisites (required for AppImage on minimal systems)
```bash
sudo apt-get install -y libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1
```

---

### Linux via WSL2 (Windows Subsystem for Linux)

WSL2 with WSLg renders the window to your Windows desktop.

```bash
# Download the AppImage in WSL
wget -L https://github.com/Arnav1771/fahh-ide/releases/download/v0.3.0/Fahh.Editor_0.3.0_amd64.AppImage -O fahh.AppImage

# Install required libraries (Ubuntu 24.04)
sudo apt-get install -y libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 gstreamer1.0-plugins-good gstreamer1.0-libav

# Run
chmod +x fahh.AppImage
DISPLAY=:0 ./fahh.AppImage
```

The app window appears in your Windows taskbar as **"Fahh Editor (Ubuntu)"**.

> **Note:** WSL2 uses software rendering (no GPU acceleration). The first render takes 5-15 seconds. Subsequent renders are faster.

---

## Option B: Build from source

Required for development or if you need a custom build.

### Prerequisites

| Tool | Min version | Install |
|------|------------|---------|
| Rust + Cargo | 1.78 | `winget install Rustlang.Rustup` (Windows) or `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Node.js | 20 LTS | `winget install OpenJS.NodeJS` or https://nodejs.org |
| pnpm | 9+ | `npm install -g pnpm` |
| VS Build Tools *(Windows only)* | 2022 | See below |
| WebView2 Runtime | Any | Pre-installed on Win 10/11 |

#### Windows: VS Build Tools (MSVC linker)
Run **as Administrator**:
```powershell
winget install Microsoft.VisualStudio.2022.BuildTools `
  --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```
Wait ~15-25 minutes. A reboot may be required.

#### macOS
```bash
xcode-select --install
```

#### Linux (Ubuntu 22.04+)
```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libssl-dev librsvg2-dev patchelf \
  libayatana-appindicator3-dev build-essential curl wget git \
  gstreamer1.0-plugins-good gstreamer1.0-libav
```

### Clone and run
```bash
git clone https://github.com/Arnav1771/fahh-ide.git
cd fahh-ide
pnpm install
pnpm tauri dev          # full app: Rust backend + React frontend + hot reload
```

First `pnpm tauri dev` compiles all Rust dependencies — takes 5-10 minutes. Subsequent runs take ~30 seconds.

### Frontend only (no Rust needed)
```bash
pnpm dev                # Vite dev server at http://localhost:1420
```
Tauri commands (file I/O, terminal) won't work in browser mode — they show a graceful "Not available in browser preview" message.

### Production build
```bash
pnpm tauri build
# Output: src-tauri/target/release/bundle/
# Windows: .msi and .exe installer
# macOS: .app and .dmg
# Linux: .deb, .rpm, .AppImage
```

---

## Option C: Build in WSL (Ubuntu) — no Windows VS Build Tools needed

```bash
# Run as root to avoid sudo hang in non-interactive mode
wsl -d Ubuntu -u root bash << 'EOF'
set -e

# System dependencies
apt-get update -qq
apt-get install -y -q libwebkit2gtk-4.1-dev libssl-dev librsvg2-dev patchelf \
  libayatana-appindicator3-dev build-essential curl wget git \
  gstreamer1.0-plugins-good gstreamer1.0-libav

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source /root/.cargo/env

# Node.js (LTS)
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt-get install -y nodejs
npm install -g pnpm

# Tauri CLI
cargo install tauri-cli --version '^2' --locked

# Clone and run
git clone https://github.com/Arnav1771/fahh-ide.git /root/fahh-ide
cd /root/fahh-ide
pnpm install

DISPLAY=:0 WAYLAND_DISPLAY=wayland-0 HOME=/root pnpm tauri dev
EOF
```

First run: ~25 minutes (Tauri CLI + app compile). Subsequent runs: ~3 minutes (cached).

---

## First launch walkthrough

When Fahh Editor opens for the first time:

1. **Open a folder** — Click `📁` in the Explorer sidebar OR click "Open Folder" link
   - A native folder picker dialog opens
   - If the dialog doesn't appear (WSL/headless), a text input appears — type the path manually
2. **Open a file** — Click any file in the file tree
3. **Edit and save** — Edit in Monaco, press **Ctrl+S**
4. **Run code** — Click the **Run** tab at the bottom → select language → press **▶ Run**
5. **Try a theme** — Click 🔌 in the activity bar → Extensions → Themes → pick a theme
6. **Right-click a file** — Shows custom context menu: Open, Rename, Delete, Copy Path

---

## Config file

Located at `~/.fahh/config.json`, auto-created on first run.

```json
{
  "sfx_cooldown_secs": 3,
  "last_workspace": "/path/to/last/opened/folder",
  "installed_tools": [],
  "theme": "fahh-dark"
}
```

| Key | Default | Notes |
|-----|---------|-------|
| `sfx_cooldown_secs` | `3` | Seconds between fahh sounds. Set to `0` for no cooldown. Max `30`. |
| `last_workspace` | `null` | Remembered on next launch (Phase 2) |
| `installed_tools` | `[]` | Populated by the installer wizard |
| `theme` | `"fahh-dark"` | One of: `fahh-dark`, `fahh-light`, `github-dark`, `dracula`, `solarized-dark` |

---

## Installing optional tools

Click ⚙ in the activity bar → opens the Optional Tools wizard.

| Tool | What it does | Requires |
|------|-------------|---------|
| n8n | Visual workflow automation at `localhost:5678` | Node 18+ |
| browser-use | AI web browser agent | Python 3.11+ |
| Flowise AI | Visual LLM builder at `localhost:3001` | Node 18+ |
| GitHub CLI | `gh` commands in the terminal | — |
| Claude Code | AI coding agent | Node 18+ |

All tools run locally. No Docker. No cloud accounts required.

---

## Terminal — supported commands

The integrated terminal runs via `cmd.exe` on Windows, `sh` on Linux/macOS. Examples:

```bash
# Python
pip install requests pandas numpy
python script.py

# Node.js
npm install express
node server.js

# Go
go run main.go

# Rust
cargo run

# General shell
ls -la
cd /path/to/project
git status
```

> **Note (v0.3.0):** Terminal is batch-mode — output appears when the command finishes, not while running. Streaming PTY is planned for v0.4.0.

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+S | Save current file |
| Ctrl+\` | Toggle bottom panel (Terminal/Run/Debug) |
| Ctrl+Enter | Run code (in Run panel) |
| F5 | **Blocked** — prevents accidental page reload |
| Right-click | Custom IDE context menu (not browser menu) |

---

## Known issues (v0.3.0)

| Issue | Workaround |
|-------|-----------|
| fahhhh.mp3 is silent | Replace `src-tauri/assets/fahhhh.mp3` with a real sound file |
| LSP completions don't show | Phase 2 — install language servers on PATH for when it lands |
| Terminal output waits for completion | By design (batch mode). Streaming PTY in Phase 2 |
| `pnpm tauri dev` on Windows needs VS Build Tools | Install via Admin terminal then reboot |
| Linux/WSL: black window on first open | Software rendering — wait 10-15s for WebKit to paint |
| `Open Folder` dialog may not appear in WSL | Text input fallback appears automatically — type path manually |

---

## Release notes — what changed in v0.3.0 vs v0.2.0

- Right-click shows **custom IDE menu** (Rename, Delete, Copy Path, New File) — NOT the browser Share/Reload menu
- **F5 / Ctrl+R reload blocked** — editor content is safe
- **Themes fully work** — all 5 themes change Monaco syntax highlight colors (not just UI chrome)
- **New file** 📄 button in Explorer header — works even without a folder open
- Files appear in tree **instantly** after creation (optimistic update)
- **Task Manager** shows "Fahh Editor" not "WebView2 Gpu Process"
- CI: both frontend (vitest) and Rust (clippy) checks pass
- Canary E2E test suite: **17/17 passing**
