// Fahh Local Chat in VS Code: a chat view that drives `fahh agent --json` in the open folder.
// JSON mode has no slash commands, so they live here: most of them change a setting, and a
// setting change restarts the agent with new flags, resuming the same session.
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ChildProcessWithoutNullStreams, execFile, spawn } from "child_process";
import { AgentLine, LineReader, MODES, PROVIDERS, SLASH, agentArgs, agentEnv, agentWord, detectFacts, findAgent, keyState, parseModels, parseSessions, parseSlash, providerLabel, starters } from "./protocol";

const DOWNLOAD = "https://fahhide.duckdns.org/#download";
const secretName = (provider: string) => `fahhLocalChat.key.${provider}`;
const SECTION = "fahhLocalChat";
// ponytail: 0.2.x settings lived under "fahhLocal"; read them as a fallback for one release, drop in 0.4.
const OLD_SECTION = "fahhLocal";

/** A setting from fahhLocalChat.*, or the old fahhLocal.* value when the new one was never set. */
function setting<T>(key: string, def: T): T {
  const i = vscode.workspace.getConfiguration(SECTION).inspect<T>(key);
  const own = i?.workspaceFolderValue ?? i?.workspaceValue ?? i?.globalValue;
  return own !== undefined ? own : vscode.workspace.getConfiguration(OLD_SECTION).get<T>(key, def);
}
type Item<T> = vscode.QuickPickItem & { value?: T };

/** Runs a short fahh-agent subcommand (models list, sessions ls). */
function run(exe: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(exe, [...agentWord(exe), ...args], { env, cwd, timeout: 20000, windowsHide: true, maxBuffer: 4 << 20 }, (e, out, err) =>
      resolve({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, out: String(out), err: String(err || (e ? e.message : "")) })
    );
  });
}

const lastLine = (s: string) => s.trim().split(/\r?\n/).pop()?.replace(/^fahh-agent:\s*/, "") ?? "";

class ChatView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private proc?: ChildProcessWithoutNullStreams;
  private session?: string;
  private busy = false;
  private restartAfterTurn = false;
  private lastReply = "";

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.session = ctx.workspaceState.get<string>("fahhLocalChat.session");
    ctx.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration(SECTION) && !e.affectsConfiguration(OLD_SECTION)) return;
        // provider, model and binary are process flags: restart (the session resumes)
        if (this.busy) this.restartAfterTurn = true;
        else this.kill();
        void this.pushState();
      }),
      vscode.window.onDidChangeActiveTextEditor(() => void this.pushState()),
      ctx.secrets.onDidChange(() => void this.pushState())
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "media")] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((m) => this.onMessage(m));
    view.onDidDispose(() => this.kill());
  }

  private post(m: unknown): void {
    void this.view?.webview.postMessage(m);
  }

  private notice(text: string): void {
    this.post({ type: "notice", text });
  }

  private cfg() {
    return { provider: setting("provider", "groq"), model: setting("model", ""), mode: setting("mode", "normal"), binary: setting("binary", "") };
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

  private async keyOf(provider: string) {
    return keyState(provider, !!(await this.ctx.secrets.get(secretName(provider))), process.env);
  }

  private async env(provider: string): Promise<NodeJS.ProcessEnv> {
    return agentEnv(provider, await this.ctx.secrets.get(secretName(provider)), process.env);
  }

  /** Everything the webview shows outside the transcript. Only real values: nothing is made up. */
  private async pushState(): Promise<void> {
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
      key: await this.keyOf(c.provider),
      folder: f?.name ?? null,
      agentFound: !!findAgent(c.binary),
      session: this.session ?? null,
      busy: this.busy,
      starters: starts,
      slash: SLASH,
      modes: MODES,
    });
  }

  private async onMessage(m: { type: string; text?: string; mode?: string; allow?: boolean; always?: boolean; command?: string }): Promise<void> {
    switch (m.type) {
      case "ready":
        return this.pushState();
      case "prompt":
        return this.input(m.text ?? "", m.mode ?? this.cfg().mode);
      case "approve":
        return this.write({ allow: !!m.allow, always: !!m.always, ...(m.command ? { command: m.command } : {}) });
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
        const f = this.folder();
        if (!m.text) return;
        const uri = path.isAbsolute(m.text) ? vscode.Uri.file(m.text) : f ? vscode.Uri.joinPath(f.uri, m.text) : undefined;
        if (uri) void vscode.window.showTextDocument(uri, { preview: true });
        return;
      }
    }
  }

  /** What the composer sent: a slash command or a prompt. */
  private async input(text: string, mode: string): Promise<void> {
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

  // ─── provider, model, keys ──────────────────────────────────────────────────

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

  async settings(): Promise<void> {
    const pick = await vscode.window.showQuickPick(
      [
        { label: "$(server-environment) Provider and model…", value: "provider" },
        { label: "$(key) API keys…", value: "keys" },
        { label: "$(file-binary) Fahh program path", value: "binary", description: findAgent(this.cfg().binary) ?? "not found" },
        { label: "$(settings-gear) All Fahh Local Chat settings", value: "all" },
      ] as Item<string>[],
      { title: "Fahh Local Chat settings" }
    );
    if (pick?.value === "provider") void this.pickProvider();
    if (pick?.value === "keys") void this.keys();
    if (pick?.value === "binary") void vscode.commands.executeCommand("workbench.action.openSettings", "fahhLocalChat.binary");
    if (pick?.value === "all") void vscode.commands.executeCommand("workbench.action.openSettings", "fahhLocalChat");
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
    await this.ctx.workspaceState.update("fahhLocalChat.session", id);
    this.post({ type: "resumed", id, title: title ?? "", steps: steps ?? null });
    void this.pushState();
  }

  // ─── the agent process ───────────────────────────────────────────────────────

  /** Start the agent for this folder (resuming the saved session) if it is not running. */
  private async ensure(): Promise<boolean> {
    if (this.proc) return true;
    const folder = this.folder();
    if (!folder) {
      this.post({ type: "error", message: "Open a folder first: Fahh Local Chat works inside a workspace." });
      return false;
    }
    let c = this.cfg();
    const exe = findAgent(c.binary);
    if (!exe) {
      const pick = await vscode.window.showErrorMessage("Fahh Local Chat needs Fahh Editor 0.8.8 or newer installed (it runs its agent).", "Download Fahh Editor", "Set path");
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
    const args = agentArgs(exe, { cwd: folder.uri.fsPath, provider: c.provider, model: c.model || undefined, mode: c.mode, resume: this.session });
    const p = spawn(exe, args, { cwd: folder.uri.fsPath, env: await this.env(c.provider), windowsHide: true });
    this.proc = p;
    const reader = new LineReader();
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d: string) => reader.push(d, (l) => this.onLine(l), (t) => this.post({ type: "log", text: t })));
    let err = "";
    p.stderr.setEncoding("utf8");
    p.stderr.on("data", (d: string) => (err = (err + d).slice(-2000)));
    p.on("error", (e) => this.post({ type: "error", message: `Could not start Fahh: ${e.message}` }));
    p.on("exit", (code) => {
      if (this.proc === p) this.proc = undefined;
      if (this.busy) this.post({ type: "turn_end", ok: false, text: "" });
      this.busy = false;
      if (code && code !== 0 && err.trim()) {
        // a stale saved session (deleted, or from another folder) is dropped, so the next try starts fresh
        if (/no saved session|damaged/.test(err)) void this.forgetSession();
        this.post({ type: "error", message: err.trim().split("\n").slice(-3).join(" ") });
      }
    });
    return true;
  }

  private onLine(l: AgentLine): void {
    if (l.type === "ready") {
      this.session = l.session;
      void this.ctx.workspaceState.update("fahhLocalChat.session", l.session);
    }
    if (l.type === "turn_end") {
      this.busy = false;
      if (l.text) this.lastReply = l.text;
      if (this.restartAfterTurn) {
        this.restartAfterTurn = false;
        this.kill();
      }
    }
    this.post(l);
  }

  private async prompt(text: string, mode: string, shown = text): Promise<void> {
    if (!text.trim() || this.busy) return;
    if (!(await this.ensure())) return;
    this.busy = true;
    this.post({ type: "user", text: shown, mode });
    this.write({ prompt: text, mode });
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
    if (p && !p.killed) p.kill();
  }

  private async forgetSession(): Promise<void> {
    this.session = undefined;
    await this.ctx.workspaceState.update("fahhLocalChat.session", undefined);
  }

  async newSession(): Promise<void> {
    this.kill();
    this.busy = false;
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
  <div id="slash" role="listbox" aria-label="Commands" hidden></div>
  <div id="modes" role="listbox" aria-label="Permission mode" hidden></div>
  <div class="box">
    <textarea id="input" rows="2" aria-label="Message" placeholder="Ask Fahh to read, change or run something.  / for commands" aria-autocomplete="list" aria-controls="slash"></textarea>
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
    vscode.commands.registerCommand("fahhLocalChat.newSession", () => chat.newSession()),
    vscode.commands.registerCommand("fahhLocalChat.stop", () => chat.stop()),
    vscode.commands.registerCommand("fahhLocalChat.resume", () => chat.pickSession()),
    vscode.commands.registerCommand("fahhLocalChat.pickModel", () => chat.pickModel()),
    vscode.commands.registerCommand("fahhLocalChat.pickProvider", () => chat.pickProvider()),
    vscode.commands.registerCommand("fahhLocalChat.setApiKey", () => chat.keys()),
    vscode.commands.registerCommand("fahhLocalChat.settings", () => chat.settings())
  );
}

export function deactivate(): void {}
