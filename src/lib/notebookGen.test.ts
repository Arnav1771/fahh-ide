import { describe, expect, it } from "vitest";
import { buildGeneratePrompt, describeKernel, insertCodeCell, parseInspect, removeCell, setCellSource, stripFences, toLines } from "./notebookGen";
import { parseNotebook, type NotebookCell } from "./notebook";
import { parseKernelLine } from "./python";

const code = (source: string, outputs: NotebookCell["outputs"] = [], n: number | null = 1): NotebookCell => ({ type: "code", source, executionCount: n, outputs });
const md = (source: string): NotebookCell => ({ type: "markdown", source, executionCount: null, outputs: [] });

describe("stripFences", () => {
  it("keeps only the code from a fenced reply with prose around it", () => {
    expect(stripFences("Here you go:\n```python\ndf.head()\nprint(1)\n```\nThis prints the head.")).toBe("df.head()\nprint(1)");
  });
  it("passes plain code through, trimming blank edges", () => {
    expect(stripFences("\n\nx = 1\n\n")).toBe("x = 1");
  });
  it("handles a partial stream: unfinished fence line, unclosed fence", () => {
    expect(stripFences("```pyth")).toBe("");
    expect(stripFences("```python\nimport numpy as np\nx = np.")).toBe("import numpy as np\nx = np.");
  });
  it("drops a reasoning model's think block, finished or not", () => {
    expect(stripFences("<think>they want a plot</think>\nplt.plot(x)")).toBe("plt.plot(x)");
    expect(stripFences("<think>still thinking")).toBe("");
  });
});

describe("parseInspect", () => {
  it("reads the runner's inspect event (DataFrame, array, scalar, imports)", () => {
    const ev = parseKernelLine(
      JSON.stringify({
        type: "inspect",
        id: "k1",
        vars: [
          { name: "df", type: "pandas.DataFrame", shape: [100, 2], columns: ["price", "city"], dtypes: { price: "float64", city: "object" }, head: "   price city\n0  1.0  A" },
          { name: "arr", type: "numpy.ndarray", shape: [3, 4], dtype: "float64" },
          { name: "n", type: "int", value: "5" },
          { bogus: true },
        ],
        modules: ["import numpy as np", 7],
      }),
    );
    expect(ev).toMatchObject({ type: "inspect", id: "k1" });
    const s = ev && ev.type === "inspect" ? ev.state : null;
    expect(s?.vars.map((v) => v.name)).toEqual(["df", "arr", "n"]);
    expect(s?.vars[0]).toMatchObject({ shape: [100, 2], columns: ["price", "city"], dtypes: { price: "float64" } });
    expect(s?.modules).toEqual(["import numpy as np"]);
  });
  it("keeps the runner's error and survives junk", () => {
    expect(parseInspect({ vars: [], modules: [], error: "timed out" })).toEqual({ vars: [], modules: [], error: "timed out" });
    expect(parseInspect(null)).toEqual({ vars: [], modules: [] });
  });
});

describe("buildGeneratePrompt", () => {
  const kernel = parseInspect({
    vars: [{ name: "df", type: "pandas.DataFrame", shape: [3, 2], columns: ["price", "city"], dtypes: { price: "float64", city: "object" }, head: "price city" }],
    modules: ["import pandas as pd"],
  });

  it("includes the cells above (source and short outputs), the kernel state and the request", () => {
    const cells = [md("# Sales"), code("import pandas as pd\ndf = pd.read_csv('s.csv')", [{ type: "stream", name: "stdout", text: "loaded 3 rows" }]), code("BELOW = 1")];
    const p = buildGeneratePrompt({ cells, at: 2, request: "plot price by city", kernel });
    expect(p).toContain("df = pd.read_csv('s.csv')");
    expect(p).toContain("# loaded 3 rows");
    expect(p).toContain("# Sales");
    expect(p).not.toContain("BELOW"); // cells below the insertion point are not context
    expect(p).toContain("columns: price (float64), city (object)");
    expect(p).toContain("Imports in use: import pandas as pd");
    expect(p).toMatch(/It should: plot price by city$/);
  });

  it("keeps the nearest cells within the budget and says how many were left out", () => {
    const cells = Array.from({ length: 30 }, (_, i) => code(`step_${i} = ${"x".repeat(200)}`));
    const p = buildGeneratePrompt({ cells, at: 30, request: "next", kernel: null, budget: 1000 });
    expect(p).toContain("step_29");
    expect(p).not.toContain("step_0 ");
    expect(p).toMatch(/\d+ earlier cells omitted/);
    expect(p).toContain("No kernel is running");
  });

  it("caps the kernel description too", () => {
    const big = parseInspect({ vars: Array.from({ length: 50 }, (_, i) => ({ name: `v${i}`, type: "str", value: "y".repeat(70) })), modules: [] });
    const d = describeKernel(big, 500);
    expect(d.length).toBeLessThan(700);
    expect(d).toMatch(/more variables not shown/);
  });
});

describe(".ipynb edits", () => {
  const nb45 = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{ cell_type: "code", id: "a", execution_count: 1, metadata: {}, outputs: [{ output_type: "stream", name: "stdout", text: ["hi\n"] }], source: ["print('hi')"] }] });

  it("inserts a code cell (with an id on nbformat 4.5) and keeps the others' outputs", () => {
    const out = insertCodeCell(nb45, 1, "x = 1\ny = 2", "abcd1234");
    const raw = JSON.parse(out);
    expect(raw.cells[1]).toEqual({ cell_type: "code", execution_count: null, metadata: {}, outputs: [], source: ["x = 1\n", "y = 2"], id: "abcd1234" });
    expect(raw.cells[0].outputs).toHaveLength(1);
    const parsed = parseNotebook(out);
    expect("cells" in parsed && parsed.cells[1].source).toBe("x = 1\ny = 2");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("leaves ids out on older nbformat 4 and clamps the position", () => {
    const old = JSON.stringify({ nbformat: 4, nbformat_minor: 2, cells: [] });
    const raw = JSON.parse(insertCodeCell(old, 9, "z"));
    expect(raw.cells).toHaveLength(1);
    expect(raw.cells[0].id).toBeUndefined();
  });

  it("edits a cell's source (outputs kept) and removes a cell", () => {
    const edited = JSON.parse(setCellSource(nb45, 0, "print('bye')\n"));
    expect(edited.cells[0].source).toEqual(["print('bye')\n"]);
    expect(edited.cells[0].outputs).toHaveLength(1);
    expect(JSON.parse(removeCell(nb45, 0)).cells).toEqual([]);
    expect(() => removeCell(nb45, 3)).toThrow(/no longer/);
  });

  it("splits source into nbformat lines", () => {
    expect(toLines("")).toEqual([]);
    expect(toLines("a\nb\n")).toEqual(["a\n", "b\n"]);
  });
});
