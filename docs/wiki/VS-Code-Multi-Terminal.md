# VS Code-Style Multi-Terminal & Split View

Fahh Editor delivers a terminal experience comparable to Visual Studio Code, complete with $N$-session tab management, side-by-side terminal splits, and shell selection.

---

## Features

### 1. Multi-Session Management
- Create an unlimited number of concurrent terminal sessions.
- Top session tabs bar displays all active sessions (e.g. `1: powershell`, `2: bash`, `3: cmd`).
- Each terminal session maintains its own:
  - Working directory (`cwd`)
  - Command history (navigable with `Up` / `Down` arrows)
  - Output lines buffer
  - Running processes

### 2. Side-by-Side Split Panes
- Click the **Split Terminal** button (`Columns2` icon) or press `Ctrl+Shift+5` to split the active terminal side-by-side.
- Split multiple times to view up to 4 concurrent terminal panes on screen at the same time.
- Switch between **Horizontal** (columns) and **Vertical** (rows) split layouts on the fly.
- Close individual split panes with the `X` button on the pane header without killing the underlying session.

### 3. Shell Selection
- Launch any installed system shell via the `+ Shell` dropdown:
  - **PowerShell** (Default on Windows)
  - **Command Prompt** (`cmd.exe`)
  - **Bash / WSL** (Windows Subsystem for Linux or Unix shell)

### 4. Interactive Utilities
- **Alt+V Image Pasting**: Paste images directly from the clipboard to attach them to terminal sessions (Claude Code style).
- **Tab Completion**: Auto-completes files and directory paths in the current workspace.
- **AI Error Diagnostic**: Terminal `stderr` lines show a `Fix with AI` button that routes directly into the REA / Cursor Composer panel.

---

## Shortcuts

| Action | Shortcut |
|---|---|
| **New Terminal** | `Ctrl+Shift+` ` |
| **Split Terminal** | `Ctrl+Shift+5` |
| **Clear Terminal** | `Ctrl+L` or type `clear` / `cls` |
| **Focus Editor** | `Escape` |
| **Paste Image** | `Alt+V` |
