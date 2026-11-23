// The `fahh agent --json` protocol and how to find the program. No VS Code imports here, so
// it is unit-tested with plain node.
import * as fs from "fs";
import * as path from "path";

export const KEY_ENV: Record<string, string> = {
  groq: "GROQ_API_KEY",
  gemini: "GEMINI_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  ollama: "",
};

/** One line from the agent: ready, an agent event, or the end of a turn. */
export type AgentLine =
  | { type: "ready"; session: string; model: string; mode: string; cwd: string }
  | { type: "event"; event: { type: string; [k: string]: unknown } }
  | { type: "turn_end"; ok: boolean; plan: string | null; text: string }
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

/** The command line for a session. `exe` is fahh-editor (needs the `agent` word) or fahh-agent. */
export function agentArgs(exe: string, o: { cwd: string; provider: string; model?: string; mode: string; resume?: string }): string[] {
  const viaEditor = !/fahh-agent(\.exe)?$/i.test(exe);
  const args = viaEditor ? ["agent"] : [];
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
