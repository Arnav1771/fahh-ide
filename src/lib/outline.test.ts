import { describe, expect, it } from "vitest";
import { currentItem, outline } from "./outline";

describe("outline", () => {
  it("nests python methods under their class and skips local variables", () => {
    const py = ["import os", "class Todo:", "    def save(self):", "        x = 1", "    async def load(self):", "def main():", "    pass"].join("\n");
    expect(outline(py).map((i) => [i.name, i.kind, i.depth])).toEqual([
      ["Todo", "class", 0],
      ["save", "def", 1],
      ["load", "def", 1],
      ["main", "def", 0],
    ]);
  });

  it("finds TS exports and top-level consts only", () => {
    const ts = "export interface A {}\nexport const f = () => {\n  const inner = 1;\n};\nexport default function g() {}\nexport class C {}";
    expect(outline(ts).map((i) => i.name)).toEqual(["A", "f", "g", "C"]);
  });

  it("reads rust pub items", () => {
    expect(outline("pub struct S;\nimpl S {\n    pub fn new() -> S { S }\n}\npub(crate) async fn run() {}").map((i) => `${i.kind} ${i.name} ${i.depth}`)).toEqual([
      "struct S 0",
      "impl S 0",
      "fn new 1",
      "fn run 0",
    ]);
  });

  it("lists markdown headings, ignoring code fences", () => {
    const md = "# Title\n## Part\n```sh\n# not a heading\n```\n### Sub";
    expect(outline(md, "markdown").map((i) => [i.name, i.depth])).toEqual([["Title", 0], ["Part", 1], ["Sub", 2]]);
  });

  it("picks the item the cursor is in", () => {
    const items = outline("def a():\n    pass\ndef b():\n    pass");
    expect(currentItem(items, 4)?.name).toBe("b");
    expect(currentItem(items, 1)?.name).toBe("a");
  });
});
