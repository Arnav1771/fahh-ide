import { useCallback, useEffect } from "react";
import { executeCommand } from "../lib/tauri";
import { useTerminalStore } from "../store/terminalStore";
import { listen } from "@tauri-apps/api/event";
import { detectShell, splitCwdLine, wrapForCwd } from "../lib/shellCwd";
import { resolvePath } from "../lib/preview";
import { noteLocalUrls } from "../lib/browser";
import { useWorkspace } from "./useWorkspace";

const SHELL = detectShell();

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
          const { text, cwd: nextCwd } = splitCwdLine(stdout);
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
        const agyArgs = agyMatch[1] ?? "";
        addLine("Launching Antigravity CLI interactive terminal session...", "info");
        try {
          const launchCmd = `start "Antigravity CLI" cmd /k "chcp 65001 >nul && (if exist \"%LOCALAPPDATA%\\agy\\bin\\agy.exe\" (\"%LOCALAPPDATA%\\agy\\bin\\agy.exe\" ${agyArgs}) else (agy ${agyArgs}))"`;
          await executeCommand(launchCmd, [], cwd);
          addLine("Antigravity terminal session launched.", "info");
        } catch (err) {
          addLine(`fahh: could not launch agy: ${String(err)}`, "stderr");
        }
        return;
      }
      try {
        const result = await executeCommand(wrapForCwd(command, SHELL), [], cwd);
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
