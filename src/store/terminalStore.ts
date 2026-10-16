import { create } from "zustand";
import { pushHistory } from "../lib/termHistory";

interface TerminalLine {
  text: string;
  type: "stdout" | "stderr" | "info";
}

interface TerminalStore {
  lines: TerminalLine[];
  cwd: string;
  history: string[];
  remember: (cmd: string) => void;
  addLine: (text: string, type?: TerminalLine["type"]) => void;
  clearLines: () => void;
  setCwd: (cwd: string) => void;
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  lines: [],
  cwd: "",
  history: [],
  remember: (cmd) => set((state) => ({ history: pushHistory(state.history, cmd) })),

  addLine: (text, type = "stdout") =>
    set((state) => ({
      lines: [...state.lines.slice(-999), { text, type }],
    })),

  clearLines: () => set({ lines: [] }),
  setCwd: (cwd) => set({ cwd }),
}));
