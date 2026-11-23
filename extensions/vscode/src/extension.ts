// Fahh Local in VS Code: a chat view that drives `fahh agent --json` in the open folder.
import * as vscode from "vscode";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { AgentLine, KEY_ENV, LineReader, agentArgs, findAgent } from "./protocol";

const DOWNLOAD = "https://fahhide.duckdns.org/#download";

class ChatView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private proc?: ChildProcessWithoutNullStreams;
  private session?: string;
  private busy = false;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.session = ctx.workspaceState.get<string>("fahhLocal.session");
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

  private cfg() {
    const c = vscode.workspace.getConfiguration("fahhLocal");
    return { provider: c.get<string>("provider", "groq"), model: c.get<string>("model", ""), mode: c.get<string>("mode", "normal"), binary: c.get<string>("binary", "") };
  }

  private async onMessage(m: { type: string; text?: string; mode?: string; allow?: boolean; always?: boolean; command?: string }): Promise<void> {
    switch (m.type) {
      case "ready":
        return this.post({ type: "config", ...this.cfg(), hasFolder: !!this.folder(), session: this.session ?? null });
      case "prompt":
        return this.prompt(m.text ?? "", m.mode ?? this.cfg().mode);
      case "approve":
        return this.write({ allow: !!m.allow, always: !!m.always, ...(m.command ? { command: m.command } : {}) });
      case "stop":
        return this.stop();
      case "new":
        return this.newSession();
      case "setKey":
        return vscode.commands.executeCommand("fahhLocal.setApiKey");
      case "settings":
        return vscode.commands.executeCommand("workbench.action.openSettings", "fahhLocal");
      case "openFile": {
        const f = this.folder();
        if (f && m.text) void vscode.window.showTextDocument(vscode.Uri.joinPath(f.uri, m.text));
        return;
      }
    }
  }

  private folder() {
    return vscode.workspace.workspaceFolders?.[0];
  }

  private write(v: unknown): void {
    this.proc?.stdin.write(JSON.stringify(v) + "\n");
  }

  /** Start the agent for this folder (resuming the saved session) if it is not running. */
  private async ensure(): Promise<boolean> {
    if (this.proc) return true;
    const folder = this.folder();
    if (!folder) {
      this.post({ type: "error", message: "Open a folder first: Fahh Local works inside a workspace." });
      return false;
    }
    const c = this.cfg();
    const exe = findAgent(c.binary);
    if (!exe) {
      const pick = await vscode.window.showErrorMessage("Fahh Local needs Fahh Editor 0.8.8 or newer installed (it runs its agent).", "Download Fahh Editor", "Set path");
      if (pick === "Download Fahh Editor") void vscode.env.openExternal(vscode.Uri.parse(DOWNLOAD));
      if (pick === "Set path") void vscode.commands.executeCommand("workbench.action.openSettings", "fahhLocal.binary");
      this.post({ type: "error", message: "Fahh Editor was not found." });
      return false;
    }
    const env: NodeJS.ProcessEnv = { ...process.env };
    const keyEnv = KEY_ENV[c.provider] ?? "";
    if (keyEnv) {
      const key = await this.ctx.secrets.get(`fahhLocal.key.${c.provider}`);
      if (key) env[keyEnv] = key;
      else if (!process.env[keyEnv]) {
        const pick = await vscode.window.showWarningMessage(`Fahh Local needs a ${c.provider} API key.`, "Set API key");
        if (pick) await vscode.commands.executeCommand("fahhLocal.setApiKey");
        const again = await this.ctx.secrets.get(`fahhLocal.key.${c.provider}`);
        if (!again) {
          this.post({ type: "error", message: `No ${c.provider} API key yet. Use the key button above, or pick another provider in Settings.` });
          return false;
        }
        env[keyEnv] = again;
      }
    }
    const args = agentArgs(exe, { cwd: folder.uri.fsPath, provider: c.provider, model: c.model || undefined, mode: c.mode, resume: this.session });
    const p = spawn(exe, args, { cwd: folder.uri.fsPath, env, windowsHide: true });
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
      void this.ctx.workspaceState.update("fahhLocal.session", l.session);
    }
    if (l.type === "turn_end") this.busy = false;
    this.post(l);
  }

  private async prompt(text: string, mode: string): Promise<void> {
    if (!text.trim() || this.busy) return;
    if (!(await this.ensure())) return;
    this.busy = true;
    this.post({ type: "user", text });
    this.write({ prompt: text, mode });
  }

  /** Stop the turn: the process ends; the session is saved and the next prompt resumes it. */
  stop(): void {
    this.kill();
    this.post({ type: "notice", text: "Stopped. The session is saved; your next message continues it." });
  }

  private kill(): void {
    const p = this.proc;
    this.proc = undefined;
    if (p && !p.killed) p.kill();
  }

  private async forgetSession(): Promise<void> {
    this.session = undefined;
    await this.ctx.workspaceState.update("fahhLocal.session", undefined);
  }

  async newSession(): Promise<void> {
    this.kill();
    this.busy = false;
    await this.forgetSession();
    this.post({ type: "cleared" });
  }

  private html(w: vscode.Webview): string {
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const js = w.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "chat.js"));
    const css = w.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "chat.css"));
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${w.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${css}"></head>
<body><main id="log" aria-live="polite"></main>
<form id="composer"><textarea id="input" rows="3" placeholder="Ask Fahh Local (Enter to send, Shift+Enter for a new line)"></textarea>
<div class="row"><select id="mode" title="Permission mode"><option value="normal">Ask</option><option value="accept-edits">Edits</option><option value="smart">Smart</option><option value="plan">Plan</option><option value="bypass">Bypass</option></select>
<span id="status"></span><button type="button" id="stop" class="secondary" hidden>Stop</button><button type="submit" id="send">Send</button></div></form>
<script nonce="${nonce}" src="${js}"></script></body></html>`;
  }
}

export function activate(ctx: vscode.ExtensionContext): void {
  const chat = new ChatView(ctx);
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider("fahhLocal.chat", chat, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("fahhLocal.newSession", () => chat.newSession()),
    vscode.commands.registerCommand("fahhLocal.stop", () => chat.stop()),
    vscode.commands.registerCommand("fahhLocal.setApiKey", async () => {
      const provider = vscode.workspace.getConfiguration("fahhLocal").get<string>("provider", "groq");
      if (!KEY_ENV[provider]) return vscode.window.showInformationMessage(`${provider} needs no key.`);
      const key = await vscode.window.showInputBox({ title: `API key for ${provider}`, prompt: "Stored in VS Code's secret storage; passed to the agent only as an environment variable.", password: true, ignoreFocusOut: true });
      if (key === undefined) return;
      if (key.trim()) await ctx.secrets.store(`fahhLocal.key.${provider}`, key.trim());
      else await ctx.secrets.delete(`fahhLocal.key.${provider}`);
      vscode.window.showInformationMessage(key.trim() ? `Saved the ${provider} key.` : `Removed the ${provider} key.`);
    })
  );
}

export function deactivate(): void {}
