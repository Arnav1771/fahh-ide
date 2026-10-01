import { describe, expect, it } from "vitest";
import { fuzzyScore, rankCommands, type PaletteCommand } from "./palette";

const cmd = (id: string, group: string, label: string, keywords?: string): PaletteCommand => ({
  id, group, label, keywords, run: () => {},
});

const COMMANDS = [
  cmd("view.explorer", "View", "Explorer", "files"),
  cmd("view.git", "View", "Source Control", "git branch"),
  cmd("theme.dracula", "Theme", "Dracula"),
  cmd("theme.gold", "Theme", "Fahh Gold"),
  cmd("panel.toggle", "View", "Toggle Panel", "terminal"),
  cmd("fahh.ring", "Fahh", "Ring the Bell", "test sound"),
];

describe("palette search", () => {
  it("matches characters in order and rejects the rest", () => {
    expect(fuzzyScore("drc", "Dracula")).toBeGreaterThan(0);
    expect(fuzzyScore("xyz", "Dracula")).toBe(-1);
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  it("an empty query keeps the original order", () => {
    expect(rankCommands("", COMMANDS).map((c) => c.id)).toEqual(COMMANDS.map((c) => c.id));
  });

  it("finds by label, by group and by keyword", () => {
    expect(rankCommands("dracula", COMMANDS)[0].id).toBe("theme.dracula");
    expect(rankCommands("theme gold", COMMANDS)[0].id).toBe("theme.gold");
    expect(rankCommands("git", COMMANDS)[0].id).toBe("view.git");
    expect(rankCommands("terminal", COMMANDS)[0].id).toBe("panel.toggle");
    expect(rankCommands("bell", COMMANDS)[0].id).toBe("fahh.ring");
  });

  it("keywords match as words, so they do not let unrelated commands through", () => {
    const withLongKeywords = [...COMMANDS, cmd("folder.open", "File", "Open Folder", "workspace project")];
    expect(rankCommands("drac", withLongKeywords).map((c) => c.id)).toEqual(["theme.dracula"]);
    expect(rankCommands("proj", withLongKeywords)[0].id).toBe("folder.open");
  });

  it("prefers word starts over scattered letters", () => {
    expect(fuzzyScore("sc", "Source Control")).toBeGreaterThan(fuzzyScore("sc", "Describe"));
  });
});
