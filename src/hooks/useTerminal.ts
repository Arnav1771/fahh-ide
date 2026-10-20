import { useCallback, useEffect } from "react";
import { executeCommand, launchAgyTerminal } from "../lib/tauri";
import { useTerminalStore } from "../store/terminalStore";
import { listen } from "@tauri-apps/api/event";
import { detectShell, effectiveShell, isUncPath, splitCwdLine, wrapForCwd } from "../lib/shellCwd";
import { linuxToWindows } from "../lib/wslPath";
import { resolvePath } from "../lib/preview";
import { noteLocalUrls } from "../lib/browser";
import { useWorkspace } from "./useWorkspace";

const PLATFORM = detectShell();

/** The active tab's shell, as the backend should run it ("auto" picks per folder). */
const activeShell = (cwd: string) => {
  const { sessions, activeSessionId } = useTerminalStore.getState();
  const s = sessions.find((x) => x.id === activeSessionId);
  return effectiveShell(s?.shell ?? "auto", cwd, PLATFORM);
};

export function useTerminal() {
  const { addLine, cwd } = useTerminalStore();

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let mounted = true;

    listen<{ stdout: string; stderr: string; exit_code: number | null }>(
      "terminal://output",
      (event) => {
        if (!mounted) return;
        const { stdout, stderr, exit_code } = event.payload;
        noteLocalUrls(`${stdout ?? ""}\n${stderr ?? ""}`); // offer "localhost:5173" in the status bar
        if (stdout) {
          // The folder the command ended in (so `cd` sticks), then the visible text.
          const { text, cwd: reported } = splitCwdLine(stdout);
          // A WSL shell on Windows reports a Linux folder: keep the Windows spelling.
          const nextCwd =
            reported && PLATFORM === "cmd" && reported.startsWith("/")
              ? linuxToWindows(reported, useTerminalStore.getState().cwd)
              : reported;
          if (nextCwd) useTerminalStore.getState().setCwd(nextCwd);
          if (text) addLine(text);
        }
        if (stderr) addLine(stderr, "stderr");
        if (exit_code !== null && exit_code !== 0) {
          addLine(`[exit ${exit_code}]`, "stderr");
        }
      }
    ).then((fn) => {
      unlisten = fn;
    }).catch(() => {
      // no Tauri (plain browser build): nothing to listen to
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [addLine]);

  const { openFolder } = useWorkspace();

  const run = useCallback(
    async (command: string) => {
      addLine(`$ ${command}`, "info");
      // `fahh .` / `fahh <folder>` opens a folder in the explorer, like VS Code's `code .`.
      const open = /^fahh(?:\s+(.+))?\s*$/.exec(command.trim());
      if (open) {
        const target = resolvePath(cwd || ".", (open[1] ?? ".").replace(/^["']|["']$/g, ""));
        try {
          await openFolder(target);
          addLine(`Opened ${target} in the explorer.`, "info");
        } catch (err) {
          addLine(`fahh: could not open ${target}: ${String(err)}`, "stderr");
        }
        return;
      }

      // `agy` launch handler: launch interactive Antigravity CLI in a standalone console window
      const agyMatch = /^agy(?:\s+(.*))?$/i.exec(command.trim());
      if (agyMatch) {
        const agyArgs = (agyMatch[1] ?? "").split(" ").filter(Boolean);
        addLine("Launching Antigravity CLI interactive terminal session...", "info");
        try {
          const res = await launchAgyTerminal(cwd, agyArgs);
          addLine(res || "Antigravity CLI console launched in a new window.", "info");
        } catch (err) {
          addLine(`fahh: could not launch agy: ${String(err)}`, "stderr");
        }
        return;
      }
      const shell = activeShell(cwd);
      // cmd in a UNC folder runs behind a temporary pushd drive, so it cannot report
      // where a `cd` went: follow plain `cd <dir>` here instead.
      const cd = /^\s*cd(?:\s+\/d)?\s+(.+?)\s*$/i.exec(command);
      if (shell === "cmd" && cd && isUncPath(cwd)) {
        useTerminalStore.getState().setCwd(resolvePath(cwd, cd[1].replace(/^["']|["']$/g, "")));
        return;
      }
      try {
        const result = await executeCommand(wrapForCwd(command, shell, cwd), [], cwd, shell === "posix" ? undefined : shell);
        // We no longer print result.stdout/stderr here since it's streamed
        if (result.exit_code !== null && result.exit_code !== 0) {
          addLine(`[exit ${result.exit_code}]`, "stderr");
        }
      } catch (err) {
        const msg = String(err);
        const isTauriMissing = msg.includes("invoke") || msg.includes("__TAURI__") || msg.includes("transformCallback");
        addLine(
          isTauriMissing
            ? "Not available in browser preview — run via `pnpm tauri dev` for full terminal support."
            : msg,
          "stderr"
        );
      }
    },
    [addLine, cwd, openFolder]
  );

  return { run };
}
