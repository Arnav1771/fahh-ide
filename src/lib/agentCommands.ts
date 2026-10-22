/**
 * What each slash command does in the panel. Kept apart from React and from the
 * store (both are injected through `CommandApi`) so it runs under vitest.
 * The fahh-agent CLI implements the same commands in src-tauri/src/agent/cli.rs.
 */
import type { AgentSettings } from "./agent";
import { lastReply, type AgentAction, type AgentState } from "./agentState";
import { MODE_LABEL, parseMode, SLASH_COMMANDS, type ParsedSlash } from "./slash";
import type {
  AgentContextInfo,
  AgentLoaded,
  AgentMode,
  AgentProviderConfig,
  AgentRevertResult,
  AgentRunSpec,
  AgentSessionInfo,
  AgentTurnRec,
  AgentUsage,
  AgentsReport,
} from "./types";

export interface Ipc {
  sessions(workspace: string): Promise<AgentSessionInfo[]>;
  load(workspace: string, id?: string | null, extraDirs?: string[]): Promise<AgentLoaded>;
  fork(session: string, step?: number | null): Promise<AgentLoaded>;
  revert(session: string, step: number): Promise<AgentRevertResult>;
  rename(session: string, title: string): Promise<void>;
  remove(workspace: string, id: string): Promise<void>;
  steps(session: string): Promise<AgentTurnRec[]>;
  compact(session: string, provider: AgentProviderConfig): Promise<{ folded: number; before: number; after: number }>;
  context(session: string, model: string): Promise<AgentContextInfo>;
  usage(session: string): Promise<AgentUsage>;
  exportSession(session: string, path?: string | null): Promise<string>;
  agents(workspace: string): Promise<AgentsReport>;
}

export interface SendOpts {
  mode?: AgentMode;
  run?: AgentRunSpec;
  /** Use this model for the turn (the fast model). */
  model?: string;
}

export interface CommandApi {
  ipc: Ipc;
  settings(): AgentSettings;
  state(): AgentState;
  root(): string | null;
  update(patch: Partial<AgentSettings>): void;
  dispatch(a: AgentAction): void;
  send(prompt: string, opts?: SendOpts): Promise<void>;
  provider(): AgentProviderConfig;
  newChat(): void;
  /** Revert the files the latest turn that changed any. */
  undo(): Promise<void>;
  reloadTabs(paths: string[]): Promise<void>;
  copy(text: string): Promise<void>;
  exit(): void;
  usingFast(): boolean;
  setUsingFast(on: boolean): void;
}

export function helpText(): string {
  let group = "";
  const lines: string[] = [];
  for (const d of SLASH_COMMANDS) {
    if (d.group !== group) {
      group = d.group;
      lines.push(`\n${group}`);
    }
    lines.push(`  /${d.name}${d.args ? " " + d.args : ""}  ${d.desc}`);
  }
  return lines.join("\n").trim();
}

const SHORTCUTS = "Enter sends. Shift+Enter makes a new line. / opens the command menu; Up and Down move, Enter or Tab picks, Esc closes.";

const WARN_BYPASS = "Bypass mode auto-approves every prompt. Deny rules in .fahh/permissions.json and the built-in blocks still apply.";

export async function runSlash(api: CommandApi, cmd: ParsedSlash): Promise<void> {
  const note = (text: string, level: "error" | "info" = "info") => api.dispatch({ type: "notice", level, text });
  const { arg } = cmd;
  const s = api.settings();
  const root = api.root();
  const needSession = (): string | null => {
    const id = api.state().session;
    if (!id) note("There is no session yet: send a message first (or /resume one).", "error");
    return id;
  };
  const needRoot = (): string | null => {
    if (!root) note("Open a folder first: the agent works inside a workspace.", "error");
    return root;
  };
  const switchMode = (m: AgentMode) => {
    api.update({ mode: m });
    note(`Mode: ${MODE_LABEL[m]}${m === "bypass" ? `. ${WARN_BYPASS}` : ""}`);
  };
  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      note(String(e), "error");
    }
  };

  switch (cmd.name) {
    case "help":
      return note(helpText());
    case "shortcuts":
      return note(SHORTCUTS);
    case "exit":
      return api.exit();
    case "config":
      return note(
        [
          `Provider: ${s.provider}`,
          `Model: ${s.model || "(none)"}${api.usingFast() ? " (fast)" : ""}`,
          `Fast model: ${s.fastModel || "(none: set it in settings)"}`,
          `Mode: ${MODE_LABEL[s.mode]}`,
          `Workspace: ${root ?? "(no folder open)"}`,
          `Extra folders: ${s.extraDirs.length ? s.extraDirs.join(", ") : "(none)"}`,
        ].join("\n")
      );
    case "model":
      if (!arg) return note(`Model: ${s.model || "(none)"}${api.usingFast() ? " (fast is on)" : ""}`);
      api.update({ model: arg });
      api.setUsingFast(false);
      return note(`Model: ${arg}`);
    case "mode": {
      if (!arg) return note(`Mode: ${MODE_LABEL[s.mode]}`);
      const m = parseMode(arg);
      if (!m || m === "qa") return note(`Unknown mode "${arg}". Use normal, accept-edits, smart, plan or bypass.`, "error");
      return switchMode(m);
    }
    case "normal":
      return switchMode("ask");
    case "accept-edits":
      switchMode("auto-edit");
      if (arg) await api.send(arg, { mode: "auto-edit" });
      return;
    case "undo":
      return guard(() => api.undo());
    case "code":
    case "smart":
    case "plan":
    case "bypass": {
      const m = parseMode(cmd.name)!;
      switchMode(m);
      if (arg) await api.send(arg, { mode: m });
      return;
    }
    case "ask":
      if (!arg) return note("Usage: /ask <question>", "error");
      return api.send(arg, { mode: "qa" });
    case "fast": {
      if (!s.fastModel) return note("No fast model is set. Add one under settings (Fast model).", "error");
      if (arg) return api.send(arg, { model: s.fastModel });
      api.setUsingFast(!api.usingFast());
      return note(api.usingFast() ? `Using the fast model: ${s.fastModel}` : `Back to the main model: ${s.model}`);
    }
    case "loop":
      if (!arg) return note("Usage: /loop <prompt>", "error");
      return api.send(arg, { run: { kind: "loop" } });
    case "btw":
      if (!arg) return note("Usage: /btw <prompt>", "error");
      return api.send(arg, { run: { kind: "btw" } });
    case "agent": {
      const [name, ...rest] = arg.split(/\s+/);
      const task = rest.join(" ").trim();
      if (!name || !task) return note("Usage: /agent <name> <task>   (/agents lists them)", "error");
      return api.send(task, { run: { kind: "agent", name } });
    }
    case "clear":
      return api.newChat();
    case "workspace":
      return note(`${root ?? "(no folder open)"}${s.extraDirs.map((d) => `\n+ ${d}`).join("")}`);
    case "add-dir":
      if (!arg) return note("Usage: /add-dir <path>", "error");
      if (s.extraDirs.includes(arg)) return note("That folder is already included.");
      api.update({ extraDirs: [...s.extraDirs, arg] });
      return note(`Added ${arg}. The agent may now read and edit there too (permission rules still apply).`);
    case "remove-dir":
      if (!arg) return note("Usage: /remove-dir <path>", "error");
      if (!s.extraDirs.includes(arg)) return note("That folder was not added.");
      api.update({ extraDirs: s.extraDirs.filter((d) => d !== arg) });
      return note(`Removed ${arg}.`);
    case "copy": {
      const text = lastReply(api.state().items);
      if (!text) return note("There is no reply to copy yet.", "error");
      await api.copy(text);
      return note("Copied the last reply.");
    }
    case "compact":
      return guard(async () => {
        const id = needSession();
        if (!id) return;
        const r = await api.ipc.compact(id, api.provider());
        note(`Compacted ${r.folded} messages: about ${r.before} to ${r.after} tokens.`);
      });
    case "context":
      return guard(async () => {
        const id = needSession();
        if (!id) return;
        const c = await api.ipc.context(id, api.provider().model);
        note(`Context: about ${c.used} of ${c.window} tokens (${c.percent}%), ${c.messages} messages. Estimated; the window size is a guess from the model name.`);
      });
    case "usage":
      return guard(async () => {
        const id = needSession();
        if (!id) return;
        const u = await api.ipc.usage(id);
        note(`Model calls: ${u.model_calls}\nTool calls: ${u.tool_calls}\nTokens in: about ${u.tokens_in}\nTokens out: about ${u.tokens_out} (estimated)`);
      });
    case "ls":
    case "resume":
    case "continue":
      return guard(async () => {
        const r = needRoot();
        if (!r) return;
        if (cmd.name === "resume" && !arg || cmd.name === "ls") {
          const list = await api.ipc.sessions(r);
          if (!list.length) return note("No saved sessions for this workspace yet.");
          return api.dispatch({ type: "sessions", sessions: list });
        }
        const loaded = await api.ipc.load(r, arg || null, s.extraDirs);
        api.dispatch({ type: "loaded", loaded });
        note(`Resumed "${loaded.title}" (${loaded.turns.length} step${loaded.turns.length === 1 ? "" : "s"}).`);
      });
    case "title":
      return guard(async () => {
        const id = needSession();
        if (!id) return;
        if (!arg) return note("Usage: /title <title>", "error");
        await api.ipc.rename(id, arg);
        api.dispatch({ type: "renamed", title: arg });
        note("Renamed.");
      });
    case "rm-session":
      return guard(async () => {
        const r = needRoot();
        if (!r) return;
        if (!arg) return note("Usage: /rm-session <id>", "error");
        await api.ipc.remove(r, arg);
        note(`Removed ${arg}.`);
      });
    case "steps":
      return guard(async () => {
        const id = needSession();
        if (!id) return;
        const t = await api.ipc.steps(id);
        note(t.length ? t.map((x) => `${x.id}. [${MODE_LABEL[x.mode]}] ${x.prompt.split("\n")[0].slice(0, 90)}`).join("\n") : "No steps yet.");
      });
    case "fork":
      return guard(async () => {
        const id = needSession();
        if (!id) return;
        const step = arg ? Number(arg) : null;
        if (arg && !Number.isInteger(step)) return note("Usage: /fork [step]", "error");
        const loaded = await api.ipc.fork(id, step);
        api.dispatch({ type: "loaded", loaded });
        note(`Forked into "${loaded.title}".`);
      });
    case "revert":
      return guard(async () => {
        const id = needSession();
        if (!id) return;
        const step = Number(arg);
        if (!arg || !Number.isInteger(step)) return note("Usage: /revert <step>   (/steps lists them)", "error");
        const r = await api.ipc.revert(id, step);
        api.dispatch({ type: "loaded", loaded: r.loaded });
        await api.reloadTabs(r.files);
        note(`Reverted ${r.files.length} file${r.files.length === 1 ? "" : "s"}${r.files.length ? `: ${r.files.join(", ")}` : ""}${r.rewound ? "; the conversation is rewound." : "; the conversation could not be rewound (that step was folded by /compact)."}`);
      });
    case "export":
      return guard(async () => {
        const id = needSession();
        if (!id) return;
        const out = await api.ipc.exportSession(id, arg || `.fahh/exports/${id}.md`);
        note(out);
      });
    case "agents":
      return guard(async () => {
        const r = needRoot();
        if (!r) return;
        const rep = await api.ipc.agents(r);
        const lines = rep.agents.map((a) => `${a.name} [${a.source}] ${a.description} (${MODE_LABEL[a.mode]}, max ${a.max_steps} steps${a.model ? `, model ${a.model}` : ""})`);
        for (const p of rep.problems) lines.push(`skipped: ${p}`);
        note(lines.join("\n"));
      });
    default:
      return note(`/${cmd.name} is not available here.`, "error");
  }
}
