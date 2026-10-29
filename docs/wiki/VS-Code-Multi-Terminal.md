# Terminal

Every terminal tab is a **real shell** on a pseudo-terminal, like VS Code's: interactive programs (python, node, vim, htop), colours, Tab completion, `Ctrl+C`, and resizing all work.

---

## Profiles

| Platform | Profiles |
|---|---|
| Windows | PowerShell, Command Prompt, Git Bash (if installed), each WSL distro |
| Linux / macOS | your login shell, bash, zsh, fish (whichever are installed) |

Open the `+` dropdown on the terminal bar to start a specific profile, or choose **Set Default Profile**. Settings > Terminal also sets the default.

## Tabs and splits

| Action | Shortcut |
|---|---|
| New terminal | ``Ctrl+Shift+` `` |
| Split terminal | `Ctrl+Shift+5` |
| Toggle the panel | ``Ctrl+` `` |

Each tab keeps its own shell, working directory and scrollback. Closing a split pane does not kill other sessions. The terminal starts in the open folder.

## Tasks

**Run Task…** in the terminal bar menu (or the command palette) lists the tasks in `.vscode/tasks.json` and runs the chosen one in a new terminal:

```json
{
  "version": "2.0.0",
  "tasks": [
    { "label": "dev", "type": "shell", "command": "npm run dev" }
  ]
}
```

## The Explorer follows the terminal

Files and folders made in the terminal (`mkdir`, `git clone`, `npm create`) appear in the Explorer without a refresh.

## Clickable file locations (v0.7.0)

File locations in terminal output open in the editor at that line: compiler and linter output (`src/app.ts:12:5`, `main.rs:7`, `C:\proj\x.py(3,1)`), test failures and Python tracebacks (`File "app.py", line 42`). Hover to underline, click to open. Relative paths are resolved against the open folder.

## Drop files into the terminal

Drag files from Windows Explorer, Finder or your file manager onto a terminal to type their paths (quoted when they contain spaces).
