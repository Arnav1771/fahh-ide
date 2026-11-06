import { describe, expect, it } from "vitest";
import { planChecklist, starterPrompts } from "./agentStarters";
import { groupSteps, stepsSummary, type Item } from "./agentState";

describe("starterPrompts", () => {
  it("names the stack from the top-level files", () => {
    expect(starterPrompts(["Cargo.toml", "src"]).stack).toBe("Rust");
    expect(starterPrompts(["package.json", "tsconfig.json", "vite.config.ts"]).stack).toBe("TypeScript + Vite");
    expect(starterPrompts(["package.json", "next.config.mjs"]).stack).toBe("JavaScript + Next.js");
    expect(starterPrompts(["pyproject.toml"]).stack).toBe("Python");
    expect(starterPrompts(["go.mod"]).stack).toBe("Go");
    expect(starterPrompts(["notes.txt"]).stack).toBeNull();
  });

  it("always offers four prompts that fit the stack", () => {
    for (const names of [["Cargo.toml"], ["package.json", "tsconfig.json"], ["requirements.txt"], ["go.mod"], []]) {
      expect(starterPrompts(names).prompts).toHaveLength(4);
    }
    expect(starterPrompts(["Cargo.toml"]).prompts[0]).toMatch(/cargo check/);
    expect(starterPrompts(["package.json", "tsconfig.json"]).prompts[0]).toMatch(/type checker/);
    expect(starterPrompts(["package.json", "next.config.js"]).prompts).toContain("List the API routes and check that each one validates its input");
  });
});

describe("planChecklist", () => {
  it("reads - [ ] and - [x] lines", () => {
    expect(planChecklist("# Plan\n\n- [x] one\n- [ ] two\n1. [X] three\nprose")).toEqual([
      { done: true, text: "one" },
      { done: false, text: "two" },
      { done: true, text: "three" },
    ]);
  });
  it("null for a plan without checkboxes", () => expect(planChecklist("# Plan\n\n1. Read\n2. Write")).toBeNull());
});

describe("groupSteps", () => {
  const tool = (id: string, toolKind: "read" | "edit" | "run" = "read"): Item => ({ kind: "tool", id, name: "read_file", toolKind, args: {}, status: "ok" });
  it("folds consecutive tool calls into one timeline and keeps everything else", () => {
    const items: Item[] = [
      { kind: "user", text: "hi" },
      tool("a"),
      tool("b", "edit"),
      { kind: "assistant", turn: 1, text: "x" },
      tool("c", "run"),
    ];
    const blocks = groupSteps(items);
    expect(blocks.map((b) => b.kind)).toEqual(["item", "steps", "item", "steps"]);
    expect(blocks[1].kind === "steps" && blocks[1].items.map((t) => t.id)).toEqual(["a", "b"]);
    expect(blocks[3].index).toBe(4);
  });
  it("summarises a run by kind", () => {
    expect(stepsSummary([{ toolKind: "read" }, { toolKind: "edit" }, { toolKind: "read" }, { toolKind: "run" }])).toBe("read 2, edited 1, ran 1");
  });
});
