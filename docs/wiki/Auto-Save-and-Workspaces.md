# Auto-Save & Workspace Management

Fahh Editor provides background persistence and portable workspace configurations.

---

## 1. Auto-Save Engine

Auto-save ensures your work is never lost to system crashes, window switches, or power interruptions.

- **Debounced Disk Writes**: When enabled, file changes are automatically written to disk after a 1000ms idle window.
- **Save on Window Blur**: When switching to a browser, terminal, or another application, all dirty tabs are saved immediately.
- **Silent Background Operation**: Auto-saves execute silently without notification spam, keeping developer focus uninterrupted.
- **Toggle Controls**:
  - `File` menu: Check or uncheck **Auto Save**.
  - Command Palette (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>): Run `Toggle Auto Save`.

---

## 2. Workspace Management (`.fahh-workspace`)

Workspaces allow you to bundle and share your development state.

### Saving a Workspace
Navigate to **File > Save Workspace As...** or run `Save Workspace As…` in the Command Palette. Fahh Editor exports a `.fahh-workspace` file containing:
- Workspace folder root and display name
- Open tab list and active document
- Editor preferences (active theme, auto-save state)

```json
{
  "fahh": "0.6.3",
  "name": "my-project",
  "root": "C:/dev/my-project",
  "folders": [{ "path": "C:/dev/my-project", "name": "my-project" }],
  "openTabs": [
    { "path": "C:/dev/my-project/src/index.ts", "language": "typescript", "active": true },
    { "path": "C:/dev/my-project/package.json", "language": "json", "active": false }
  ],
  "settings": {
    "autoSave": true,
    "theme": "fahh-dark"
  }
}
```

### Opening a Workspace
Navigate to **File > Open Workspace…** or run `Open Workspace from File…`. Fahh Editor reads the configuration, switches to the specified workspace directory, restores the tab list, and applies your saved theme and auto-save preferences.

---

## 3. VS Code workspaces (`.code-workspace`)

Since v0.6.4, **File > Open Workspace** also loads VS Code `.code-workspace` files:
- JSONC is accepted (comments, trailing commas).
- Folders resolve relative to the workspace file; `vscode-remote://wsl+<distro>/...` and `file:///` URIs are mapped.
- `files.autoSave` from the workspace settings is honoured.
- From a terminal: `fahh team.code-workspace`.
- A folder that does not exist is reported as an error.
