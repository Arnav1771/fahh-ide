# The `fahh` command

```
fahh .                 open the current folder as the workspace
fahh <folder>          open that folder
fahh <file>            open that file (its folder becomes the workspace if none is open)
fahh <file>:<line>     ... and jump to the line (file:line:col also accepted; the column is ignored)
fahh agent ...         forwarded to the separate `fahh-agent` binary
```

Paths are resolved against the folder you ran the command in. Unknown `-flags` are ignored. A path that does not exist shows an error toast and changes nothing.

## One window, reused

Fahh is single-instance. If it is already running, the new `fahh` process hands its arguments and working folder to the running window (tauri-plugin-single-instance), which unminimises, focuses and opens the path, then the new process exits. A folder replaces the current workspace (open tabs stay); a file opens as a tab. There is no new-window mode yet: it needs multi-window state, which is out of scope for 0.5.x.

The first launch parks its path in `PendingOpen` and the UI collects it on start-up (`take_pending_open`), so nothing is lost if the window is not ready yet. Later launches arrive as the `fahh://open` event. Both carry an `OpenRequest` (`src/lib/types.ts`).

## Installing the command

| Platform | How |
|---|---|
| Windows (NSIS installer) | Installs `<install dir>\bin\fahh.cmd` and adds that folder to the **user** PATH (HKCU); the uninstaller removes it. The shim uses `start`, so the prompt returns immediately and no console stays open. Open a new terminal after installing. Hook: `src-tauri/windows/hooks.nsh`, config: `src-tauri/tauri.windows.conf.json`. |
| Linux .deb | Installs `/usr/bin/fahh` (`src-tauri/cli/fahh`, config `tauri.linux.conf.json`). |
| Linux AppImage, macOS | Command palette: **Install 'fahh' Command in PATH**. macOS writes `/usr/local/bin/fahh`, Linux `~/.local/bin/fahh`; if the folder is not writable the message shows the `sudo` line to run. |

## `fahh agent`

Runs Fahh Local in this terminal. See [Fahh Local in a terminal](wiki/Fahh-Agent-Terminal.md) for starting it, keys, modes, `--json` (what Fahh Local Chat (VS Code extension) uses) and how it is tested. The shell shims forward `fahh agent` to `fahh-agent`; the program itself runs it too (0.8.9), so it also works where `fahh` is the AppImage.

## How it was checked

- `cargo test`: argv parsing in `src-tauri/src/app/cli.rs` (`.`, relative and absolute folders, file, file:line, file:line:col, a real file named `x:12`, missing path, unknown flags, agent passthrough) and the generated shell shim (executable, quoting, `agent` hint with exit 1).
- `pnpm test`: `src/lib/openRequest.test.ts` (folder, file, file with no workspace, line, missing, failure).
- Real app on Linux, via tauri-driver with the debug binary: launch with a folder argument, then launch the same binary again with `a.ts:3`, `.` and a missing name while it runs. The first launch opens the folder, each second launch exits at once and the running window opens the file at line 3 / switches workspace / shows the error toast.
- Not observable from Linux: the NSIS installer, the PATH edit and `fahh.cmd` on Windows, the macOS `/usr/local/bin` write, and the `.deb` file placement. Their files are small and reviewed, not run.
