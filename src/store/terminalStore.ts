import { create } from "zustand";

interface TerminalLine {
  text: string;
  type: "stdout" | "stderr" | "info";
}

interface TerminalStore {
  lines: TerminalLine[];
  cwd: string;
  addLine: (text: string, type?: TerminalLine["type"]) => void;
  clearLines: () => void;
  setCwd: (cwd: string) => void;
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  lines: [],
  cwd: "",

  addLine: (text, type = "stdout") =>
    set((state) => ({
      lines: [...state.lines.slice(-999), { text, type }],
    })),

  clearLines: () => set({ lines: [] }),
  setCwd: (cwd) => set({ cwd }),
}));
