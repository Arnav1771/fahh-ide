/**
 * Generate code in a notebook: the model's context and prompt, cleaning its reply, and
 * the .ipynb edits (insert / change / remove a cell). Pure, so it is unit-tested in Node.
 */
import type { NotebookCell, NotebookOutput } from "./notebook";

/** One variable of the live kernel, as the runner's `inspect` reports it. */
export interface KernelVar {
  name: string;
  type: string;
  shape?: number[];
  dtype?: string;
  columns?: string[];
  dtypes?: Record<string, string>;
  head?: string;
  value?: string;
  len?: number;
}

export interface KernelState {
  vars: KernelVar[];
  /** As import statements: "import numpy as np", "from sklearn import datasets". */
  modules: string[];
  error?: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** The runner's `inspect` event, defensively. */
export function parseInspect(raw: unknown): KernelState {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const vars = (Array.isArray(o.vars) ? o.vars : []).flatMap((v): KernelVar[] => {
    if (!v || typeof v !== "object" || typeof (v as KernelVar).name !== "string") return [];
    const r = v as Record<string, unknown>;
    const out: KernelVar = { name: r.name as string, type: str(r.type) ?? "object" };
    if (Array.isArray(r.shape)) out.shape = r.shape.map(Number);
    if (str(r.dtype)) out.dtype = r.dtype as string;
    if (Array.isArray(r.columns)) out.columns = r.columns.map(String);
    if (r.dtypes && typeof r.dtypes === "object") out.dtypes = Object.fromEntries(Object.entries(r.dtypes).map(([k, d]) => [k, String(d)]));
    if (str(r.head)) out.head = r.head as string;
    if (str(r.value)) out.value = r.value as string;
    if (typeof r.len === "number") out.len = r.len;
    return [out];
  });
  const modules = Array.isArray(o.modules) ? o.modules.filter((m): m is string => typeof m === "string") : [];
  return str(o.error) ? { vars, modules, error: o.error as string } : { vars, modules };
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "\n… (truncated)" : s);

function describeVar(v: KernelVar): string {
  if (v.columns) {
    const cols = v.columns.map((c) => (v.dtypes?.[c] ? `${c} (${v.dtypes[c]})` : c)).join(", ");
    const head = v.head ? `\n  head(3):\n${v.head.split("\n").map((l) => "    " + l).join("\n")}` : "";
    return `- ${v.name}: ${v.type}, shape ${JSON.stringify(v.shape ?? [])}\n  columns: ${cols}${head}`;
  }
  if (v.shape) return `- ${v.name}: ${v.type}, shape ${JSON.stringify(v.shape)}${v.dtype ? `, dtype ${v.dtype}` : ""}`;
  if (v.len !== undefined) return `- ${v.name}: ${v.type}, len ${v.len}${v.value ? ` = ${v.value}` : ""}`;
  return `- ${v.name}: ${v.type}${v.value ? ` = ${v.value}` : ""}`;
}

/** The kernel's state as prompt text, capped at `budget` characters. */
export function describeKernel(k: KernelState, budget = 4000): string {
  const lines = ["Live kernel state (these exist right now):"];
  if (k.modules.length) lines.push(`Imports in use: ${k.modules.join("; ")}`);
  let used = lines.join("\n").length;
  let dropped = 0;
  for (const v of k.vars) {
    const d = describeVar(v);
    if (used + d.length > budget) {
      dropped++;
      continue;
    }
    lines.push(d);
    used += d.length + 1;
  }
  if (!k.vars.length) lines.push("(no user variables yet)");
  if (dropped) lines.push(`(${dropped} more variables not shown)`);
  return lines.join("\n");
}

/** Text outputs only (a picture or HTML table is just named), short. */
function describeOutputs(outs: NotebookOutput[], budget = 300): string {
  const parts = outs.map((o) => {
    switch (o.type) {
      case "stream":
      case "text":
        return o.text;
      case "error":
        return `${o.ename}: ${o.evalue}`;
      case "image":
        return "[image]";
      case "html":
        return "[HTML output]";
      case "markdown":
        return o.text;
    }
  });
  const s = parts.join("\n").trim();
  return s ? cut(s, budget) : "";
}

function describeCell(c: NotebookCell): string {
  if (c.type === "markdown") return `# %% [markdown]\n${cut(c.source.trim(), 600)}`;
  const out = describeOutputs(c.outputs);
  return `# %% In [${c.executionCount ?? " "}]\n${cut(c.source.trimEnd(), 1500)}${out ? `\n# Output:\n${out.split("\n").map((l) => "# " + l).join("\n")}` : ""}`;
}

export const GENERATE_SYSTEM = [
  "You write one new Jupyter notebook code cell in Python.",
  "Reply with only the Python code for that cell: no markdown fences, no explanation before or after it. Short comments inside the code are fine.",
  "The cell runs in the same kernel, after the notebook's earlier cells. Use the variables, DataFrame column names and imports that already exist, spelled exactly as given.",
  "Do not re-import modules that are already imported, and do not reload, re-read or recreate data that already exists. Import anything new that you need at the top of the cell.",
].join("\n");

export interface GenerateInput {
  cells: NotebookCell[];
  /** Where the new cell goes: it sees the cells before this index. */
  at: number;
  request: string;
  kernel: KernelState | null;
  /** Characters of notebook source to include (the nearest cells win). */
  budget?: number;
}

/** The user message: the notebook so far (nearest cells first to fit the budget), the live kernel, the request. */
export function buildGeneratePrompt({ cells, at, request, kernel, budget = 12000 }: GenerateInput): string {
  const above = cells.slice(0, at).filter((c) => c.type !== "raw" && c.source.trim());
  const kept: string[] = [];
  let used = 0;
  for (let i = above.length - 1; i >= 0; i--) {
    const d = describeCell(above[i]);
    if (used + d.length > budget) break;
    kept.unshift(d);
    used += d.length;
  }
  const omitted = above.length - kept.length;
  const parts = [
    kept.length
      ? `The notebook so far (the cells above the new one, oldest first${omitted ? `; ${omitted} earlier cells omitted` : ""}):\n\n${kept.join("\n\n")}`
      : "The notebook has no cells above the new one.",
    kernel && !kernel.error
      ? describeKernel(kernel)
      : "No kernel is running, so nothing has been executed in this session; rely on the code above for names.",
    `Write the code for the new cell. It should: ${request.trim()}`,
  ];
  return parts.join("\n\n");
}

/**
 * Only the code: drops a reasoning model's <think> block, prose around a ``` fence and the
 * fence itself. Works on a partial stream too (an unclosed fence or think block).
 */
export function stripFences(text: string): string {
  let s = text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "");
  const open = s.indexOf("```");
  if (open >= 0) {
    const nl = s.indexOf("\n", open);
    if (nl < 0) return ""; // still typing the fence line
    const body = s.slice(nl + 1);
    const close = body.indexOf("```");
    s = close >= 0 ? body.slice(0, close) : body;
  }
  return s.replace(/^\s*\n/, "").trimEnd();
}

// ─── .ipynb edits ─────────────────────────────────────────────────────────────

type Nb = { nbformat?: number; nbformat_minor?: number; cells: Record<string, unknown>[] };

function load(json: string): Nb {
  const nb = JSON.parse(json.replace(/^﻿/, ""));
  if (!nb || !Array.isArray(nb.cells)) throw new Error("No cells found: this does not look like a Jupyter notebook.");
  return nb;
}

/** Jupyter's own layout: one-space indent, trailing newline. */
const dump = (nb: Nb) => JSON.stringify(nb, null, 1) + "\n";

/** nbformat's multiline string: lines that keep their "\n". */
export const toLines = (s: string): string[] => (s ? s.split(/(?<=\n)/) : []);

/** A new code cell at `at` (clamped). nbformat 4.5+ cells need an id. */
export function insertCodeCell(json: string, at: number, source: string, id = Math.random().toString(16).slice(2, 10)): string {
  const nb = load(json);
  const cell: Record<string, unknown> = { cell_type: "code", execution_count: null, metadata: {}, outputs: [], source: toLines(source) };
  if ((nb.nbformat ?? 4) > 4 || (nb.nbformat_minor ?? 0) >= 5) cell.id = id;
  nb.cells.splice(Math.max(0, Math.min(at, nb.cells.length)), 0, cell);
  return dump(nb);
}

/** New source for one cell; its outputs stay (as in Jupyter) until it runs again. */
export function setCellSource(json: string, index: number, source: string): string {
  const nb = load(json);
  if (!nb.cells[index]) throw new Error("That cell is no longer in the notebook.");
  nb.cells[index].source = toLines(source);
  return dump(nb);
}

export function removeCell(json: string, index: number): string {
  const nb = load(json);
  if (!nb.cells[index]) throw new Error("That cell is no longer in the notebook.");
  nb.cells.splice(index, 1);
  return dump(nb);
}
