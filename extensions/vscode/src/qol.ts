// The pure parts of the 0.4 features: @ mentions, prompt history, turn checkpoints, auto-approve
// rules, the transcript and its Markdown export, usage text. No VS Code imports: unit-tested.

// ─── @ mentions ────────────────────────────────────────────────────────────────

export type Mention =
  | { kind: "path"; path: string; folder: boolean }
  | { kind: "selection"; path: string; start: number; end: number }
  | { kind: "problems" };

/**
 * Mentions in a prompt: `@problems`, `@selection:src/a.ts#L3-9`, `@src/a.ts`, `@src/` (a folder)
 * and `@"a path with spaces.ts"`. An `@` must start the text or follow white space, so an e-mail
 * address is not a mention. Paths are checked against the workspace by the caller.
 */
export function parseMentions(text: string): Mention[] {
  const out: Mention[] = [];
  for (const m of text.matchAll(/(?:^|\s)@(?:"([^"\n]+)"|(\S+))/g)) {
    let v = m[1] ?? m[2].replace(/[.,;:!?)\]]+$/, "");
    if (!v) continue;
    if (v === "problems") {
      out.push({ kind: "problems" });
      continue;
    }
    const sel = /^selection:(.+)#L(\d+)-(\d+)$/.exec(v);
    if (sel) {
      out.push({ kind: "selection", path: sel[1], start: Number(sel[2]), end: Number(sel[3]) });
      continue;
    }
    if (v === "file" || v === "folder" || v === "selection") continue; // a picker word left unchosen
    v = v.replace(/\\/g, "/");
    out.push({ kind: "path", path: v.replace(/\/+$/, "") || "/", folder: v.endsWith("/") });
  }
  return out;
}

/** How a chosen path is written into the composer. */
export const mentionToken = (path: string, folder = false): string => {
  const p = path.replace(/\\/g, "/") + (folder && !path.endsWith("/") ? "/" : "");
  return /\s/.test(p) ? `@"${p}"` : `@${p}`;
};

export const selectionToken = (path: string, start: number, end: number): string => `@selection:${path.replace(/\\/g, "/")}#L${start}-${end}`;

export type ContextItem =
  | { kind: "file"; path: string }
  | { kind: "folder"; path: string }
  | { kind: "selection"; path: string; start: number; end: number; text: string; lang?: string }
  | { kind: "problems"; lines: string[] };

/** A fence that the text cannot close early. */
function fence(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

/** The prompt plus a clearly delimited context block. Files and folders are only named: the agent reads them itself. */
export function withContext(prompt: string, items: ContextItem[]): string {
  if (!items.length) return prompt;
  const parts: string[] = [];
  for (const it of items) {
    if (it.kind === "file") parts.push(`File: ${it.path} (read it if you need its contents)`);
    else if (it.kind === "folder") parts.push(`Folder: ${it.path}/`);
    else if (it.kind === "selection") {
      const f = fence(it.text);
      parts.push(`Selection: ${it.path} lines ${it.start}-${it.end}\n${f}${it.lang ?? ""}\n${it.text}\n${f}`);
    } else parts.push(it.lines.length ? `Problems (${it.lines.length}):\n${it.lines.join("\n")}` : "Problems: none reported by VS Code.");
  }
  return `${prompt}\n\n<vscode-context>\n${parts.join("\n\n")}\n</vscode-context>`;
}

/** Fuzzy match: every query character in order. Scores favour a hit in the file name, then fewer gaps, then shorter paths. */
export function fuzzy(query: string, paths: string[], limit = 20): string[] {
  const q = query.toLowerCase();
  if (!q) return paths.slice(0, limit);
  const scored: { p: string; s: number }[] = [];
  for (const p of paths) {
    const l = p.toLowerCase();
    const base = l.slice(l.lastIndexOf("/") + 1);
    let s: number;
    if (base.startsWith(q)) s = 0;
    else if (base.includes(q)) s = 1;
    else if (l.includes(q)) s = 2;
    else {
      let i = -1, gaps = 0;
      for (const ch of q) {
        const j = l.indexOf(ch, i + 1);
        if (j < 0) {
          i = -2;
          break;
        }
        if (i >= 0 && j > i + 1) gaps++;
        i = j;
      }
      if (i === -2) continue;
      s = 3 + gaps;
    }
    scored.push({ p, s: s * 1000 + p.length });
  }
  return scored.sort((a, b) => a.s - b.s).slice(0, limit).map((x) => x.p);
}

/** Every folder that holds one of the files, with a trailing slash. */
export function foldersOf(files: string[]): string[] {
  const set = new Set<string>();
  for (const f of files) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join("/") + "/");
  }
  return [...set].sort();
}

export interface MentionOption {
  label: string;
  desc: string;
  /** Text to insert, or an action the extension runs (a picker, the current selection). */
  insert?: string;
  action?: "file" | "folder" | "selection";
}

const SPECIAL: MentionOption[] = [
  { label: "@file", desc: "Pick a workspace file", action: "file" },
  { label: "@folder", desc: "Pick a folder", action: "folder" },
  { label: "@selection", desc: "The selection in the editor, with its path and lines", action: "selection" },
  { label: "@problems", desc: "Errors and warnings VS Code reports now", insert: "@problems" },
];

/** The popup for `@query`: the four kinds whose name starts with it, then fuzzy file matches. */
export function mentionOptions(query: string, files: string[], limit = 12): MentionOption[] {
  const q = query.toLowerCase();
  const special = SPECIAL.filter((o) => o.label.slice(1).startsWith(q));
  const hits = q ? fuzzy(q, files, limit) : [];
  return [...special, ...hits.map((p): MentionOption => ({ label: p, desc: "file", insert: mentionToken(p) }))].slice(0, limit);
}

// ─── prompt history ─────────────────────────────────────────────────────────────

/** Newest last, no duplicates (an old copy moves to the end), at most `max`. */
export function pushHistory(list: string[], text: string, max = 50): string[] {
  const t = text.trim();
  if (!t) return list;
  return [...list.filter((x) => x !== t), t].slice(-max);
}

// ─── checkpoints ────────────────────────────────────────────────────────────────

/** The original content of every file a turn changed, recorded at its first change. `null`: it did not exist. */
export class Checkpoints {
  private turns = new Map<number, Map<string, string | null>>();
  /** Paths the turn changed, whether or not their original content is known. */
  private changed = new Map<number, Set<string>>();

  record(turn: number, path: string, original: string | null): void {
    const t = this.turns.get(turn) ?? new Map<string, string | null>();
    this.turns.set(turn, t);
    if (!t.has(path)) t.set(path, original);
  }

  has(turn: number, path: string): boolean {
    return !!this.turns.get(turn)?.has(path);
  }

  changedFile(turn: number, path: string): void {
    const s = this.changed.get(turn) ?? new Set<string>();
    this.changed.set(turn, s);
    s.add(path);
  }

  /** Files the turn changed: those it can restore, and those it saw change without a snapshot. */
  files(turn: number): { restorable: string[]; unknown: string[] } {
    const snap = this.turns.get(turn) ?? new Map();
    const all = new Set([...(this.changed.get(turn) ?? []), ...snap.keys()]);
    const restorable = [...all].filter((p) => snap.has(p));
    return { restorable, unknown: [...all].filter((p) => !snap.has(p)) };
  }

  /** Restores through `write` (null content: delete) and forgets the turn. Returns the restored paths. */
  restore(turn: number, write: (path: string, content: string | null) => void): string[] {
    const snap = this.turns.get(turn) ?? new Map<string, string | null>();
    const done: string[] = [];
    for (const [p, c] of snap) {
      write(p, c);
      done.push(p);
    }
    this.forget(turn);
    return done;
  }

  forget(turn: number): void {
    this.turns.delete(turn);
    this.changed.delete(turn);
  }

  clear(): void {
    this.turns.clear();
    this.changed.clear();
  }
}

/** The file after an approved edit_file / write_file, from the tool's arguments. undefined: cannot tell. */
export function proposedContent(tool: string, args: Record<string, unknown> | undefined, before: string | null): string | undefined {
  if (!args) return undefined;
  if (tool === "write_file") return typeof args.content === "string" ? args.content : undefined;
  if (tool !== "edit_file" || before === null || typeof args.old_str !== "string" || typeof args.new_str !== "string") return undefined;
  if (!args.old_str || !before.includes(args.old_str)) return undefined;
  return args.replace_all === true ? before.split(args.old_str).join(args.new_str) : before.replace(args.old_str, () => args.new_str as string);
}

// ─── auto-approve rules ────────────────────────────────────────────────────────────

export type Rule = "ask" | "always";
export interface Rules {
  edits: Rule;
  commands: Rule;
}

const RANK: Record<string, number> = { qa: 0, plan: 1, normal: 2, "accept-edits": 3, smart: 4, bypass: 5 };

/**
 * The fahh-agent permission mode the rules ask for. Reads are always allowed by the agent.
 * Commands "always" means bypass: a command can write any file, so asking for edits while
 * running commands freely would be false safety. The agent's built-in blocks and deny rules
 * in .fahh/permissions.json still apply in every mode.
 */
export function rulesMode(r: Rules): string {
  if (r.commands === "always") return "bypass";
  if (r.edits === "always") return "accept-edits";
  return "normal";
}

/** The rules only ever raise a mode; read-only modes (plan, ask) are kept as chosen. */
export function effectiveMode(mode: string, r: Rules): string {
  if (mode === "plan" || mode === "qa") return mode;
  const rm = rulesMode(r);
  return (RANK[rm] ?? 0) > (RANK[mode] ?? 0) ? rm : mode;
}

// ─── transcript and export ──────────────────────────────────────────────────────────

export type Entry =
  | { kind: "user"; text: string; mode?: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; args?: unknown; ok?: boolean; output?: string; who?: string }
  | { kind: "approval"; summary: string; answer?: string; who?: string }
  | { kind: "note"; text: string };

type Ev = { type: string; [k: string]: unknown };

/** Adds one agent event to the transcript (in place). Subagent prose is left out, as in the view. */
export function addEvent(t: Entry[], ev: Ev, who?: string): void {
  const last = t[t.length - 1];
  switch (ev.type) {
    case "text_delta":
      if (who) return;
      if (last?.kind === "assistant") last.text += String(ev.text ?? "");
      else t.push({ kind: "assistant", text: String(ev.text ?? "") });
      return;
    case "tool_call":
      t.push({ kind: "tool", id: String(ev.id), name: String(ev.name), args: ev.args, who });
      return;
    case "tool_result": {
      const call = [...t].reverse().find((e): e is Extract<Entry, { kind: "tool" }> => e.kind === "tool" && e.id === String(ev.id));
      if (call) {
        call.ok = !!ev.ok;
        call.output = String(ev.output ?? "");
      }
      return;
    }
    case "approval_request":
      t.push({ kind: "approval", summary: String(ev.summary ?? ev.tool), who });
      return;
    case "file_changed":
      t.push({ kind: "note", text: `Changed ${ev.path}` });
      return;
    case "plan_written":
      t.push({ kind: "note", text: `Plan written to ${ev.path}` });
      return;
    case "compacted":
      t.push({ kind: "note", text: `Context compacted: ~${ev.before} to ~${ev.after} tokens` });
      return;
    case "error":
      t.push({ kind: "note", text: `Error: ${ev.message}` });
      return;
    case "sub":
      return addEvent(t, ev.event as Ev, String(ev.name));
  }
}

/** The last approval without an answer gets this one. */
export function answerApproval(t: Entry[], answer: string): void {
  const a = [...t].reverse().find((e): e is Extract<Entry, { kind: "approval" }> => e.kind === "approval" && !e.answer);
  if (a) a.answer = answer;
}

const quote = (s: string) => s.split("\n").map((l) => `> ${l}`).join("\n");

export function exportMarkdown(t: Entry[], meta: { title: string; model: string; folder: string; date: string }): string {
  const out = [`# ${meta.title}`, "", `${meta.folder} · ${meta.model} · ${meta.date}`, ""];
  for (const e of t) {
    if (e.kind === "user") out.push(`## You${e.mode && e.mode !== "normal" ? ` (${e.mode === "qa" ? "ask" : e.mode})` : ""}`, "", e.text, "");
    else if (e.kind === "assistant") out.push("## Fahh Familiar", "", e.text.trim(), "");
    else if (e.kind === "tool") {
      const args = e.args && typeof e.args === "object" && Object.keys(e.args).length ? JSON.stringify(e.args, null, 2) : "";
      out.push(`<details><summary>Tool: ${e.who ? `[${e.who}] ` : ""}${e.name}${e.ok === undefined ? "" : e.ok ? " (ok)" : " (failed)"}</summary>`, "");
      if (args) out.push(`${fence(args)}json`, args, fence(args), "");
      if (e.output !== undefined) out.push(`${fence(e.output)}text`, e.output || "(no output)", fence(e.output), "");
      out.push("</details>", "");
    } else if (e.kind === "approval") out.push(quote(`**Approval:** ${e.who ? `[${e.who}] ` : ""}${e.summary}: ${e.answer ?? "not answered"}`), "");
    else out.push(`_${e.text}_`, "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ─── usage ─────────────────────────────────────────────────────────────────────────

export interface Usage {
  model_calls: number;
  tool_calls: number;
  tokens_in: number;
  tokens_out: number;
  context?: { used: number; window: number; percent: number };
}

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

/** Short, for the status bar: "~12.3k tokens · 40% context". The agent's numbers are estimates. */
export function usageText(u: Usage): string {
  return `~${k(u.tokens_in + u.tokens_out)} tokens` + (u.context ? ` · ${u.context.percent}% context` : "");
}

export function usageDetail(u: Usage): string {
  const ctx = u.context ? `\nContext: ~${k(u.context.used)} of ~${k(u.context.window)} tokens (${u.context.percent}%)` : "";
  return `Model calls: ${u.model_calls} · tool calls: ${u.tool_calls}\nTokens in: ~${k(u.tokens_in)} · out: ~${k(u.tokens_out)} (estimated)${ctx}`;
}
