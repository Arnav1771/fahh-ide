/**
 * Jupyter notebook (.ipynb, nbformat 4) reader for the read-only notebook
 * preview. Pure: no React, Monaco or Tauri, so it is unit-tested in Node.
 * Never throws; bad input comes back as `{ error }`.
 */
import { ANSI } from "./preview";

export type NotebookOutput =
  | { type: "stream"; name: "stdout" | "stderr"; text: string }
  | { type: "image"; mime: string; src: string }
  | { type: "html"; html: string }
  | { type: "markdown"; text: string }
  | { type: "text"; text: string }
  | { type: "error"; ename: string; evalue: string; traceback: string };

export interface NotebookCell {
  type: "markdown" | "code" | "raw";
  source: string;
  executionCount: number | null;
  outputs: NotebookOutput[];
}

export interface Notebook {
  language: string;
  cells: NotebookCell[];
}

export type ParsedNotebook = Notebook | { error: string };

/** nbformat stores multiline text as a string or an array of lines. */
const text = (v: unknown): string => (Array.isArray(v) ? v.join("") : typeof v === "string" ? v : "");
const stripAnsi = (s: string) => s.replace(ANSI, "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Best representation of a mimebundle, Jupyter-style preference order. */
function fromBundle(data: Record<string, unknown>): NotebookOutput | null {
  for (const mime of ["image/png", "image/jpeg"]) {
    if (data[mime]) return { type: "image", mime, src: `data:${mime};base64,${text(data[mime]).replace(/\s/g, "")}` };
  }
  if (data["image/svg+xml"]) {
    return { type: "image", mime: "image/svg+xml", src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text(data["image/svg+xml"]))}` };
  }
  if (data["text/html"]) return { type: "html", html: text(data["text/html"]) };
  if (data["text/markdown"]) return { type: "markdown", text: text(data["text/markdown"]) };
  if (data["text/plain"] !== undefined) return { type: "text", text: stripAnsi(text(data["text/plain"])) };
  return null;
}

function parseOutput(raw: unknown): NotebookOutput | null {
  const o = obj(raw);
  switch (o.output_type) {
    case "stream":
      return { type: "stream", name: o.name === "stderr" ? "stderr" : "stdout", text: stripAnsi(text(o.text)) };
    case "execute_result":
    case "display_data":
      return fromBundle(obj(o.data));
    case "error":
      return {
        type: "error",
        ename: String(o.ename ?? "Error"),
        evalue: String(o.evalue ?? ""),
        traceback: stripAnsi(Array.isArray(o.traceback) ? o.traceback.join("\n") : text(o.traceback)),
      };
    default:
      return null;
  }
}

export function parseNotebook(json: string): ParsedNotebook {
  let nb: Record<string, unknown>;
  try {
    nb = obj(JSON.parse(json.replace(/^\uFEFF/, "")));
  } catch (e) {
    return { error: `Not valid notebook JSON: ${(e as Error).message}` };
  }
  if (!Array.isArray(nb.cells)) {
    // ponytail: nbformat 3 (worksheets) not rendered; Jupyter itself upgrades those on open.
    return { error: nb.worksheets ? "nbformat 3 notebooks are not supported; open the source instead." : "No cells found: this does not look like a Jupyter notebook." };
  }
  const meta = obj(nb.metadata);
  const language = String(obj(meta.kernelspec).language ?? obj(meta.language_info).name ?? "python").toLowerCase();
  const cells: NotebookCell[] = nb.cells.map((raw) => {
    const c = obj(raw);
    const type = c.cell_type === "markdown" || c.cell_type === "code" ? c.cell_type : "raw";
    return {
      type,
      source: text(c.source),
      executionCount: typeof c.execution_count === "number" ? c.execution_count : null,
      outputs: Array.isArray(c.outputs) ? c.outputs.map(parseOutput).filter((o): o is NotebookOutput => o !== null) : [],
    };
  });
  return { language, cells };
}
