/**
 * Debug configurations: `.vscode/launch.json` (VS Code's format, so existing projects
 * work unchanged) plus a sensible default per language when there is none.
 */

export interface LaunchConfig {
  name: string;
  type: string;
  request: "launch" | "attach";
  [key: string]: unknown;
}

/** Parse JSON with comments and trailing commas, as launch.json allows. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") out += text[++i] ?? "";
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i < 0) break;
      i++;
    } else {
      out += ch;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** The launch configurations in a launch.json text; [] when it is missing or broken. */
export function readConfigurations(text: string): LaunchConfig[] {
  try {
    const json = parseJsonc(text) as { configurations?: unknown };
    if (!Array.isArray(json?.configurations)) return [];
    return json.configurations.filter(
      (c): c is LaunchConfig =>
        !!c && typeof c === "object" && typeof (c as LaunchConfig).name === "string" && typeof (c as LaunchConfig).type === "string"
    );
  } catch {
    return [];
  }
}

export interface VarContext {
  /** The active file, absolute. */
  file: string;
  /** The open folder, absolute. */
  workspaceFolder: string;
}

const sepOf = (p: string) => (p.includes("\\") && !p.includes("/") ? "\\" : "/");
const lastSep = (p: string) => Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
export const dirnameOf = (p: string) => (lastSep(p) > 0 ? p.slice(0, lastSep(p)) : p);
export const basenameOf = (p: string) => p.slice(lastSep(p) + 1);

/** Replace ${file}, ${workspaceFolder} and friends in every string, however deeply nested. */
export function substitute<T>(value: T, ctx: VarContext): T {
  const base = basenameOf(ctx.file);
  const dot = base.lastIndexOf(".");
  const rel = ctx.file.startsWith(ctx.workspaceFolder) ? ctx.file.slice(ctx.workspaceFolder.length).replace(/^[\\/]/, "") : ctx.file;
  const vars: Record<string, string> = {
    file: ctx.file,
    fileDirname: dirnameOf(ctx.file),
    fileBasename: base,
    fileBasenameNoExtension: dot > 0 ? base.slice(0, dot) : base,
    fileExtname: dot > 0 ? base.slice(dot) : "",
    relativeFile: rel,
    workspaceFolder: ctx.workspaceFolder,
    workspaceFolderBasename: basenameOf(ctx.workspaceFolder),
    workspaceRoot: ctx.workspaceFolder,
    cwd: ctx.workspaceFolder,
    pathSeparator: sepOf(ctx.workspaceFolder || ctx.file),
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(/\$\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** Which adapter debug_start should run for a launch.json `type`; null when there is none. */
export function adapterFor(type: string): string | null {
  switch (type.toLowerCase()) {
    case "python":
    case "debugpy":
      return "debugpy";
    case "go":
      return "dlv-dap";
    case "lldb":
    case "lldb-dap":
    case "codelldb":
    case "cppdbg":
      return "lldb-dap";
    case "node":
    case "pwa-node":
      return "js-debug";
    default:
      return null;
  }
}

/** The configuration used when the folder has no launch.json. */
export function defaultConfigFor(language: string): LaunchConfig | null {
  switch (language.toLowerCase()) {
    case "python":
      return { name: "Python: Current File", type: "debugpy", request: "launch", program: "${file}", console: "internalConsole", justMyCode: true };
    case "go":
      return { name: "Go: Current Package", type: "go", request: "launch", mode: "debug", program: "${fileDirname}" };
    case "rust":
      return { name: "Rust: Debug Binary", type: "lldb", request: "launch", program: "${workspaceFolder}/target/debug/${workspaceFolderBasename}" };
    case "c":
    case "cpp":
      return { name: "C/C++: Debug Binary", type: "lldb", request: "launch", program: "${fileDirname}/${fileBasenameNoExtension}" };
    case "javascript":
    case "typescript":
      return { name: "Node: Current File", type: "node", request: "launch", program: "${file}" };
    default:
      return null;
  }
}

/** The `launch` request arguments: the config minus VS Code's own keys, plus defaults. */
export function launchArguments(cfg: LaunchConfig, ctx: VarContext): Record<string, unknown> {
  const { name: _n, type, request: _r, preLaunchTask: _p, postDebugTask: _q, presentation: _s, ...rest } = cfg;
  const args: Record<string, unknown> = { cwd: ctx.workspaceFolder, ...rest };
  // debugpy's default console is a terminal it asks the editor to open; Fahh shows output in the Debug Console.
  if (adapterFor(type) === "debugpy" && (!args.console || args.console === "integratedTerminal")) args.console = "internalConsole";
  // ...and only sends the program's prints as output events when asked to.
  if (adapterFor(type) === "debugpy" && args.redirectOutput === undefined) args.redirectOutput = true;
  return args;
}

/** A starter launch.json for the active file's language. */
export function launchJsonTemplate(language: string): string {
  const cfg = defaultConfigFor(language) ?? defaultConfigFor("python")!;
  return `{
  // Debug configurations, in VS Code's launch.json format.
  // Variables: \${file}, \${fileDirname}, \${workspaceFolder}, \${workspaceFolderBasename}.
  "version": "0.2.0",
  "configurations": [
${JSON.stringify(cfg, null, 2)
  .split("\n")
  .map((l) => "    " + l)
  .join("\n")}
  ]
}
`;
}
