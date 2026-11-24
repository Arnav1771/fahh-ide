// Self-update for an extension installed from a .vsix (no Marketplace, so VS Code's Update button can't help).
// Copied as-is into each Stealth Keqing extension; only the constants below differ.
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Latest, MAX_JSON_BYTES, MAX_VSIX_BYTES, compareSemver, fetchBuffer, parseLatest } from "./updateCore";

const LATEST_URL = "https://fahhide.duckdns.org/vscode/latest.json";
// arnav1771.github.io/fahh-ide redirects to this custom domain, so both hosts are allowed.
const HOSTS = ["arnav1771.github.io", "fahhide.duckdns.org"];
const DAY_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = "selfUpdate.lastCheck";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function registerSelfUpdate(ctx: vscode.ExtensionContext, name: string, commandId: string): void {
  const log = vscode.window.createOutputChannel(`${name} Updates`);
  ctx.subscriptions.push(log, vscode.commands.registerCommand(commandId, () => check(ctx, name, log, true)));
  if (Date.now() - ctx.globalState.get<number>(LAST_CHECK_KEY, 0) >= DAY_MS) void check(ctx, name, log, false);
}

async function check(ctx: vscode.ExtensionContext, name: string, log: vscode.OutputChannel, manual: boolean): Promise<void> {
  const current = String(ctx.extension.packageJSON.version);
  let latest: Latest;
  try {
    latest = parseLatest((await fetchBuffer(LATEST_URL, HOSTS, MAX_JSON_BYTES)).toString("utf8"), HOSTS);
    await ctx.globalState.update(LAST_CHECK_KEY, Date.now());
  } catch (e) {
    log.appendLine(`[${new Date().toISOString()}] update check failed: ${errText(e)}`);
    if (manual) void vscode.window.showWarningMessage(`${name}: couldn't check for updates. See the "${name} Updates" output.`);
    return;
  }
  if (compareSemver(latest.version, current) <= 0) {
    log.appendLine(`[${new Date().toISOString()}] ${current} is current (latest ${latest.version})`);
    if (manual) void vscode.window.showInformationMessage(`You're on the latest version of ${name} (${current}).`);
    return;
  }
  let pick = await vscode.window.showInformationMessage(`${name} ${latest.version} is available`, "Update", "Release notes", "Later");
  if (pick === "Release notes") {
    pick = await vscode.window.showInformationMessage(`${name} ${latest.version}`, { modal: true, detail: latest.notes || "No notes for this release." }, "Update");
  }
  if (pick === "Update") await install(ctx, name, latest, log);
}

async function install(ctx: vscode.ExtensionContext, name: string, latest: Latest, log: vscode.OutputChannel): Promise<void> {
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Updating ${name} to ${latest.version}...` }, async () => {
      const vsix = await fetchBuffer(latest.url, HOSTS, MAX_VSIX_BYTES);
      if (vsix.subarray(0, 2).toString("latin1") !== "PK") throw new Error("download is not a .vsix (zip) file");
      const file = path.join(os.tmpdir(), `${ctx.extension.id}-${latest.version}.vsix`);
      fs.writeFileSync(file, vsix);
      await vscode.commands.executeCommand("workbench.extensions.installExtension", vscode.Uri.file(file));
    });
  } catch (e) {
    log.appendLine(`[${new Date().toISOString()}] update failed: ${errText(e)}`);
    void vscode.window.showErrorMessage(`${name}: update failed: ${errText(e)}`);
    return;
  }
  log.appendLine(`[${new Date().toISOString()}] installed ${latest.version}`);
  const r = await vscode.window.showInformationMessage(`${name} ${latest.version} is installed. Reload to start using it.`, "Reload Window");
  if (r === "Reload Window") await vscode.commands.executeCommand("workbench.action.reloadWindow");
}
