import { describe, it, expect } from "vitest";
import { classify, docFor, explainPrompt, isDefinitionLine } from "./deepwiki";

describe("definition lines", () => {
  it("recognises declarations across languages", () => {
    const defs = [
      "def load_config(path):",
      "class Loader:",
      "async def load_config(path):",
      "export function loadConfig(path: string) {",
      "export default async function loadConfig() {",
      "pub fn load_config(path: &Path) -> Config {",
      "pub(crate) struct Loader {",
      "const loadConfig = (path) => {",
      "export const loadConfig = async (path: string): Promise<Config> => {",
      "let loadConfig = function () {",
      "func loadConfig(path string) error {",
      "interface Loader {",
      "type Loader = { path: string }",
      "int load_config(const char *path) {",
      "std::string Config::load_config(int x) const",
    ];
    for (const line of defs) {
      const name = /load_config|loadConfig|Loader/.exec(line)![0];
      expect(isDefinitionLine(line, name), line).toBe(true);
    }
  });

  it("does not take calls and references for definitions", () => {
    const uses = [
      "cfg = load_config(path)",
      "    return load_config(p);",
      "if (loadConfig(x)) {",
      "import { loadConfig } from './config';",
      "result := loadConfig(p)",
      "const cfg = loadConfig(path);",
      "load_config(path);",
      "x = Loader()",
    ];
    for (const line of uses) {
      const name = /load_config|loadConfig|Loader/.exec(line)![0];
      expect(isDefinitionLine(line, name), line).toBe(false);
    }
  });

  it("splits search hits", () => {
    const m = (line_text: string, line_number: number) => ({ file: "/w/a.py", line_number, line_text, match_start: 0, match_end: 0 });
    const { definitions, usages } = classify([m("def run():", 1), m("run()", 9), m("x = run()", 12)], "run");
    expect(definitions.map((d) => d.line_number)).toEqual([1]);
    expect(usages.map((d) => d.line_number)).toEqual([9, 12]);
  });
});

describe("documentation", () => {
  it("takes the comment block above, without markers", () => {
    const ts = ["import x from 'y';", "", "/**", " * Loads the config.", " * @param path where it lives", " */", "export function load(path) {}"].join("\n");
    expect(docFor(ts, 7)).toBe("Loads the config.\n@param path where it lives");
    const rs = ["/// Adds two numbers.", "/// Saturates on overflow.", "#[inline]", "pub fn add(a: u8, b: u8) -> u8 {"].join("\n");
    expect(docFor(rs, 4)).toBe("Adds two numbers.\nSaturates on overflow.");
  });

  it("takes a Python docstring below", () => {
    const py = ['def area(r):', '    """Area of a circle.', "", '    r: radius."""', "    return 3.14 * r * r"].join("\n");
    expect(docFor(py, 1)).toBe("Area of a circle.\n\nr: radius.");
    expect(docFor(['def f():', '    """One line."""'].join("\n"), 1)).toBe("One line.");
  });

  it("is empty when undocumented", () => {
    expect(docFor("x = 1\ndef f():\n    pass", 2)).toBe("");
  });
});

describe("explain prompt", () => {
  it("names the symbol, where it is defined and used, relative to the folder, and forbids edits", () => {
    const p = explainPrompt("run", { file: "/w/src/a.py", line_number: 3, line_text: "", match_start: 0, match_end: 0 }, ["/w/src/b.py"], "/w");
    expect(p).toContain("`run`");
    expect(p).toContain("src/a.py at line 3");
    expect(p).toContain("used in: src/b.py");
    expect(p).toContain("Do not change any files");
  });
});
