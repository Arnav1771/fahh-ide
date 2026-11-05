import { describe, expect, it } from "vitest";
import { groupTodos, relativeTo, todoFromMatch, TODO_QUERY } from "./todos";

const m = (file: string, line: number, text: string) => {
  const i = text.search(/TODO|FIXME|HACK/);
  return { file, line_number: line, line_text: text, match_start: i, match_end: i + 4 };
};

describe("todos", () => {
  it("reads the tag and the note without comment punctuation", () => {
    expect(todoFromMatch(m("/w/a.ts", 3, "  // TODO: wire the cache"))).toEqual({ file: "/w/a.ts", line: 3, column: 6, tag: "TODO", text: "wire the cache" });
    expect(todoFromMatch(m("/w/a.py", 1, "# FIXME(arnav) - off by one"))?.text).toBe("off by one");
    expect(todoFromMatch(m("/w/a.css", 1, "/* HACK for Safari */"))?.text).toBe("for Safari");
    expect(todoFromMatch(m("/w/i.html", 1, "<!-- TODO hero image -->"))?.text).toBe("hero image");
  });
  it("groups by file and sorts by line", () => {
    const g = groupTodos([m("/w/b.ts", 9, "// TODO b9"), m("/w/a.ts", 5, "// HACK a5"), m("/w/b.ts", 2, "// FIXME b2")]);
    expect(g.map((x) => x.file)).toEqual(["/w/a.ts", "/w/b.ts"]);
    expect(g[1].items.map((i) => i.line)).toEqual([2, 9]);
  });
  it("the query is a whole-word regex", () => {
    expect(new RegExp(TODO_QUERY).test("// TODO x")).toBe(true);
    expect(new RegExp(TODO_QUERY).test("todos TODOS")).toBe(false);
  });
  it("relative paths for display", () => {
    expect(relativeTo("/w", "/w/src/a.ts")).toBe("src/a.ts");
    expect(relativeTo("C:\\w\\", "C:\\w\\a.ts")).toBe("a.ts");
    expect(relativeTo(null, "/x")).toBe("/x");
  });
});
