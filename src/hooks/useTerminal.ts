import { useCallback, useEffect } from "react";
import { executeCommand } from "../lib/tauri";
import { useTerminalStore } from "../store/terminalStore";
import { listen } from "@tauri-apps/api/event";
import { splitCwdLine, wrapForCwd, type ShellKind } from "../lib/shellCwd";
import { resolvePath } from "../lib/preview";
import { useWorkspace } from "./useWorkspace";

/** The backend runs commands with `cmd /C` on Windows and `sh -c` elsewhere. */
const SHELL: ShellKind = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent) ? "cmd" : "posix";

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
