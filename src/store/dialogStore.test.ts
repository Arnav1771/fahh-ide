import { beforeEach, describe, expect, it } from "vitest";
import { alertDialog, chooseDialog, confirmDialog, promptDialog, useDialogStore } from "./dialogStore";

const top = () => useDialogStore.getState().queue[0];
const answer = (button: string | null, value?: string) => useDialogStore.getState().answer(top().id, { button, value });

beforeEach(() => useDialogStore.setState({ queue: [] }));

describe("app dialogs", () => {
  it("confirm: true on OK, false on Cancel or Esc", async () => {
    let p = confirmDialog({ title: "Delete?", ok: "Delete", danger: true });
    expect(top().title).toBe("Delete?");
    expect(top().buttons[0]).toMatchObject({ label: "Delete", danger: true });
    answer("ok");
    expect(await p).toBe(true);
    p = confirmDialog({ title: "Again?" });
    answer("cancel");
    expect(await p).toBe(false);
    p = confirmDialog({ title: "Esc?" });
    answer(null);
    expect(await p).toBe(false);
    expect(useDialogStore.getState().queue).toEqual([]);
  });
  it("prompt: the trimmed text on OK, null when cancelled", async () => {
    let p = promptDialog({ title: "URL", value: "5173" });
    expect(top().input).toEqual({ value: "5173", placeholder: undefined });
    answer("ok", "  3000 ");
    expect(await p).toBe("3000");
    p = promptDialog({ title: "URL" });
    answer(null, "typed");
    expect(await p).toBeNull();
  });
  it("shows one dialog at a time, in order", async () => {
    const a = alertDialog({ title: "first" });
    const b = chooseDialog({ title: "second", buttons: [{ label: "X", value: "x" }] });
    expect(useDialogStore.getState().queue.map((d) => d.title)).toEqual(["first", "second"]);
    answer("ok");
    await a;
    expect(top().title).toBe("second");
    answer("x");
    expect(await b).toBe("x");
  });
});
