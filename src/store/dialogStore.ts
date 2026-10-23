import { create } from "zustand";

/**
 * The app's own confirm / prompt / alert (window.prompt and friends block the
 * webview and look foreign). Ask with one of the helpers below and await the answer;
 * <DialogHost> shows one dialog at a time, in order.
 */
export interface DialogButton {
  label: string;
  value: string;
  primary?: boolean;
  danger?: boolean;
}

export interface DialogRequest {
  id: number;
  title: string;
  message?: string;
  /** A text field (prompt). */
  input?: { value: string; placeholder?: string };
  buttons: DialogButton[];
}

/** `button` is null when the dialog was dismissed (Esc, or the backdrop). */
export interface DialogResult {
  button: string | null;
  value?: string;
}

interface DialogStore {
  queue: DialogRequest[];
  open: (req: Omit<DialogRequest, "id">) => Promise<DialogResult>;
  answer: (id: number, result: DialogResult) => void;
}

const waiting = new Map<number, (r: DialogResult) => void>();
let nextId = 1;

export const useDialogStore = create<DialogStore>((set) => ({
  queue: [],
  open: (req) =>
    new Promise<DialogResult>((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      set((s) => ({ queue: [...s.queue, { ...req, id }] }));
    }),
  answer: (id, result) => {
    waiting.get(id)?.(result);
    waiting.delete(id);
    set((s) => ({ queue: s.queue.filter((d) => d.id !== id) }));
  },
}));

const open = (req: Omit<DialogRequest, "id">) => useDialogStore.getState().open(req);

/** OK / Cancel. True on OK. */
export async function confirmDialog(o: { title: string; message?: string; ok?: string; danger?: boolean }): Promise<boolean> {
  const r = await open({
    title: o.title,
    message: o.message,
    buttons: [
      { label: o.ok ?? "OK", value: "ok", primary: !o.danger, danger: o.danger },
      { label: "Cancel", value: "cancel" },
    ],
  });
  return r.button === "ok";
}

/** A text field. The trimmed text on OK; null when cancelled. */
export async function promptDialog(o: { title: string; message?: string; value?: string; placeholder?: string; ok?: string }): Promise<string | null> {
  const r = await open({
    title: o.title,
    message: o.message,
    input: { value: o.value ?? "", placeholder: o.placeholder },
    buttons: [
      { label: o.ok ?? "OK", value: "ok", primary: true },
      { label: "Cancel", value: "cancel" },
    ],
  });
  return r.button === "ok" ? (r.value ?? "").trim() : null;
}

/** A message with one OK button. */
export async function alertDialog(o: { title: string; message?: string }): Promise<void> {
  await open({ title: o.title, message: o.message, buttons: [{ label: "OK", value: "ok", primary: true }] });
}

/** Any set of buttons; the value of the one pressed, or null when dismissed. */
export async function chooseDialog(o: { title: string; message?: string; buttons: DialogButton[] }): Promise<string | null> {
  return (await open(o)).button;
}
