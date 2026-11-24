// The `fahh agent --json` protocol, the provider table, slash commands and starter prompts.
// No VS Code imports here, so it is unit-tested with plain node.
import * as fs from "fs";
import * as path from "path";
import type { Usage } from "./qol";

/** Every provider fahh-agent knows (src-tauri/src/agent/cli.rs `preset`). Empty keyEnv: no key. */
export const PROVIDERS: { id: string; label: string; keyEnv: string; keyUrl?: string }[] = [
  { id: "groq", label: "Groq", keyEnv: "GROQ_API_KEY", keyUrl: "https://console.groq.com/keys" },
  { id: "gemini", label: "Google Gemini", keyEnv: "GEMINI_API_KEY", keyUrl: "https://aistudio.google.com/apikey" },
  { id: "nvidia", label: "NVIDIA NIM", keyEnv: "NVIDIA_API_KEY", keyUrl: "https://build.nvidia.com" },
  { id: "openrouter", label: "OpenRouter", keyEnv: "OPENROUTER_API_KEY", keyUrl: "https://openrouter.ai/keys" },
  { id: "anthropic", label: "Anthropic", keyEnv: "ANTHROPIC_API_KEY", keyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "ollama", label: "Ollama (local)", keyEnv: "" },
];

export const KEY_ENV: Record<string, string> = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.keyEnv]));

export const providerLabel = (id: string): string => PROVIDERS.find((p) => p.id === id)?.label ?? id;

/** The child's environment: the parent's, plus the stored key for this provider (a stored key wins). */
export function agentEnv(provider: string, key: string | undefined, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base };
  const name = KEY_ENV[provider];
  if (name && key) env[name] = key;
  return env;
}

/** Whether the provider can run: keyless, a stored key, or a key already in the environment. */
export function keyState(provider: string, stored: boolean, env: NodeJS.ProcessEnv): "none-needed" | "stored" | "env" | "missing" {
  const name = KEY_ENV[provider];
  if (!name) return "none-needed";
  if (stored) return "stored";
  return env[name]?.trim() ? "env" : "missing";
}

export const MODES: { id: string; label: string; desc: string; warn?: boolean }[] = [
  { id: "normal", label: "Normal", desc: "Asks before every edit and every command." },
  { id: "accept-edits", label: "Accept edits", desc: "Edits apply right away; commands still ask." },
  { id: "smart", label: "Smart", desc: "Edits apply; a judge model screens each command." },
  { id: "plan", label: "Plan", desc: "Reads only, then writes a plan for you to approve." },
  { id: "bypass", label: "Bypass", desc: "Asks for nothing. Only deny rules in .fahh/permissions.json still apply.", warn: true },
];

/**
 * Slash commands the chat understands; the extension runs each of them (see extension.ts).
 * `feature`: needs a fahh-agent whose --json ready line lists the command in "features".
 */
export const SLASH: { name: string; args?: string; desc: string; feature?: boolean }[] = [
  { name: "new", desc: "Start a fresh session" },
  { name: "model", args: "[id]", desc: "Pick or set the model" },
  { name: "provider", args: "[name]", desc: "Switch provider: Groq, Gemini, NVIDIA, OpenRouter, Anthropic, Ollama" },
  { name: "mode", args: "[mode]", desc: "Switch permission mode" },
  { name: "resume", args: "[id]", desc: "Continue a saved session of this folder" },
  { name: "ask", args: "<question>", desc: "Read-only question: nothing is changed" },
  { name: "plan", args: "[prompt]", desc: "Plan mode: research, then write a plan" },
  { name: "copy", desc: "Copy the last reply" },
  { name: "export", desc: "Open the conversation, tool calls included, as Markdown" },
  { name: "compact", feature: true, desc: "Fold older turns into a summary to free context" },
  { name: "usage", feature: true, desc: "Model calls, tokens and context used" },
  { name: "permissions", desc: "Auto-approve rules for edits and commands" },
  { name: "clear", desc: "Clear the chat view; the session continues" },
  { name: "keys", desc: "Add or remove a provider's API key" },
  { name: "settings", desc: "Provider, model, keys and the Fahh program path" },
  { name: "help", desc: "Commands and shortcuts" },
];

/** The commands this agent supports: one that needs a feature is left out until the agent lists it. */
export const slashFor = (features: string[] | undefined) => SLASH.filter((c) => !c.feature || !!features?.includes(c.name));

/** `null`: not a command, send it as a prompt. A lone "/" and paths like "/usr/bin/x" are prompts. */
export function parseSlash(text: string): { name: string; arg: string } | { error: string } | null {
  const t = text.trim();
  if (!t.startsWith("/")) return null;
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(t.slice(1));
  if (!m || m[1].includes("/")) return null;
  const name = m[1].toLowerCase();
  if (!SLASH.some((c) => c.name === name)) return { error: `Unknown command /${name}. Type /help for the list.` };
  return { name, arg: (m[2] ?? "").trim() };
}

/** The popup's filter: names that start with the query first, then names or descriptions that contain it. */
export function filterSlash(query: string, list = SLASH): typeof SLASH {
  const q = query.replace(/^\//, "").toLowerCase();
  const starts = list.filter((c) => c.name.startsWith(q));
  const has = list.filter((c) => !c.name.startsWith(q) && (c.name.includes(q) || c.desc.toLowerCase().includes(q)));
  return [...starts, ...has];
}

/** `fahh-agent sessions ls` lines: `<id>  <n> step(s)  <title>`. */
export function parseSessions(out: string): { id: string; steps: number; title: string }[] {
  const res: { id: string; steps: number; title: string }[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^(\S+)\s+(\d+) step\(s\)\s*(.*)$/.exec(line.trim());
    if (m) res.push({ id: m[1], steps: Number(m[2]), title: m[3].trim() });
  }
  return res;
}

/** `fahh-agent models list`: one id per line. */
export const parseModels = (out: string): string[] => out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** Facts about the open folder that the starter prompts are built from. */
export interface Facts {
  folder: string;
  readme?: string;
  test?: string;
  activeFile?: string;
  git: boolean;
}

/** Reads only what is there; `read` returns a file's text ("" for a folder) or undefined. */
export function detectFacts(folder: string, read: (rel: string) => string | undefined, activeFile?: string): Facts {
  const f: Facts = { folder, git: read(".git") !== undefined, activeFile };
  f.readme = ["README.md", "readme.md", "README", "README.rst"].find((n) => read(n) !== undefined);
  const pkg = read("package.json");
  if (pkg) {
    try {
      const t = JSON.parse(pkg)?.scripts?.test;
      if (typeof t === "string" && !/no test specified/.test(t)) f.test = "npm test";
    } catch {
      /* a broken package.json gives no test command */
    }
  }
  if (!f.test && read("Cargo.toml") !== undefined) f.test = "cargo test";
  if (!f.test && (read("pytest.ini") !== undefined || /pytest/.test(read("pyproject.toml") ?? ""))) f.test = "pytest";
  if (!f.test && read("go.mod") !== undefined) f.test = "go test ./...";
  return f;
}

/** Up to four prompts that make sense for this folder. */
export function starters(f: Facts): string[] {
  const s = [`Give me a tour of ${f.folder}: what it does and where the main code lives`];
  if (f.activeFile) s.push(`Review ${f.activeFile} for bugs and explain what you find`);
  if (f.test) s.push(`Run \`${f.test}\` and fix whatever fails`);
  if (f.git) s.push("Review my uncommitted changes before I commit");
  if (f.readme) s.push(`Check that ${f.readme} still matches the code`);
  return s.slice(0, 4);
}

/** One line from the agent: ready, an agent event, or the end of a turn. */
export type AgentLine =
  | { type: "ready"; session: string; model: string; mode: string; cwd: string; features?: string[] }
  | { type: "event"; event: { type: string; [k: string]: unknown } }
  | { type: "turn_end"; ok: boolean; plan: string | null; text: string; usage?: Usage }
  | ({ type: "usage" } & Usage)
  | { type: "compacted"; messages: number; before: number; after: number }
  | { type: "reverted"; turn: number; files: string[] }
  | { type: "error"; message: string };

/** Splits a stdout chunk stream into JSON lines; anything that is not JSON is passed on as text. */
export class LineReader {
  private buf = "";
  push(chunk: string, onLine: (l: AgentLine) => void, onText: (t: string) => void): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const raw = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!raw) continue;
      try {
        const v = JSON.parse(raw);
        if (v && typeof v === "object" && typeof v.type === "string") onLine(v as AgentLine);
        else onText(raw);
      } catch {
        onText(raw);
      }
    }
  }
}

/** `exe` is fahh-editor (needs the `agent` word) or fahh-agent. */
export const agentWord = (exe: string): string[] => (/fahh-agent(\.exe)?$/i.test(exe) ? [] : ["agent"]);

/** The command line for a session. */
export function agentArgs(exe: string, o: { cwd: string; provider: string; model?: string; mode: string; resume?: string }): string[] {
  const args = agentWord(exe);
  args.push("--json", "--cwd", o.cwd, "--provider", o.provider, "--permission-mode", o.mode);
  if (o.model) args.push("--model", o.model);
  if (o.resume) args.push("-r", o.resume);
  return args;
}

/** Where Fahh Editor installs itself, per platform; the first that exists wins. */
export function findAgent(setting: string, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform, exists: (p: string) => boolean = fs.existsSync): string | undefined {
  if (setting.trim()) return exists(setting.trim()) ? setting.trim() : undefined;
  const candidates: string[] = [];
  if (platform === "win32") {
    const local = env.LOCALAPPDATA ?? "";
    const pf = env.ProgramFiles ?? "C:\\Program Files";
    // fahh-agent.exe first: fahh-editor.exe is a windowed program and gives no output over pipes.
    for (const dir of [path.win32.join(local, "Fahh Editor"), path.win32.join(local, "Programs", "Fahh Editor"), path.win32.join(pf, "Fahh Editor")]) {
      candidates.push(path.win32.join(dir, "fahh-agent.exe"));
    }
  } else if (platform === "darwin") {
    candidates.push("/Applications/Fahh Editor.app/Contents/MacOS/fahh-editor");
  } else {
    const home = env.HOME ?? "";
    candidates.push(path.posix.join(home, ".local/bin/fahh"), "/usr/bin/fahh-editor", "/usr/local/bin/fahh");
  }
  for (const dir of (env.PATH ?? "").split(platform === "win32" ? ";" : ":")) {
    if (!dir) continue;
    for (const n of platform === "win32" ? ["fahh-agent.exe", "fahh-editor.exe"] : ["fahh-agent", "fahh"]) candidates.push(path.join(dir, n));
  }
  return candidates.find((c) => exists(c));
}
