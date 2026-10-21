# Multi-Window Architecture ($N$-Number of Windows)

Fahh Editor provides first-class support for opening and managing **$N$ concurrent windows**, allowing developers to work on multiple repositories, microservices, and workspaces side-by-side without interference.

---

## How to Open a New Window

Fahh Editor provides 5 distinct methods to open new windows:

| Method | Action | Description |
|---|---|---|
| **1-Click Titlebar Icon** | Click the `+` (`PlusSquare`) button in the top titlebar | Instantly spawns a clean, fresh window. |
| **Keyboard Shortcut** | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>N</kbd> | Global shortcut that works from anywhere within the editor. |
| **Native Menu Bar** | **File** &rarr; **New Window** | Standard desktop application menu bar trigger. |
| **Command Palette** | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> &rarr; `New Window` | Searchable action in the command palette. |
| **CLI Launch** | `fahh <folder-path>` | Launch a project directly into a new window from any terminal or shell. |

---

## Technical Architecture & State Isolation

Fahh Editor is built on **Tauri 2** and Rust, utilizing a multi-webview window architecture:

```
[ OS / CLI: `fahh <folder>` ]
          │
          ▼
[ src-tauri: on_second_launch / open_new_window ]
          │
   ┌──────┴──────────────────────────┐
   ▼                                 ▼
Already Open?                 New Workspace?
   │                                 │
   ├─► Unminimize & Focus            └─► Generate `fahh-win-<timestamp>`
       Existing Window                   Park in `PendingOpen[label]`
                                         Spawn WebviewWindow
                                         Isolated Zustand Stores
```

### 1. Per-Window State Isolation
Each window runs in its own isolated Webview instance with independent memory space and Zustand stores:
- **`useFileStore`**: Isolated workspace file tree, active root directory, and file watchers.
- **`useEditorStore`**: Independent open tabs, dirty file states, and Monaco editor instances.
- **`useTerminalStore`**: Dedicated PTY processes, shell sessions, and history.
- **`useSpatialStore`**: Separate CATE infinite canvas coordinates, cards, and zoom levels.
- **`useAgentStore`**: Independent Fahh Local agent conversation.

### 2. Smart Refocusing (De-duplication)
When you run `fahh <folder>` from a shell while Fahh Editor is already running:
1. Fahh inspects all currently open window titles across the operating system.
2. If the folder is **already open** in an existing window:
   - Fahh unminimizes and brings that exact window to the foreground (`set_focus()`).
   - Fahh emits the open event to that specific window without restarting or reloading.
3. If the folder is **not open**:
   - Fahh dynamically generates a unique window label `fahh-win-<timestamp>`.
   - Fahh creates a new `tauri::WebviewWindowBuilder` instance with the workspace folder pre-loaded via `PendingOpen`.

### 3. Native Window Controls & Frameless Titlebar
- Every spawned window features a custom native titlebar matching the user's active theme.
- Includes draggable window header, double-click to maximize/restore, minimize, maximize, and close controls.
- Unsaved changes guard: closing any window checks for dirty tabs and prompts for confirmation before exiting that specific window without killing other active windows.
