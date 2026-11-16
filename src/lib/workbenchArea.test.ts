import { describe, expect, it } from "vitest";
import { isEditorArea } from "./workbench";
import { EDITOR_PREFIX, HOME_PREFIX, VIEW_PREFIX } from "./dockLayout";

const editorView = (id: string) => id === VIEW_PREFIX + "settings";

describe("isEditorArea", () => {
  it("a group with only Settings is still the editor area (toggling it must not hide the side bar)", () => {
    expect(isEditorArea([VIEW_PREFIX + "settings"], editorView)).toBe(true);
  });
  it("files or Home make a group the editor area", () => {
    expect(isEditorArea([EDITOR_PREFIX + "a.ts", VIEW_PREFIX + "explorer"], editorView)).toBe(true);
    expect(isEditorArea([HOME_PREFIX + "home"], editorView)).toBe(true);
  });
  it("the Explorer bar stays a side bar, even with Settings dragged into it", () => {
    expect(isEditorArea([VIEW_PREFIX + "explorer"], editorView)).toBe(false);
    expect(isEditorArea([VIEW_PREFIX + "explorer", VIEW_PREFIX + "settings"], editorView)).toBe(false);
    expect(isEditorArea([], editorView)).toBe(false);
  });
});
