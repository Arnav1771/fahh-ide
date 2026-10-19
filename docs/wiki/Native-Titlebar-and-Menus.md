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
- **File**: New File, New Window, Open File, Open Folder, Save, Save All, Exit.
- **Edit**: Undo, Redo, Cut, Copy, Paste, Find (`Ctrl+F`), Replace (`Ctrl+H`).
- **Selection**: Select All, Expand Selection, Shrink Selection, Add Cursor Above/Below.
- **View**: Command Palette (`Ctrl+Shift+P`), Explorer (`Ctrl+Shift+E`), Toggle Terminal (`Ctrl+` `), Toggle Spatial Canvas, Zoom In/Out.
- **Go**: Go to File (`Ctrl+P`), Go to Symbol (`Ctrl+Shift+O`), Go to Line (`Ctrl+G`).
- **Run**: Start Debugging, Run Without Debugging, Stop Debugging.
- **Terminal**: New Terminal (`Ctrl+Shift+` `), Split Terminal (`Ctrl+Shift+5`), Clear Terminal.
- **Help**: Documentation, Welcome Tour, Keyboard Shortcuts Reference.

---

## Keyboard Shortcuts

| Menu Command | Shortcut |
|---|---|
| **Command Palette** | `Ctrl+Shift+P` |
| **Quick Open File** | `Ctrl+P` |
| **Toggle Terminal** | `Ctrl+` ` |
| **Save File** | `Ctrl+S` |
| **Find** | `Ctrl+F` |
| **Replace** | `Ctrl+H` |
