# Welcome to the Fahh Editor Wiki

**Fahh Editor** (`v0.6.8`) is a next-generation AI-native desktop IDE built with **Tauri 2 (Rust)**, **React 18**, **TypeScript**, **Monaco Editor**, and **Tailwind CSS**. It combines the productivity of linear modern code editors (like VS Code and Cursor) with an infinite 2D **CATE Spatial Canvas** and autonomous AI agent sidecars.

---

## Quick Navigation

| Wiki Page | Description |
|---|---|
| **[Getting Started](Getting-Started)** | The first-run tour (sound, code, look, Fahh Local, Check Setup), your own error sound, update checks |
| **[CATE Spatial Canvas](CATE-Spatial-Canvas)** | Infinite 2D zooming canvas, Monaco editor nodes, dynamic font scaling, 1:1 crisp focus (`Alt+1`) |
| **[Run and Debug](Run-and-Debug)** | DAP debugging for Python, Go, C/C++/Rust: breakpoints, stepping, variables, Debug Console, `launch.json` (`Ctrl+Shift+D`) |
| **[Terminal](VS-Code-Multi-Terminal)** | Real shells (PowerShell, cmd, Git Bash, WSL, bash/zsh), profiles, splits (`Ctrl+Shift+5`), `tasks.json` |
| **[Agent Mode](Agent-Mode)** | The Agent / Editor switch, sessions sidebar, session search (`Ctrl+Shift+A`) |
| **[Remote Explorer](Remote-Explorer)** | WSL distros, SSH hosts and Docker containers |
| **[DeepWiki](DeepWiki)** | See Wiki on a symbol: definition, docs, usages, AI explanation |
| **[Outline, Timeline & Git Status](Outline-Timeline-and-Git-Status)** | File symbols, file history, branch and Sync in the status bar |
| **[Accounts & Sync](Accounts-and-Sync)** | Optional account: upload and download settings and theme, What's new |
| **[File Icon Themes & Open VSX](Icon-Themes-and-Open-VSX)** | Material, Fahh Colour and Minimal icon themes; how file and folder icons are chosen |
| **[Native Titlebar & Menus](Native-Titlebar-and-Menus)** | Seamless borderless titlebar, client-side window controls, VS Code menu bar |
| **[Multi-Window Architecture](Multi-Window-Architecture)** | $N$-window concurrency, isolated state stores, smart instance de-duplication (`Ctrl+Shift+N`) |
| **[Workspace Search & Replace](Workspace-Search-and-Replace)** | Global text and regex search, multi-file replace, glob filters (`Ctrl+Shift+F`) |
| **[PDF & Binary Viewer](PDF-and-Binary-Viewer)** | Native WebView2 PDF reader with zoom & text selection, media previews |
| **[Fahh Local Agent](Fahh-Local-Agent)** | The in-editor coding agent: Ask / Auto-edit / Plan modes, approvals, `@` mentions |
| **[Settings](Settings)** | Editor, fahh volume, terminal and session settings (`Ctrl+,`), Open Recent, tab and navigation shortcuts |

---

## Key Highlights

### 1. Dual-Mode Development
- **Docked IDE Mode**: Familiar linear layout with Monaco code editor, file tree, bottom terminal panel, and AI sidecar.
- **CATE Spatial Canvas Mode**: Zoom out to an infinite 2D canvas where editors, agent chats, terminals, and web browser viewports coexist as spatial nodes.

### 2. Multi-Terminal with Side-by-Side Splits
- Run $N$ concurrent terminal sessions with independent state, working directories, and scroll buffers.
- Split any active terminal (`Ctrl+Shift+5`) to monitor servers and run git commands side-by-side.

### 3. Native Titlebar & Menu Bar
- Custom frameless titlebar with integrated client-side Minimize, Maximize/Restore, and Close buttons.
- Full desktop menus: File, Edit, Selection, View, Go, Run, Terminal, Help.

### 4. Zero Cloud Lock-In
- 100% local-first. Config and workspace files stay on your machine.
- Compatible with local Ollama models, Antigravity CLI (`agy`), and cloud LLMs (Gemini, Claude, OpenAI).

---

## Installation & Running

### Desktop Application
Download the latest installers from [GitHub Releases](https://github.com/Arnav1771/fahh-ide/releases/tag/v0.6.8):
- Windows: `Fahh.Editor_0.6.8_x64-setup.exe` or `.msi`
- macOS: `Fahh.Editor_0.6.8_aarch64.dmg` / `x64.dmg`
- Linux: `Fahh.Editor_0.6.8_amd64.AppImage` / `.deb` / `.rpm`

### Developer Quickstart
```bash
# Clone the repository
git clone https://github.com/Arnav1771/fahh-ide.git
cd fahh-ide

# Install dependencies
pnpm install

# Run frontend in browser preview
pnpm dev

# Run full desktop app with Tauri 2
pnpm tauri dev

# Run test suite
pnpm test
```
