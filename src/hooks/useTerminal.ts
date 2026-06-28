import { useCallback, useEffect } from "react";
import { executeCommand } from "../lib/tauri";
import { useTerminalStore } from "../store/terminalStore";
import { listen } from "@tauri-apps/api/event";

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
        if (stdout) addLine(stdout);
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

  const run = useCallback(
    async (command: string) => {
      addLine(`$ ${command}`, "info");
      try {
        const result = await executeCommand(command, [], cwd);
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
    [addLine, cwd]
  );

  return { run };
}
