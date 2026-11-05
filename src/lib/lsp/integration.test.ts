/**
 * End-to-end: a real language server (pyright, typescript-language-server) driven
 * through LspClient over stdio, with the replies run through the same mappers the
 * Monaco providers use. Skipped unless FAHH_LSP_IT=1 and the server is on PATH:
 *
 *   FAHH_LSP_IT=1 PATH=/path/to/node_modules/.bin:$PATH npx vitest run src/lib/lsp/integration.test.ts
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { LspClient, type LspTransport } from "./client";
import { applyTextEdits, completionsToMonaco, flattenWorkspaceEdit, hoverToMonaco, locationsToMonaco, signatureHelpToMonaco, MonacoCompletionKind } from "./protocol";
import { configurationFor } from "./servers";

const has = (bin: string) => spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0;
const enabled = process.env.FAHH_LSP_IT === "1";

const COMMANDS: Record<string, [string, string[]]> = {
  python: ["pyright-langserver", ["--stdio"]],
  typescript: ["typescript-language-server", ["--stdio"]],
};

/** The same framing lsp_client.rs does, in Node. */
function stdioTransport(onMessage: (server: string, msg: unknown) => void): LspTransport & { kill(): void } {
  const procs = new Map<string, ChildProcessWithoutNullStreams>();
  return {
    async start(server, workspace) {
      const [cmd, args] = COMMANDS[server];
      const p = spawn(cmd, args, { cwd: workspace });
      procs.set(server, p);
      let buf = Buffer.alloc(0);
      p.stdout.on("data", (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        for (;;) {
          const headerEnd = buf.indexOf("\r\n\r\n");
          if (headerEnd < 0) return;
          const len = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, headerEnd).toString())?.[1]);
          if (buf.length < headerEnd + 4 + len) return;
          const body = buf.subarray(headerEnd + 4, headerEnd + 4 + len).toString("utf8");
          buf = buf.subarray(headerEnd + 4 + len);
          onMessage(server, JSON.parse(body));
        }
      });
      p.stderr.on("data", () => {});
    },
    async send(server, message) {
      const p = procs.get(server);
      if (!p) throw new Error("not running");
      p.stdin.write(`Content-Length: ${Buffer.byteLength(message, "utf8")}\r\n\r\n${message}`);
    },
    async stop(server) {
      procs.get(server)?.kill();
      procs.delete(server);
    },
    kill() {
      for (const p of procs.values()) p.kill();
    },
  };
}

function setup() {
  let client!: LspClient;
  const diagnostics: Record<string, unknown[]> = {};
  const statuses: string[] = [];
  const transport = stdioTransport((s, m) => client.handleMessage(s, m));
  client = new LspClient(transport, {
    onStatus: (s, st, detail) => statuses.push(`${s}:${st}${detail ? " " + detail : ""}`),
    configuration: (s, sec, uri) => configurationFor(s, sec, uri),
    onNotification: (_s, method, params) => {
      if (method === "textDocument/publishDiagnostics") {
        const p = params as { uri: string; diagnostics: unknown[] };
        diagnostics[p.uri] = p.diagnostics;
      }
    },
  });
  return { client, transport, diagnostics, statuses };
}

const word = (line: number, col: number) => ({ startLineNumber: line + 1, startColumn: col + 1, endLineNumber: line + 1, endColumn: col + 1 });

/** Retry while the server is still indexing (an empty answer right after start is normal). */
async function until<T>(f: () => Promise<T | null>, ok: (v: T) => boolean, tries = 20): Promise<T> {
  let last: T | null = null;
  for (let i = 0; i < tries; i++) {
    last = await f();
    if (last && ok(last)) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("no usable answer: " + JSON.stringify(last)?.slice(0, 300));
}

describe.skipIf(!enabled || !has("pyright-langserver"))("pyright through LspClient", () => {
  const dir = mkdtempSync(join(tmpdir(), "fahh-py-"));
  writeFileSync(join(dir, "helpers.py"), 'def greet(name: str) -> str:\n    """Say hello."""\n    return "hi " + name\n');
  const mainText = "import os\nfrom helpers import greet\n\ngreet(\"x\")\nos.pa\n";
  writeFileSync(join(dir, "main.py"), mainText);
  const root = pathToFileURL(dir).href;
  const main = pathToFileURL(join(dir, "main.py")).href;
  const { client, transport, diagnostics } = setup();
  afterAll(() => transport.kill());

  it("initializes, then completes, hovers and jumps across files", async () => {
    expect(await client.ensureServer("python", dir, root)).toBe(true);
    expect(client.capabilities("python").completionProvider).toBeTruthy();
    client.openDocument("python", main, "python", 1, mainText);

    // Completion after "os.pa" -> os.path, as a Module, replacing "pa".
    const comp = await until(
      () => client.request<any>("python", "textDocument/completion", { textDocument: { uri: main }, position: { line: 4, character: 5 }, context: { triggerKind: 1 } }, { timeoutMs: 15000 }), // eslint-disable-line @typescript-eslint/no-explicit-any
      (r) => completionsToMonaco(r, word(4, 3)).suggestions.some((s) => s.label === "path")
    );
    const path = completionsToMonaco(comp, word(4, 3), "python").suggestions.find((s) => s.label === "path")!;
    // pyright calls the os.path alias a variable; the mapping must follow the server's kind.
    expect([MonacoCompletionKind.Module, MonacoCompletionKind.Variable]).toContain(path.kind);
    expect(path.insertText).toBe("path");

    // Hover on greet -> markdown with the signature and the docstring.
    const hover = hoverToMonaco(
      await until(
        () => client.request<any>("python", "textDocument/hover", { textDocument: { uri: main }, position: { line: 3, character: 1 } }, { timeoutMs: 15000 }), // eslint-disable-line @typescript-eslint/no-explicit-any
        (h) => !!h?.contents
      )
    );
    const text = hover!.contents.map((c) => c.value).join("\n");
    expect(text).toContain("greet");
    expect(text).toContain("Say hello");

    // Definition of greet -> helpers.py line 1.
    const defs = locationsToMonaco(
      await until(
        () => client.request<any>("python", "textDocument/definition", { textDocument: { uri: main }, position: { line: 3, character: 1 } }, { timeoutMs: 15000 }), // eslint-disable-line @typescript-eslint/no-explicit-any
        (d) => locationsToMonaco(d).length > 0
      )
    );
    expect(defs[0].uri).toBe(pathToFileURL(join(dir, "helpers.py")).href);
    expect(defs[0].range.startLineNumber).toBe(1);

    // Signature help inside greet( -> one signature with the name parameter.
    const change = "greet(\"x\")\nos.path\ngreet(";
    client.changeDocument("python", main, 2, [{ range: { start: { line: 3, character: 0 }, end: { line: 5, character: 0 } }, text: change + "\n" }], () => "import os\nfrom helpers import greet\n\n" + change + "\n");
    const sig = signatureHelpToMonaco(
      await until(
        () => client.request<any>("python", "textDocument/signatureHelp", { textDocument: { uri: main }, position: { line: 5, character: 6 }, context: { triggerKind: 2, triggerCharacter: "(", isRetrigger: false } }, { timeoutMs: 15000 }), // eslint-disable-line @typescript-eslint/no-explicit-any
        (s) => !!s?.signatures?.length
      )
    );
    expect(sig!.signatures[0].label).toContain("name: str");
    // Diagnostics flowed (pyright publishes for open files).
    expect(Object.keys(diagnostics)).toContain(main);
  }, 90000);
});

describe.skipIf(!enabled || !has("typescript-language-server"))("typescript-language-server through LspClient", () => {
  const dir = mkdtempSync(join(tmpdir(), "fahh-ts-"));
  writeFileSync(join(dir, "tsconfig.json"), '{"compilerOptions":{"strict":true,"target":"ES2022","module":"ESNext","moduleResolution":"Bundler"}}');
  writeFileSync(join(dir, "util.ts"), "/** Adds two numbers. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n");
  const mainText = 'import { add } from "./util";\nconst total = add(1, 2);\ntotal.toF\n';
  writeFileSync(join(dir, "main.ts"), mainText);
  // typescript-language-server uses the project's own TypeScript, like a real project has.
  mkdirSync(join(dir, "node_modules"));
  try {
    const tsc = spawnSync("sh", ["-c", "command -v typescript-language-server"]).stdout.toString().trim();
    const tsDir = dirname(createRequire(tsc.replace(/\/\.bin\/[^/]+$/, "/typescript-language-server/package.json")).resolve("typescript/package.json"));
    symlinkSync(tsDir, join(dir, "node_modules", "typescript"), "dir");
  } catch {
    // no sibling TypeScript: the server will say so
  }
  const root = pathToFileURL(dir).href;
  const main = pathToFileURL(join(dir, "main.ts")).href;
  const { client, transport, statuses } = setup();
  afterAll(() => transport.kill());

  it("initializes, then completes, hovers, finds references and renames", async () => {
    expect(await client.ensureServer("typescript", dir, root), statuses.join(" | ")).toBe(true);
    client.openDocument("typescript", main, "typescript", 1, mainText);

    const comp = await until(
      () => client.request<any>("typescript", "textDocument/completion", { textDocument: { uri: main }, position: { line: 2, character: 9 }, context: { triggerKind: 1 } }, { timeoutMs: 15000 }), // eslint-disable-line @typescript-eslint/no-explicit-any
      (r) => completionsToMonaco(r, word(2, 6)).suggestions.some((s) => s.label === "toFixed")
    );
    const toFixed = completionsToMonaco(comp, word(2, 6), "typescript").suggestions.find((s) => s.label === "toFixed")!;
    expect(toFixed.kind).toBe(MonacoCompletionKind.Method);
    const r = "insert" in toFixed.range ? toFixed.range.replace : toFixed.range;
    expect(r.startLineNumber).toBe(3);

    const hover = hoverToMonaco(
      await until(
        () => client.request<any>("typescript", "textDocument/hover", { textDocument: { uri: main }, position: { line: 1, character: 15 } }, { timeoutMs: 15000 }), // eslint-disable-line @typescript-eslint/no-explicit-any
        (h) => !!h?.contents
      )
    );
    expect(hover!.contents.map((c) => c.value).join("\n")).toContain("add(a: number, b: number): number");

    const defs = locationsToMonaco(await client.request<any>("typescript", "textDocument/definition", { textDocument: { uri: main }, position: { line: 1, character: 15 } }, { timeoutMs: 15000 })); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(defs.some((d) => d.uri.endsWith("/util.ts") && d.range.startLineNumber === 2)).toBe(true);

    const refs = locationsToMonaco(await client.request<any>("typescript", "textDocument/references", { textDocument: { uri: main }, position: { line: 1, character: 15 }, context: { includeDeclaration: true } }, { timeoutMs: 15000 })); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(refs.length).toBeGreaterThanOrEqual(3); // declaration, import, call

    // Rename at the declaration reaches the importing file too (at a use site tsserver
    // aliases the import instead, as VS Code does).
    const util = pathToFileURL(join(dir, "util.ts")).href;
    const utilText = "/** Adds two numbers. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n";
    client.openDocument("typescript", util, "typescript", 1, utilText);
    const edit = await client.requestStrict<any>("typescript", "textDocument/rename", { textDocument: { uri: util }, position: { line: 1, character: 17 }, newName: "sum" }, { timeoutMs: 15000 }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const { edits } = flattenWorkspaceEdit(edit);
    expect([...edits.keys()].some((u) => u.endsWith("/main.ts"))).toBe(true);
    expect(applyTextEdits(utilText, edits.get(util) ?? [])).toContain("export function sum(");
    expect(applyTextEdits(mainText, [...edits.entries()].find(([u]) => u.endsWith("/main.ts"))![1])).toBe('import { sum } from "./util";\nconst total = sum(1, 2);\ntotal.toF\n');
  }, 90000);
});
