import { useCallback } from "react";
import { executeCommand } from "../lib/tauri";
import { useTerminalStore } from "../store/terminalStore";

export function useTerminal() {
  const { addLine, cwd } = useTerminalStore();

  const run = useCallback(
    async (command: string) => {
      addLine(`$ ${command}`, "info");
      try {
        const result = await executeCommand(command, [], cwd);
        if (result.stdout) addLine(result.stdout);
        if (result.stderr) addLine(result.stderr, "stderr");
        if (result.exit_code !== null && result.exit_code !== 0) {
          addLine(`[exit ${result.exit_code}]`, "stderr");
        }
      } catch (err) {
        addLine(String(err), "stderr");
      }
    },
    [addLine, cwd]
  );

  return { run };
}
