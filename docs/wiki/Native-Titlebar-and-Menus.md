# Native Custom Titlebar & Application Menus

Fahh Editor uses a frameless, unified titlebar that seamlessly merges desktop window controls, application menus, search, and workspace branding into a single 36px header bar.

---

## Architecture & Layout

### 1. Client-Side Window Controls
- **Minimize**: Calls Tauri's `appWindow.minimize()` to collapse to taskbar.
- **Maximize / Restore**: Calls `appWindow.toggleMaximize()` with live icon feedback between maximize and restore states.
- **Close**: Calls `appWindow.close()`.
- Windows dragging works anywhere on the titlebar header via `data-tauri-drag-region`.

### 2. Application Menus
The header hosts full desktop menus:
- **File**: New File, New Window, Open File, Open Folder, Open Workspace, **Open Recent** (last 10 folders and workspaces, Clear Recently Opened), Reopen Closed Tab, Save, Save All, Auto Save, Close Tab, Close All Tabs, Settings, Exit.
- **Edit**: Undo, Redo, Cut, Copy, Paste, Find (`Ctrl+F`), Replace (`Ctrl+H`).
- **Selection**: Select All, Expand Selection, Shrink Selection, Add Cursor Above/Below.
- **View**: Command Palette (`Ctrl+Shift+P`), Explorer (`Ctrl+Shift+E`), Toggle Terminal (`Ctrl+` `), Toggle Spatial Canvas, Zoom In/Out.
- **Go**: Back (`Alt+Left`), Forward (`Alt+Right`), Go to File (`Ctrl+P`), Go to Line (`Ctrl+G`), Next / Previous Problem, Go to Definition, Go to References.
- **Run**: Start Debugging, Run Without Debugging, Stop Debugging.
- **Terminal**: New Terminal (`Ctrl+Shift+` `), Split Terminal (`Ctrl+Shift+5`), Clear Terminal.
- **Help**: Welcome (the first-run tour), Check Setup…, Documentation, Optional Tools, Ring the Bell, Report Issue, **About** (version, release notes, Check for updates against the latest GitHub release).

The title bar also has **Back / Forward** arrows next to the Search box. The title bar and menus follow the colour theme (light under Fahh Light).

---

## Keyboard Shortcuts

| Menu Command | Shortcut |
|---|---|
| **Command Palette** | `Ctrl+Shift+P` |
| **Quick Open File** | `Ctrl+P` |
| **Toggle Terminal** | `Ctrl+` ` |
| **Save File** | `Ctrl+S` |
| **Settings** | `Ctrl+,` |
| **Close Tab** | `Ctrl+W` (or middle-click the tab) |
| **Close All Tabs** | `Ctrl+K Ctrl+W` |
| **Reopen Closed Tab** | `Ctrl+Shift+T` |
| **Next / Previous Tab (recently used)** | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| **Go Back / Forward** | `Alt+Left` / `Alt+Right` (also the arrows in the title bar) |
| **Find** | `Ctrl+F` |
| **Replace** | `Ctrl+H` |
