/**
 * What F5, F9, F10, F11 (and their menu and palette entries) do. Shared by App.tsx's key
 * handler, the command palette and the Run menu.
 */
import type { DebugKeyAction } from "./hotkeys";
import {
  pauseRun,
  restartDebugging,
  startOrContinue,
  stepInto,
  stepOut,
  stepOver,
  stopDebugging,
  toggleBreakpointAt,
} from "./debugSession";
import { revealView } from "./workbench";
import { useDebugStore } from "../store/debugStore";
import { useEditorStore } from "../store/editorStore";
import { useRunnerStore } from "../store/runnerStore";

/** F5 and friends; also the palette and the Run menu. */
export function runDebugAction(action: DebugKeyAction): void {
  switch (action) {
    case "startOrContinue":
      if (!useDebugStore.getState().isDebugging) revealView("runDebug");
      startOrContinue();
      break;
    case "stop":
      void stopDebugging();
      break;
    case "restart":
      void restartDebugging();
      break;
    case "pause":
      pauseRun();
      break;
    case "stepOver":
      stepOver();
      break;
    case "stepInto":
      stepInto();
      break;
    case "stepOut":
      stepOut();
      break;
    case "toggleBreakpoint": {
      const { activeTab, cursorPosition } = useEditorStore.getState();
      toggleBreakpointAt(activeTab, cursorPosition.line);
      break;
    }
  }
}

/** Ctrl+F5: run the active file in the Run panel. */
export function runWithoutDebugging(): void {
  revealView("run");
  useRunnerStore.getState().requestRun(true);
}

