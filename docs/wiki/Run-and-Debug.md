# Run and Debug

Fahh Editor debugs through the **Debug Adapter Protocol** (DAP), the same protocol VS Code uses. Open the view with `Ctrl+Shift+D`.

---

## Supported languages

| Language | Adapter | Install |
|---|---|---|
| Python | debugpy | `pip install debugpy` |
| Go | Delve | `go install github.com/go-delve/delve/cmd/dlv@latest` |
| C / C++ / Rust | lldb-dap | ships with LLVM (`lldb-dap` or `lldb-vscode` on PATH) |

If an adapter is missing, the view says which one and how to install it.

## Breakpoints

- Click in the gutter left of a line number, or press `F9` on the line.
- Breakpoints are listed in the Breakpoints section; untick one to disable it.

## Controls

| Action | Shortcut |
|---|---|
| Start / Continue | `F5` |
| Run without debugging | `Ctrl+F5` |
| Step over | `F10` |
| Step into | `F11` |
| Step out | `Shift+F11` |
| Toggle breakpoint | `F9` |
| Stop | `Shift+F5` |
| Restart | `Ctrl+Shift+F5` |

While paused you get **Variables** (expand objects and lists), the **Call Stack** (click a frame to jump there), and the **Debug Console**: type an expression to evaluate it in the current frame. Program output goes to the Debug Console too.

## launch.json

`.vscode/launch.json` works as in VS Code. Pick a configuration from the dropdown at the top of the view. Without one, `F5` debugs the current file. Example:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Python: app.py",
      "type": "debugpy",
      "request": "launch",
      "program": "${workspaceFolder}/app.py",
      "args": ["--port", "5000"],
      "cwd": "${workspaceFolder}"
    }
  ]
}
```

Supported variables: `${workspaceFolder}`, `${workspaceFolderBasename}`, `${file}`, `${fileDirname}`, `${fileBasename}`, `${fileBasenameNoExtension}`, `${fileExtname}`, `${relativeFile}`.
