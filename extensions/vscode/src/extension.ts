// Fahh Familiar in VS Code: a chat view that drives `fahh agent --json` in the open folder.
// (Fahh Local is the agent panel inside Fahh Editor; this extension is Fahh Familiar. The IDs
// stay fahh-local-chat / fahhLocalChat.* so keys and settings carry over.)
// JSON mode has no slash commands, so they live here: most of them change a setting, and a
// setting change restarts the agent with new flags, resuming the same session.
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ChildProcessWithoutNullStreams, execFile, spawn } from "child_process";
import { AgentLine, LineReader, MODES, PROVIDERS, agentArgs, agentEnv, agentWord, detectFacts, findAgent, keyState, parseModels, parseSessions, parseSlash, providerLabel, slashFor, starters } from "./protocol";
import { Checkpoints, ContextItem, Entry, Rules, Usage, addEvent, answerApproval, effectiveMode, exportMarkdown, foldersOf, mentionOptions, parseMentions, proposedContent, pushHistory, selectionToken, mentionToken, usageDetail, usageText, withContext } from "./qol";
import { registerSelfUpdate } from "./selfUpdate";

const NAME = "Fahh Familiar";
const DOWNLOAD = "https://fahhide.duckdns.org/#download";
const secretName = (provider: string) => `fahhLocalChat.key.${provider}`;
const SECTION = "fahhLocalChat";
const HISTORY_KEY = "fahhLocalChat.history";
/** The proposed side of an edit's diff. */
const SCHEME = "fahh-proposed";
const NEXT_FAHH = "it ships with the next Fahh Editor release; update Fahh Editor to use it";

const setting = <T>(key: string, def: T): T => vscode.workspace.getConfiguration(SECTION).get<T>(key, def);
type Item<T> = vscode.QuickPickItem & { value?: T };
type Ev = { type: string; [k: string]: unknown };

/** Runs a short fahh-agent subcommand (models list, sessions ls). */
function run(exe: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(exe, [...agentWord(exe), ...args], { env, cwd, timeout: 20000, windowsHide: true, maxBuffer: 4 << 20 }, (e, out, err) =>
      resolve({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, out: String(out), err: String(err || (e ? e.message : "")) })
    );
  });
}

const lastLine = (s: string) => s.trim().split(/\r?\n/).pop()?.replace(/^fahh-agent:\s*/, "") ?? "";

/** The contents of the proposed side of open diffs. */
class Proposed implements vscode.TextDocumentContentProvider {
  readonly docs = new Map<string, string>();
  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.docs.get(uri.toString()) ?? "";
  }
}

/** An approval the agent is waiting on. Only one at a time: the agent blocks until it is answered. */
interface Pending {
  ev: Ev;
  turn: number;
  /** For an edit: the file before it, read when the request came (null: a new file; undefined: unreadable). */
  before?: string | null;
}

class ChatView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private webReady = false;
  private queue: unknown[] = [];
  private proc?: ChildProcessWithoutNullStreams;
  private session?: string;
  private busy = false;
  private restartAfterTurn = false;
  private lastReply = "";
  private features?: string[];
  private readyWait?: Promise<void>;
  private readyDone?: () => void;
  private transcript: Entry[] = [];
  private checkpoints = new Checkpoints();
  private turn = 0;
  private pending?: Pending;
  /** The last edit_file / write_file arguments per path: the approval event only has a snippet. */
  private toolArgs = new Map<string, { name: string; args: Record<string, unknown> }>();
  private usage?: Usage;
  private showUsage = false;
  /** Told to the agent with the next prompt: files the user restored behind its back. */
  private undoNote = "";
  private files?: { at: number; list: string[] };
  private lastEditor?: vscode.TextEditor;
  private diffCount = 0;
  readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  readonly proposed = new Proposed();

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.session = ctx.workspaceState.get<string>("fahhLocalChat.session");
    this.lastEditor = vscode.window.activeTextEditor;
    this.status.command = "fahhLocalChat.statusMenu";
    this.status.show();
    ctx.subscriptions.push(
      this.status,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration(SECTION)) return;
        // provider, model, mode and binary are process flags: restart (the session resumes)
        if (this.busy) this.restartAfterTurn = true;
        else this.kill();
        void this.pushState();
      }),
      vscode.window.onDidChangeActiveTextEditor((ed) => {
        if (ed) this.lastEditor = ed;
        void this.pushState();
      }),
      ctx.secrets.onDidChange(() => void this.pushState())
    );
    void this.pushState();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.webReady = false;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "media")] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((m) => this.onMessage(m));
    view.onDidDispose(() => {
      this.view = undefined;
      this.webReady = false;
      this.kill();
    });
  }

  /** Messages wait until the webview has loaded (Ctrl+L can open the view and insert at once). */
  private post(m: unknown): void {
    if (this.view && this.webReady) void this.view.webview.postMessage(m);
    else if (this.queue.push(m) > 200) this.queue.shift();
  }

  private notice(text: string): void {
    this.post({ type: "notice", text });
  }

  private cfg() {
    return { provider: setting("provider", "groq"), model: setting("model", ""), mode: setting("mode", "normal"), binary: setting("binary", "") };
  }

  private rules(): Rules {
    const r = (k: string) => (setting<string>(`autoApprove.${k}`, "ask") === "always" ? "always" : "ask");
    return { edits: r("edits"), commands: r("commands") };
  }

  /** Writes where the current value comes from, so a workspace setting is not silently shadowing it. */
  private async setCfg(key: string, value: string): Promise<void> {
    const c = vscode.workspace.getConfiguration(SECTION);
    const target = c.inspect(key)?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await c.update(key, value, target);
  }

  private folder() {
    return vscode.workspace.workspaceFolders?.[0];
  }

  /** A path the agent reported (workspace-relative, or absolute for an added folder). */
  private uriOf(p: string): vscode.Uri | undefined {
    if (path.isAbsolute(p)) return vscode.Uri.file(p);
    const f = this.folder();
    return f ? vscode.Uri.joinPath(f.uri, p) : undefined;
  }

  private async keyOf(provider: string) {
    return keyState(provider, !!(await this.ctx.secrets.get(secretName(provider))), process.env);
  }

  private async env(provider: string): Promise<NodeJS.ProcessEnv> {
    return agentEnv(provider, await this.ctx.secrets.get(secretName(provider)), process.env);
  }

  private history(): string[] {
    return this.ctx.workspaceState.get<string[]>(HISTORY_KEY, []);
  }

  private paintStatus(): void {
    const c = this.cfg();
    const mode = effectiveMode(c.mode, this.rules());
    const label = MODES.find((m) => m.id === mode)?.label ?? mode;
    const model = c.model || process.env.FAHH_AGENT_MODEL || "no model";
    this.status.text = `$(hubot) ${model} · ${label}` + (this.usage ? ` · ${usageText(this.usage)}` : "");
    const md = new vscode.MarkdownString(`**${NAME}**\n\n${providerLabel(c.provider)} / ${model}\n\nMode: ${label}${mode !== c.mode ? " (raised by your auto-approve rules)" : ""}`);
    if (this.usage) md.appendMarkdown("\n\n" + usageDetail(this.usage).replace(/\n/g, "\n\n"));
    md.appendMarkdown("\n\nClick to change model, provider or mode.");
    this.status.tooltip = md;
  }

  /** Everything the webview shows outside the transcript. Only real values: nothing is made up. */
  private async pushState(): Promise<void> {
    this.paintStatus();
    if (!this.view) return;
    const c = this.cfg();
    const f = this.folder();
    let starts: string[] = [];
    if (f) {
      const root = f.uri.fsPath;
      const read = (rel: string) => {
        try {
          const p = path.join(root, rel);
          return fs.statSync(p).isDirectory() ? "" : fs.readFileSync(p, "utf8").slice(0, 20000);
        } catch {
          return undefined;
        }
      };
      const doc = vscode.window.activeTextEditor?.document.uri;
      const active = doc && vscode.workspace.getWorkspaceFolder(doc) === f ? vscode.workspace.asRelativePath(doc, false) : undefined;
      starts = starters(detectFacts(f.name, read, active));
    }
    this.post({
      type: "state",
      provider: c.provider,
      providerLabel: providerLabel(c.provider),
      model: c.model || process.env.FAHH_AGENT_MODEL || "",
      mode: c.mode,
      effectiveMode: effectiveMode(c.mode, this.rules()),
      key: await this.keyOf(c.provider),
      folder: f?.name ?? null,
      agentFound: !!findAgent(c.binary),
      session: this.session ?? null,
      busy: this.busy,
      starters: starts,
      slash: slashFor(this.features),
      modes: MODES,
      history: this.history(),
    });
  }

  private async onMessage(m: { type: string; text?: string; mode?: string; allow?: boolean; always?: boolean; command?: string; q?: string; action?: string; turn?: number }): Promise<void> {
    switch (m.type) {
      case "ready": {
        this.webReady = true;
        const q = this.queue;
        this.queue = [];
        await this.pushState();
        for (const x of q) this.post(x);
        return;
      }
      case "prompt":
        return this.input(m.text ?? "", m.mode ?? this.cfg().mode);
      case "approve":
        return this.answer(!!m.allow, !!m.always, m.command);
      case "openDiff":
        return void this.openDiff();
      case "undo":
        if (typeof m.turn === "number") return this.undo(m.turn);
        return;
      case "mention":
        return this.mention(m.q ?? "");
      case "mentionAction":
        return this.mentionAction(m.action ?? "");
      case "stop":
        return this.stop();
      case "setMode":
        if (m.mode && MODES.some((x) => x.id === m.mode)) await this.setCfg("mode", m.mode);
        return;
      case "pickModel":
        return void this.pickModel();
      case "pickProvider":
        return void this.pickProvider();
      case "setKey":
        return void this.askKey(this.cfg().provider);
      case "openFolder":
        return void vscode.commands.executeCommand("workbench.action.files.openFolder");
      case "download":
        return void vscode.env.openExternal(vscode.Uri.parse(DOWNLOAD));
      case "settings":
        return this.settings();
      case "copy":
        if (m.text) await vscode.env.clipboard.writeText(m.text);
        return;
      case "openFile": {
        const uri = m.text ? this.uriOf(m.text) : undefined;
        if (uri) void vscode.window.showTextDocument(uri, { preview: true });
        return;
      }
    }
  }

  /** What the composer sent: a slash command or a prompt. */
  private async input(text: string, mode: string): Promise<void> {
    if (text.trim()) {
      await this.ctx.workspaceState.update(HISTORY_KEY, pushHistory(this.history(), text));
      void this.pushState();
    }
    const sl = parseSlash(text);
    if (!sl) return this.prompt(text, mode);
    if ("error" in sl) return this.post({ type: "error", message: sl.error });
    return this.slash(sl.name, sl.arg);
  }

  async slash(name: string, arg: string): Promise<void> {
    switch (name) {
      case "new":
        return this.newSession();
      case "clear":
        return this.post({ type: "cleared", keep: true });
      case "model":
        if (arg) return this.setCfg("model", arg).then(() => this.notice(`Model: ${arg}`));
        return void this.pickModel();
      case "provider": {
        if (!arg) return void this.pickProvider();
        const p = PROVIDERS.find((x) => x.id === arg.toLowerCase() || x.label.toLowerCase().startsWith(arg.toLowerCase()));
        if (!p) return this.post({ type: "error", message: `Unknown provider "${arg}". One of: ${PROVIDERS.map((x) => x.id).join(", ")}.` });
        return void this.switchProvider(p.id);
      }
      case "mode": {
        if (!arg) return this.post({ type: "openMode" });
        const md = MODES.find((x) => x.id === arg.toLowerCase() || x.label.toLowerCase() === arg.toLowerCase());
        if (!md) return this.post({ type: "error", message: `Unknown mode "${arg}". One of: ${MODES.map((x) => x.id).join(", ")}.` });
        return this.setCfg("mode", md.id);
      }
      case "resume":
        return arg ? this.resume(arg) : this.pickSession();
      case "ask":
        if (!arg) return this.notice("Usage: /ask <question>. It answers without changing anything.");
        return this.prompt(arg, "qa", `/ask ${arg}`);
      case "plan":
        await this.setCfg("mode", "plan");
        if (arg) return this.prompt(arg, "plan");
        return this.notice("Plan mode: it researches read-only and writes a plan for you to approve.");
      case "copy":
        if (!this.lastReply) return this.notice("No reply to copy yet.");
        await vscode.env.clipboard.writeText(this.lastReply);
        return this.notice("Copied the last reply.");
      case "export":
        return this.exportChat();
      case "compact":
        return void (await this.agentCommand("compact"));
      case "usage":
        this.showUsage = true;
        return void (await this.agentCommand("usage"));
      case "permissions":
        return this.permissions();
      case "keys":
        return this.keys();
      case "settings":
        return this.settings();
      case "help":
        return this.post({ type: "help" });
    }
  }

  private write(v: unknown): void {
    this.proc?.stdin.write(JSON.stringify(v) + "\n");
  }

  // ─── agent commands (compact, usage, revert) ─────────────────────────────────

  /** Starts the agent if needed and waits for its ready line, so its features are known. */
  private async started(): Promise<boolean> {
    if (!(await this.ensure())) return false;
    await this.readyWait;
    return !!this.proc;
  }

  private async agentCommand(command: string, extra: Record<string, unknown> = {}): Promise<boolean> {
    if (this.busy) {
      this.notice(`/${command} runs between turns: wait for this one to finish, or stop it.`);
      return false;
    }
    if (!(await this.started())) return false;
    if (!this.features?.includes(command)) {
      this.post({ type: "error", message: `This fahh-agent does not support ${command === "revert" ? "undo" : "/" + command} yet: ${NEXT_FAHH}.` });
      return false;
    }
    this.write({ command, ...extra });
    return true;
  }

  // ─── approvals, diffs, checkpoints ─────────────────────────────────────────────

  private readFile(p: string): string | null | undefined {
    const uri = this.uriOf(p);
    if (!uri) return undefined;
    if (!fs.existsSync(uri.fsPath)) return null;
    try {
      return fs.readFileSync(uri.fsPath, "utf8");
    } catch {
      return undefined;
    }
  }

  private onEvent(ev: Ev, who?: string): void {
    if (ev.type === "sub") return this.onEvent(ev.event as Ev, String(ev.name));
    if (typeof ev.turn === "number") this.turn = ev.turn;
    const p = typeof ev.path === "string" ? ev.path : undefined;
    if (ev.type === "tool_call" && (ev.name === "edit_file" || ev.name === "write_file")) {
      const args = (ev.args ?? {}) as Record<string, unknown>;
      if (typeof args.path === "string") this.toolArgs.set(args.path.replace(/\\/g, "/"), { name: String(ev.name), args });
    }
    if (ev.type === "approval_request") {
      // the agent waits for the answer, so the file is still as it was: snapshot it now
      this.pending = { ev, turn: this.turn, before: ev.kind === "edit" && p ? this.readFile(p) : undefined };
    }
    if (ev.type === "file_changed" && p) this.checkpoints.changedFile(this.turn, p);
  }

  /** The answer to the pending approval, from its card or from the diff editor. */
  answer(allow: boolean, always: boolean, command?: string, fromDiff = false): void {
    const pd = this.pending;
    if (!pd && fromDiff) return; // nothing is waiting: a stray click must not reach the agent as a prompt
    this.pending = undefined;
    const p = pd && typeof pd.ev.path === "string" ? pd.ev.path : undefined;
    if (allow && pd && p && pd.ev.kind === "edit" && pd.before !== undefined) this.checkpoints.record(pd.turn, p, pd.before);
    answerApproval(this.transcript, allow ? (always ? "allowed, and remembered" : command ? `allowed as: ${command}` : "allowed") : "denied");
    this.write({ allow, always, ...(command ? { command } : {}) });
    if (fromDiff) this.post({ type: "approvalAnswered", allow });
    void this.closeDiffs();
  }

  async openDiff(): Promise<void> {
    const pd = this.pending;
    const p = pd && typeof pd.ev.path === "string" ? pd.ev.path : undefined;
    if (!pd || !p) return this.notice("There is no edit waiting for an answer.");
    const uri = this.uriOf(p);
    if (!uri) return;
    const before = pd.before;
    const a = this.toolArgs.get(p.replace(/\\/g, "/"));
    let after = proposedContent(String(pd.ev.tool), a?.args, before ?? null);
    let left: vscode.Uri = uri;
    const n = ++this.diffCount;
    const virt = (side: string, text: string) => {
      const u = vscode.Uri.from({ scheme: SCHEME, path: "/" + p.replace(/\\/g, "/"), query: `${side}${n}` });
      this.proposed.docs.set(u.toString(), text);
      return u;
    };
    if (after === undefined) {
      // only the snippet is known: diff the old text against the new
      left = virt("old", String(pd.ev.old_text ?? ""));
      after = String(pd.ev.new_text ?? "");
    } else if (before === null) left = virt("empty", "");
    const right = virt("new", after);
    await vscode.commands.executeCommand("vscode.diff", left, right, `${path.basename(p)}: current ↔ proposed (${NAME})`, { preview: true });
  }

  private async closeDiffs(): Promise<void> {
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputTextDiff && t.input.modified.scheme === SCHEME);
    if (tabs.length) await vscode.window.tabGroups.close(tabs);
    this.proposed.docs.clear();
  }

  private async undo(turn: number): Promise<void> {
    if (this.busy) return this.notice("Undo runs between turns: wait for this one to finish, or stop it.");
    const { restorable, unknown } = this.checkpoints.files(turn);
    const viaAgent = !!this.features?.includes("revert");
    const files = viaAgent ? [...restorable, ...unknown] : restorable;
    if (!files.length) {
      return this.notice(unknown.length ? `Can't undo: ${unknown.join(", ")} changed without an approval, and this fahh-agent can't revert (${NEXT_FAHH}).` : "This turn changed no files.");
    }
    const skipped = viaAgent || !unknown.length ? "" : `\n\nNot restorable here (changed without an approval): ${unknown.join(", ")}.`;
    const ok = await vscode.window.showWarningMessage(`Undo this turn? These files go back to how they were before it:\n\n${files.join("\n")}${skipped}`, { modal: true }, "Undo");
    if (ok !== "Undo") return;
    if (viaAgent) return void (await this.agentCommand("revert", { turn })); // the "reverted" line finishes it
    let done: string[];
    try {
      done = this.checkpoints.restore(turn, (p, content) => {
        const uri = this.uriOf(p);
        if (!uri) return;
        if (content === null) fs.rmSync(uri.fsPath, { force: true });
        else {
          fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
          fs.writeFileSync(uri.fsPath, content);
        }
      });
    } catch (e) {
      return this.post({ type: "error", message: `Undo failed: ${e instanceof Error ? e.message : String(e)}` });
    }
    this.undone(turn, done);
  }

  private undone(turn: number, files: string[]): void {
    this.checkpoints.forget(turn);
    this.undoNote += `The user undid the file changes of step ${turn}: ${files.join(", ")} are back to how they were before that step.\n`;
    this.transcript.push({ kind: "note", text: `Undid step ${turn}: ${files.join(", ")}` });
    this.post({ type: "undone", turn, files });
  }

  // ─── @ mentions ───────────────────────────────────────────────────────────────

  private async workspaceFiles(): Promise<string[]> {
    if (this.files && Date.now() - this.files.at < 15000) return this.files.list;
    const f = this.folder();
    if (!f) return [];
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(f, "**/*"), "**/{node_modules,.git,target,out,dist,build,.next,.venv,__pycache__}/**", 8000);
    const list = uris.map((u) => vscode.workspace.asRelativePath(u, false).replace(/\\/g, "/")).sort();
    this.files = { at: Date.now(), list };
    return list;
  }

  private async mention(q: string): Promise<void> {
    this.post({ type: "mentionOptions", q, items: mentionOptions(q, await this.workspaceFiles()) });
  }

  private async mentionAction(action: string): Promise<void> {
    let text: string | undefined;
    if (action === "selection") text = this.selectionText();
    else if (action === "file" || action === "folder") {
      const files = await this.workspaceFiles();
      const list = action === "file" ? files : foldersOf(files);
      const pick = await vscode.window.showQuickPick(list, { title: action === "file" ? "Mention a file" : "Mention a folder", placeHolder: "Type to filter" });
      if (pick) text = mentionToken(pick, action === "folder");
    }
    await this.focusChat();
    if (text) this.post({ type: "insert", text });
    else this.post({ type: "focusInput" });
  }

  /** The editor selection as a mention, or undefined (with a notice) when there is none. */
  private selectionText(): string | undefined {
    const ed = vscode.window.activeTextEditor ?? this.lastEditor;
    if (!ed || ed.selection.isEmpty) {
      this.notice("Select some code in the editor first, then mention @selection (or press Ctrl+L in the editor).");
      return undefined;
    }
    const s = ed.selection;
    const end = s.end.character === 0 && s.end.line > s.start.line ? s.end.line : s.end.line + 1;
    return selectionToken(vscode.workspace.asRelativePath(ed.document.uri, false), s.start.line + 1, end);
  }

  async focusChat(): Promise<void> {
    await vscode.commands.executeCommand("fahhLocalChat.chat.focus");
  }

  /** Ctrl+L / the editor menu: the selection as an @selection mention, or just the chat. */
  async askAboutSelection(): Promise<void> {
    const ed = vscode.window.activeTextEditor;
    const text = ed && !ed.selection.isEmpty ? this.selectionText() : undefined;
    await this.focusChat();
    this.post(text ? { type: "insert", text } : { type: "focusInput" });
  }

  /** The context block for the mentions in a prompt. Unknown paths stay plain text. */
  private async contextFor(text: string): Promise<ContextItem[]> {
    const items: ContextItem[] = [];
    const seen = new Set<string>();
    for (const m of parseMentions(text)) {
      const key = JSON.stringify(m);
      if (seen.has(key)) continue;
      seen.add(key);
      if (m.kind === "problems") {
        const lines: string[] = [];
        for (const [uri, diags] of vscode.languages.getDiagnostics()) {
          if (!vscode.workspace.getWorkspaceFolder(uri)) continue;
          for (const d of diags) {
            if (d.severity > vscode.DiagnosticSeverity.Warning) continue;
            const sev = d.severity === vscode.DiagnosticSeverity.Error ? "error" : "warning";
            lines.push(`${vscode.workspace.asRelativePath(uri, false)}:${d.range.start.line + 1}:${d.range.start.character + 1} ${sev}: ${d.message.split("\n")[0]}${d.source ? ` [${d.source}]` : ""}`);
          }
        }
        items.push({ kind: "problems", lines: lines.slice(0, 200) });
      } else if (m.kind === "selection") {
        const uri = this.uriOf(m.path);
        if (!uri) continue;
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          const end = Math.min(m.end, doc.lineCount);
          const range = new vscode.Range(m.start - 1, 0, end - 1, doc.lineAt(end - 1).text.length);
          items.push({ kind: "selection", path: m.path, start: m.start, end, text: doc.getText(range), lang: doc.languageId });
        } catch {
          /* the file is gone: the mention stays plain text */
        }
      } else {
        const uri = this.uriOf(m.path);
        if (!uri) continue;
        try {
          const st = fs.statSync(uri.fsPath);
          items.push({ kind: st.isDirectory() ? "folder" : "file", path: m.path });
        } catch {
          /* not a path in the workspace: plain text */
        }
      }
    }
    return items;
  }

  // ─── provider, model, keys, mode, permissions ────────────────────────────────

  /** Asks for a key; an empty answer removes it. Resolves true when a key is now stored. */
  async askKey(provider: string): Promise<boolean> {
    const p = PROVIDERS.find((x) => x.id === provider);
    if (!p?.keyEnv) {
      this.notice(`${providerLabel(provider)} needs no key.`);
      return true;
    }
    const box = vscode.window.createInputBox();
    box.title = `${p.label} API key`;
    box.prompt = "Stored in VS Code's secret storage; the agent gets it only as " + p.keyEnv + ". Leave empty to remove it.";
    box.password = true;
    box.ignoreFocusOut = true;
    const getKey = { iconPath: new vscode.ThemeIcon("link-external"), tooltip: `Get a key (${p.keyUrl})` };
    if (p.keyUrl) box.buttons = [getKey];
    box.onDidTriggerButton(() => p.keyUrl && void vscode.env.openExternal(vscode.Uri.parse(p.keyUrl)));
    const value = await new Promise<string | undefined>((resolve) => {
      box.onDidAccept(() => resolve(box.value));
      box.onDidHide(() => resolve(undefined));
      box.show();
    });
    box.dispose();
    if (value === undefined) return false;
    if (value.trim()) await this.ctx.secrets.store(secretName(provider), value.trim());
    else await this.ctx.secrets.delete(secretName(provider));
    this.notice(value.trim() ? `Saved the ${p.label} key.` : `Removed the ${p.label} key.`);
    return !!value.trim();
  }

  async keys(): Promise<void> {
    const items: Item<string>[] = [];
    for (const p of PROVIDERS.filter((x) => x.keyEnv)) {
      const st = await this.keyOf(p.id);
      items.push({ label: p.label, value: p.id, description: { stored: "key saved", env: `from ${p.keyEnv}`, missing: "no key", "none-needed": "" }[st] });
    }
    const pick = await vscode.window.showQuickPick(items, { title: "API keys", placeHolder: "Pick a provider to set or remove its key" });
    if (pick?.value) await this.askKey(pick.value);
  }

  async pickProvider(): Promise<boolean> {
    const c = this.cfg();
    const items: Item<string>[] = [];
    for (const p of PROVIDERS) {
      const st = await this.keyOf(p.id);
      const detail = { "none-needed": "Runs on this computer; no key", stored: "Key saved", env: `Key from ${p.keyEnv}`, missing: "No key yet: you'll be asked for one" }[st];
      items.push({ label: p.label, value: p.id, description: p.id === c.provider ? "current" : "", detail });
    }
    const pick = await vscode.window.showQuickPick(items, { title: "Provider", placeHolder: "Which provider runs the agent?" });
    return pick?.value ? this.switchProvider(pick.value) : false;
  }

  private async switchProvider(id: string): Promise<boolean> {
    if ((await this.keyOf(id)) === "missing" && !(await this.askKey(id))) return false;
    if (id !== this.cfg().provider) {
      await this.setCfg("provider", id);
      await this.setCfg("model", ""); // a model id belongs to its provider
    }
    return this.pickModel();
  }

  /** The model list comes from the provider (`fahh-agent models list`); any id can be typed too. */
  async pickModel(): Promise<boolean> {
    const c = this.cfg();
    if (c.provider === "mock") return true;
    if ((await this.keyOf(c.provider)) === "missing" && !(await this.askKey(c.provider))) return false;
    const exe = findAgent(c.binary);
    const qp = vscode.window.createQuickPick<Item<string>>();
    qp.title = `Model: ${providerLabel(c.provider)}`;
    qp.placeholder = "Loading the models your key can use… or type a model id";
    qp.matchOnDescription = true;
    qp.busy = true;
    let models: string[] = [];
    const head: Item<string>[] = [{ label: "$(arrow-swap) Change provider…", description: providerLabel(c.provider), value: "\0provider" }];
    const refresh = () => {
      const v = qp.value.trim();
      const typed: Item<string>[] = v && !models.includes(v) ? [{ label: `$(edit) Use "${v}"`, value: v, alwaysShow: true }] : [];
      const list = models.map((m): Item<string> => ({ label: m, value: m, description: m === c.model ? "current" : undefined }));
      qp.items = [...typed, ...head, { label: "Models", kind: vscode.QuickPickItemKind.Separator }, ...list];
    };
    qp.onDidChangeValue(refresh);
    refresh();
    const chosen = new Promise<string | undefined>((resolve) => {
      qp.onDidAccept(() => resolve(qp.selectedItems[0]?.value));
      qp.onDidHide(() => resolve(undefined));
    });
    qp.show();
    if (!exe) {
      qp.placeholder = "Fahh Editor is not installed, so models cannot be listed. Type a model id.";
    } else {
      const r = await run(exe, ["models", "list", "--provider", c.provider], await this.env(c.provider));
      models = parseModels(r.out);
      qp.placeholder = r.code === 0 ? `${models.length} models. Pick one, or type a model id` : `Could not list models (${lastLine(r.err)}). Type a model id.`;
      refresh();
    }
    qp.busy = false;
    const pick = await chosen;
    qp.dispose();
    if (!pick) return false;
    if (pick === "\0provider") return this.pickProvider();
    await this.setCfg("model", pick);
    this.notice(`Model: ${pick} (${providerLabel(c.provider)})`);
    return true;
  }

  async pickMode(): Promise<void> {
    const cur = this.cfg().mode;
    const pick = await vscode.window.showQuickPick(
      MODES.map((m): Item<string> => ({ label: (m.warn ? "$(warning) " : "") + m.label, description: m.id === cur ? "current" : "", detail: m.desc, value: m.id })),
      { title: "Permission mode" }
    );
    if (pick?.value) await this.setCfg("mode", pick.value);
  }

  /** Auto-approve rules: reads are always allowed by the agent; edits and commands ask or always. */
  async permissions(): Promise<void> {
    const r = this.rules();
    const word = (x: string) => (x === "always" ? "Always allowed" : "Ask first");
    const pick = await vscode.window.showQuickPick(
      [
        { label: "$(eye) Reads and searches", description: "Always allowed", detail: "The agent never asks to read files in the workspace." },
        { label: "$(edit) Edits", description: word(r.edits), detail: `Click to switch to: ${r.edits === "always" ? "ask first" : "always allowed"}`, value: "edits" },
        { label: "$(terminal) Commands", description: word(r.commands), detail: `Click to switch to: ${r.commands === "always" ? "ask first" : "always allowed (edits too)"}`, value: "commands" },
        { label: "$(settings-gear) Open in Settings", value: "settings" },
      ] as Item<string>[],
      { title: `${NAME}: auto-approve rules`, placeHolder: "Built-in blocks and deny rules in .fahh/permissions.json always apply" }
    );
    if (!pick?.value) return;
    if (pick.value === "settings") return void vscode.commands.executeCommand("workbench.action.openSettings", "fahhLocalChat.autoApprove");
    const key = pick.value as keyof Rules;
    const next = r[key] === "always" ? "ask" : "always";
    if (key === "commands" && next === "always") {
      const ok = await vscode.window.showWarningMessage(
        "Run commands without asking? A command can change any file, so edits are applied without asking too (the agent's bypass mode). Its built-in blocks (rm -rf /, sudo, …) and deny rules in .fahh/permissions.json still apply.",
        { modal: true },
        "Allow commands"
      );
      if (ok !== "Allow commands") return;
    }
    await vscode.workspace.getConfiguration(SECTION).update(`autoApprove.${key}`, next, vscode.ConfigurationTarget.Global);
    this.notice(`${key === "edits" ? "Edits" : "Commands"}: ${next === "always" ? "always allowed" : "ask first"}. Mode now: ${effectiveMode(this.cfg().mode, this.rules())}.`);
  }

  async statusMenu(): Promise<void> {
    const pick = await vscode.window.showQuickPick(
      [
        { label: "$(server-environment) Change model…", value: "model" },
        { label: "$(arrow-swap) Change provider…", value: "provider" },
        { label: "$(shield) Change mode…", value: "mode" },
        { label: "$(checklist) Auto-approve rules…", value: "permissions" },
        { label: "$(comment-discussion) Open chat", value: "chat" },
      ] as Item<string>[],
      { title: NAME }
    );
    if (pick?.value === "model") void this.pickModel();
    if (pick?.value === "provider") void this.pickProvider();
    if (pick?.value === "mode") void this.pickMode();
    if (pick?.value === "permissions") void this.permissions();
    if (pick?.value === "chat") void this.focusChat().then(() => this.post({ type: "focusInput" }));
  }

  async settings(): Promise<void> {
    const pick = await vscode.window.showQuickPick(
      [
        { label: "$(server-environment) Provider and model…", value: "provider" },
        { label: "$(key) API keys…", value: "keys" },
        { label: "$(checklist) Auto-approve rules…", value: "permissions" },
        { label: "$(file-binary) Fahh program path", value: "binary", description: findAgent(this.cfg().binary) ?? "not found" },
        { label: `$(settings-gear) All ${NAME} settings`, value: "all" },
      ] as Item<string>[],
      { title: `${NAME} settings` }
    );
    if (pick?.value === "provider") void this.pickProvider();
    if (pick?.value === "keys") void this.keys();
    if (pick?.value === "permissions") void this.permissions();
    if (pick?.value === "binary") void vscode.commands.executeCommand("workbench.action.openSettings", "fahhLocalChat.binary");
    if (pick?.value === "all") void vscode.commands.executeCommand("workbench.action.openSettings", "fahhLocalChat");
  }

  async exportChat(): Promise<void> {
    if (!this.transcript.length) return void vscode.window.showInformationMessage(`${NAME}: nothing to export yet.`);
    const c = this.cfg();
    const md = exportMarkdown(this.transcript, {
      title: `${NAME} chat`,
      model: `${providerLabel(c.provider)} / ${c.model || "default model"}`,
      folder: this.folder()?.name ?? "no folder",
      date: new Date().toISOString().slice(0, 16).replace("T", " "),
    });
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: md });
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  // ─── sessions ────────────────────────────────────────────────────────────────

  async pickSession(): Promise<void> {
    const f = this.folder();
    const exe = findAgent(this.cfg().binary);
    if (!f || !exe) return this.post({ type: "error", message: !f ? "Open a folder first." : "Fahh Editor was not found." });
    const r = await run(exe, ["sessions", "ls", "--cwd", f.uri.fsPath], process.env, f.uri.fsPath);
    if (r.code !== 0) return this.post({ type: "error", message: `Could not list sessions: ${lastLine(r.err)}` });
    const list = parseSessions(r.out);
    if (!list.length) return this.notice("No saved sessions for this folder yet.");
    const pick = await vscode.window.showQuickPick(
      list.map((s): Item<typeof s> => ({ label: s.title || "(untitled)", description: `${s.steps} step${s.steps === 1 ? "" : "s"}${s.id === this.session ? " · current" : ""}`, detail: s.id, value: s })),
      { title: "Resume a session", matchOnDetail: true }
    );
    if (pick?.value) await this.resume(pick.value.id, pick.value.title, pick.value.steps);
  }

  private async resume(id: string, title?: string, steps?: number): Promise<void> {
    if (this.busy) return this.notice("Stop the running turn first.");
    this.kill();
    this.session = id;
    this.resetTurnState();
    this.transcript.push({ kind: "note", text: `Resumed session ${title ? `"${title}"` : id}; earlier messages are in the saved session, not in this export.` });
    await this.ctx.workspaceState.update("fahhLocalChat.session", id);
    this.post({ type: "resumed", id, title: title ?? "", steps: steps ?? null });
    void this.pushState();
  }

  private resetTurnState(): void {
    this.transcript = [];
    this.checkpoints.clear();
    this.toolArgs.clear();
    this.usage = undefined;
    this.undoNote = "";
  }

  // ─── the agent process ───────────────────────────────────────────────────────

  /** Start the agent for this folder (resuming the saved session) if it is not running. */
  private async ensure(): Promise<boolean> {
    if (this.proc) return true;
    const folder = this.folder();
    if (!folder) {
      this.post({ type: "error", message: `Open a folder first: ${NAME} works inside a workspace.` });
      return false;
    }
    let c = this.cfg();
    const exe = findAgent(c.binary);
    if (!exe) {
      const pick = await vscode.window.showErrorMessage(`${NAME} needs Fahh Editor 0.8.8 or newer installed (it runs its agent).`, "Download Fahh Editor", "Set path");
      if (pick === "Download Fahh Editor") void vscode.env.openExternal(vscode.Uri.parse(DOWNLOAD));
      if (pick === "Set path") void vscode.commands.executeCommand("workbench.action.openSettings", "fahhLocalChat.binary");
      this.post({ type: "error", message: "Fahh Editor was not found." });
      return false;
    }
    if ((await this.keyOf(c.provider)) === "missing" && !(await this.askKey(c.provider))) {
      this.post({ type: "error", message: `No ${providerLabel(c.provider)} key yet. Add one, or switch provider with /provider.` });
      return false;
    }
    if (!c.model && !process.env.FAHH_AGENT_MODEL && c.provider !== "mock" && !(await this.pickModel())) {
      this.post({ type: "error", message: "Pick a model first (/model)." });
      return false;
    }
    c = this.cfg();
    if (this.proc) return true; // a setting change above may have raced us; nothing is running now anyway
    const mode = effectiveMode(c.mode, this.rules());
    const args = agentArgs(exe, { cwd: folder.uri.fsPath, provider: c.provider, model: c.model || undefined, mode, resume: this.session });
    const p = spawn(exe, args, { cwd: folder.uri.fsPath, env: await this.env(c.provider), windowsHide: true });
    this.proc = p;
    this.readyWait = new Promise((r) => (this.readyDone = r));
    const reader = new LineReader();
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d: string) => reader.push(d, (l) => this.onLine(l), (t) => this.post({ type: "log", text: t })));
    let err = "";
    p.stderr.setEncoding("utf8");
    p.stderr.on("data", (d: string) => (err = (err + d).slice(-2000)));
    p.on("error", (e) => this.post({ type: "error", message: `Could not start Fahh: ${e.message}` }));
    p.on("exit", (code) => {
      if (this.proc === p) this.proc = undefined;
      this.readyDone?.();
      if (this.busy) this.post({ type: "turn_end", ok: false, text: "" });
      this.busy = false;
      this.pending = undefined;
      if (code && code !== 0 && err.trim()) {
        // a stale saved session (deleted, or from another folder) is dropped, so the next try starts fresh
        if (/no saved session|damaged/.test(err)) void this.forgetSession();
        this.post({ type: "error", message: err.trim().split("\n").slice(-3).join(" ") });
      }
    });
    return true;
  }

  private onLine(l: AgentLine): void {
    switch (l.type) {
      case "ready":
        this.session = l.session;
        this.features = Array.isArray(l.features) ? l.features : [];
        this.readyDone?.();
        void this.ctx.workspaceState.update("fahhLocalChat.session", l.session);
        void this.pushState();
        break;
      case "event":
        addEvent(this.transcript, l.event);
        this.onEvent(l.event);
        break;
      case "turn_end": {
        this.busy = false;
        if (l.text) this.lastReply = l.text;
        if (l.usage) this.usage = l.usage;
        this.paintStatus();
        const { restorable, unknown } = this.checkpoints.files(this.turn);
        const changed = [...restorable, ...unknown];
        if (this.restartAfterTurn) {
          this.restartAfterTurn = false;
          this.kill();
        }
        return this.post({ ...l, turn: this.turn, changed });
      }
      case "usage": {
        const { type: _t, ...u } = l;
        this.usage = u;
        this.paintStatus();
        if (this.showUsage) this.notice(usageDetail(u));
        this.showUsage = false;
        return;
      }
      case "compacted":
        this.transcript.push({ kind: "note", text: `Context compacted: ${l.messages} messages, ~${l.before} to ~${l.after} tokens` });
        this.notice(`Compacted ${l.messages} messages: ~${l.before} to ~${l.after} tokens.`);
        if (this.features?.includes("usage")) this.write({ command: "usage" });
        return;
      case "reverted":
        return this.undone(l.turn, l.files);
    }
    this.post(l);
  }

  private async prompt(text: string, mode: string, shown = text): Promise<void> {
    if (!text.trim() || this.busy) return;
    if (!(await this.ensure())) return;
    this.busy = true;
    this.transcript.push({ kind: "user", text: shown, mode });
    this.post({ type: "user", text: shown, mode });
    let full = text;
    try {
      full = withContext(text, await this.contextFor(text));
    } catch (e) {
      this.notice(`Could not attach the mentioned context: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (this.undoNote) {
      full = `(Note from VS Code: ${this.undoNote.trim()})\n\n${full}`;
      this.undoNote = "";
    }
    this.write({ prompt: full, mode: effectiveMode(mode, this.rules()) });
  }

  /** Stop the turn: the process ends; the session is saved and the next prompt resumes it. */
  stop(): void {
    if (!this.proc) return;
    this.kill();
    this.notice("Stopped. The session is saved; your next message continues it.");
  }

  private kill(): void {
    const p = this.proc;
    this.proc = undefined;
    this.pending = undefined;
    if (p && !p.killed) p.kill();
  }

  private async forgetSession(): Promise<void> {
    this.session = undefined;
    await this.ctx.workspaceState.update("fahhLocalChat.session", undefined);
  }

  async newSession(): Promise<void> {
    this.kill();
    this.busy = false;
    this.resetTurnState();
    await this.forgetSession();
    this.post({ type: "cleared" });
    void this.pushState();
  }

  private html(w: vscode.Webview): string {
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const js = w.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "chat.js"));
    const css = w.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "chat.css"));
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource}; style-src ${w.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${css}"></head>
<body>
<main id="log" aria-live="polite" aria-label="Conversation"></main>
<div id="activity" hidden><span class="pulse" aria-hidden="true"></span><span id="activity-text"></span></div>
<form id="composer" autocomplete="off">
  <div id="slash" role="listbox" aria-label="Suggestions" hidden></div>
  <div id="modes" role="listbox" aria-label="Permission mode" hidden></div>
  <div class="box">
    <textarea id="input" rows="2" aria-label="Message" placeholder="Ask Fahh Familiar to read, change or run something.  / commands  @ context" aria-autocomplete="list" aria-controls="slash"></textarea>
    <div class="bar">
      <button type="button" id="mode" class="chip" aria-haspopup="listbox" aria-controls="modes" title="Permission mode"></button>
      <button type="button" id="model" class="chip model" title="Provider and model"></button>
      <span class="grow"></span>
      <button type="button" id="stop" class="icon danger" title="Stop (the session is kept)" aria-label="Stop" hidden></button>
      <button type="submit" id="send" class="icon primary" title="Send (Enter)" aria-label="Send"></button>
    </div>
  </div>
</form>
<script nonce="${nonce}" src="${js}"></script></body></html>`;
  }
}

export function activate(ctx: vscode.ExtensionContext): void {
  const chat = new ChatView(ctx);
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider("fahhLocalChat.chat", chat, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, chat.proposed),
    vscode.commands.registerCommand("fahhLocalChat.newSession", () => chat.newSession()),
    vscode.commands.registerCommand("fahhLocalChat.stop", () => chat.stop()),
    vscode.commands.registerCommand("fahhLocalChat.resume", () => chat.pickSession()),
    vscode.commands.registerCommand("fahhLocalChat.pickModel", () => chat.pickModel()),
    vscode.commands.registerCommand("fahhLocalChat.pickProvider", () => chat.pickProvider()),
    vscode.commands.registerCommand("fahhLocalChat.pickMode", () => chat.pickMode()),
    vscode.commands.registerCommand("fahhLocalChat.setApiKey", () => chat.keys()),
    vscode.commands.registerCommand("fahhLocalChat.settings", () => chat.settings()),
    vscode.commands.registerCommand("fahhLocalChat.permissions", () => chat.permissions()),
    vscode.commands.registerCommand("fahhLocalChat.export", () => chat.exportChat()),
    vscode.commands.registerCommand("fahhLocalChat.statusMenu", () => chat.statusMenu()),
    vscode.commands.registerCommand("fahhLocalChat.askAboutSelection", () => chat.askAboutSelection()),
    vscode.commands.registerCommand("fahhLocalChat.acceptEdit", () => chat.answer(true, false, undefined, true)),
    vscode.commands.registerCommand("fahhLocalChat.rejectEdit", () => chat.answer(false, false, undefined, true))
  );
  registerSelfUpdate(ctx, NAME, "fahhLocalChat.checkForUpdates");
}

export function deactivate(): void {}
