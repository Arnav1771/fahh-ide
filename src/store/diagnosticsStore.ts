import { create } from "zustand";

export interface DiagnosticItem {
  id: string;
  path: string;
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  line?: number;
  column?: number;
  source?: string;
  code?: string | number;
}

export interface DiagnosticsStore {
  diagnostics: DiagnosticItem[];
  setFileDiagnostics: (path: string, items: DiagnosticItem[]) => void;
  clearFileDiagnostics: (path: string) => void;
  clearAll: () => void;
}

export const useDiagnosticsStore = create<DiagnosticsStore>((set) => ({
  diagnostics: [
    {
      id: "diag-1",
      path: "src/main.rs",
      message: "cannot find value `listener` in this scope",
      severity: "error",
      line: 42,
      column: 17,
      source: "rustc (E0425)",
      code: "E0425",
    },
    {
      id: "diag-2",
      path: "src/components/AgentPanel/index.tsx",
      message: "Property 'altV' is deprecated, use standard clipboard event",
      severity: "warning",
      line: 88,
      column: 12,
      source: "eslint",
      code: "deprecation",
    },
  ],
  setFileDiagnostics: (path, items) =>
    set((state) => ({
      diagnostics: [
        ...state.diagnostics.filter((d) => d.path !== path),
        ...items,
      ],
    })),
  clearFileDiagnostics: (path) =>
    set((state) => ({
      diagnostics: state.diagnostics.filter((d) => d.path !== path),
    })),
  clearAll: () => set({ diagnostics: [] }),
}));
