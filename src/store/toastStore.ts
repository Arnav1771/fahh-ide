import { create } from "zustand";

export interface Toast {
  id: number;
  text: string;
  kind: "ok" | "error";
}

interface ToastStore {
  toasts: Toast[];
  show: (text: string, kind?: Toast["kind"]) => void;
}

let nextId = 1;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  show: (text, kind = "ok") => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 5000 : 1800);
  },
}));
