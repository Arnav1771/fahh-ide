/**
 * Language servers inside Monaco: document sync, the feature providers, and applying
 * workspace edits. One instance for the app (`getLspService`), created by `LspBridge`.
 *
 * Who answers what, per language (no doubled suggestions):
 *  - a primary server is ready  -> its providers are registered and Monaco's built-in
 *    TS/JS/CSS/HTML/JSON worker features for that language are switched off;
 *  - no server (missing, starting, failed) -> the built-in workers answer, as before.
 * Extra servers (ESLint, Ruff, Tailwind) only add to whatever the primary source says.
 */
import type * as Monaco from "monaco-editor";
import { LspClient, type LspTransport } from "./client";
import {
  applyResolvedCompletion,
  applyTextEdits,
  completionsToMonaco,
  flattenWorkspaceEdit,
  highlightsToMonaco,
  hoverToMonaco,
  inlayHintsToMonaco,
  locationsToMonaco,
  pathKey,
  signatureHelpToMonaco,
  toLspPosition,
  toLspRange,
  toMonacoRange,
  uriToFahhPath,
  type LspCompletionItem,
  type LspDiagnostic,
  type LspRange,
  type LspWorkspaceEdit,
  type MCompletionItem,
} from "./protocol";
import { configurationFor, isExtraServer, languagesOf, lspLanguageId, primaryServerFor } from "./servers";

type M = typeof Monaco;
type Model = Monaco.editor.ITextModel;
type Disposable = { dispose(): void };

export interface LspServiceDeps {
  /** Open tabs as Fahh knows them (path, current text). */
  openTabs(): { path: string; content: string | undefined }[];
  setTabContent(path: string, text: string): void;
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  createFile(path: string): Promise<void>;
  renameFile(from: string, to: string): Promise<void>;
  openAt(path: string, line?: number, column?: number): Promise<void>;
  languageFor(path: string): string;
  toast(text: string, kind?: "ok" | "error"): void;
  onStatus?(server: string, status: string, detail?: string): void;
  onDiagnostics?(server: string, uri: string, diagnostics: LspDiagnostic[]): void;
  windows: boolean;
}

export const APPLY_CODE_ACTION = "fahh.lsp.applyCodeAction";

const overlaps = (a: LspRange, b: LspRange) =>
  !(a.end.line < b.start.line || (a.end.line === b.start.line && a.end.character < b.start.character) ||
    b.end.line < a.start.line || (b.end.line === a.start.line && b.end.character < a.start.character));

export class LspService {
  readonly client: LspClient;
  private providers = new Map<string, Disposable[]>();
  private modelSubs = new Map<string, Disposable[]>();
  private globalSubs: Disposable[] = [];
  /** Raw diagnostics per server and uri: code actions must send back exactly what the server published (Ruff needs `data`). */
  private rawDiagnostics = new Map<string, Map<string, LspDiagnostic[]>>();
  /** Files written to disk by the last multi-file edit, with their previous text. */
  private lastClosedEdit: { path: string; before: string }[] = [];
  private peekModels = new Set<string>();

  constructor(private monaco: M, transport: LspTransport, private deps: LspServiceDeps) {
    this.client = new LspClient(transport, {
      onStatus: (server, status, detail) => this.onStatus(server, status, detail),
      onNotification: (server, method, params) => {
        if (method === "textDocument/publishDiagnostics") {
          const p = params as { uri?: string; diagnostics?: LspDiagnostic[] };
          if (typeof p?.uri !== "string" || !Array.isArray(p.diagnostics)) return;
          const per = this.rawDiagnostics.get(server) ?? new Map<string, LspDiagnostic[]>();
          per.set(this.canonical(p.uri), p.diagnostics);
          this.rawDiagnostics.set(server, per);
          deps.onDiagnostics?.(server, p.uri, p.diagnostics);
        }
      },
      applyEdit: (_server, edit) => this.applyWorkspaceEdit(edit).then((r) => r.ok),
      configuration: (server, section, workspaceUri) => configurationFor(server, section, workspaceUri),
    });

    this.globalSubs.push(
      monaco.editor.onDidCreateModel((m) => this.watchModel(m)),
      monaco.editor.registerEditorOpener({
        openCodeEditor: (_source, resource, sel) => {
          if (resource.scheme !== "file") return false;
          const pos = sel && "startLineNumber" in sel ? { line: sel.startLineNumber, column: sel.startColumn } : sel ? { line: sel.lineNumber, column: sel.column } : undefined;
          void deps.openAt(this.pathFor(resource.toString()), pos?.line, pos?.column);
          return true;
        },
      }),
      monaco.editor.registerCommand(APPLY_CODE_ACTION, (_accessor, server: string, action: unknown) => {
        void this.runCodeAction(server, action);
      })
    );
    for (const m of monaco.editor.getModels()) this.watchModel(m);
  }

  dispose(): void {
    for (const ds of [...this.providers.values(), ...this.modelSubs.values(), this.globalSubs]) ds.forEach((d) => d.dispose());
    this.providers.clear();
    this.modelSubs.clear();
    this.globalSubs = [];
    void this.client.stopAll();
  }

  // ── Paths and URIs ─────────────────────────────────────────────────────────

  /** One spelling per document (servers may write file:///C:/x or file:///c%3A/x). */
  canonical(uri: string): string {
    try {
      return this.monaco.Uri.parse(uri).toString();
    } catch {
      return uri;
    }
  }

  /** A server's URI -> the path of the open tab for it, else Fahh's spelling of the path. */
  pathFor(uri: string): string {
    const path = uriToFahhPath(uri, this.deps.windows);
    const key = pathKey(path);
    return this.deps.openTabs().find((t) => pathKey(t.path) === key)?.path ?? path;
  }

  uriForPath(path: string): string {
    const fwd = path.replace(/\\/g, "/");
    if (fwd.startsWith("//")) return this.monaco.Uri.from({ scheme: "file", authority: fwd.slice(2).split("/")[0], path: "/" + fwd.slice(2).split("/").slice(1).join("/") }).toString();
    return this.monaco.Uri.file(fwd).toString();
  }

  /** The servers (ready ones) that serve a Monaco language: the primary first. */
  serversFor(language: string): string[] {
    const ready = this.client.readyServers();
    const primary = primaryServerFor(language);
    const out = primary && ready.includes(primary) ? [primary] : [];
    for (const s of ready) if (s !== primary && isExtraServer(s) && languagesOf(s).includes(language)) out.push(s);
    return out;
  }

  // ── Server lifecycle (status changes) ──────────────────────────────────────

  private onStatus(server: string, status: string, detail?: string): void {
    if (status === "ready") {
      this.registerProviders(server);
      if (!isExtraServer(server)) this.setBuiltins(server, false);
      for (const m of this.monaco.editor.getModels()) this.openModel(m, server);
    } else if (status === "failed" || status === "stopped") {
      this.providers.get(server)?.forEach((d) => d.dispose());
      this.providers.delete(server);
      this.rawDiagnostics.delete(server);
      if (!isExtraServer(server)) this.setBuiltins(server, true);
    }
    this.deps.onStatus?.(server, status, detail);
  }

  /** Switch Monaco's own worker features for a server's languages on or off. */
  private setBuiltins(server: string, on: boolean): void {
    const L = this.monaco.languages as unknown as Record<string, Record<string, { modeConfiguration?: Record<string, boolean>; setModeConfiguration?(c: Record<string, boolean>): void }>>;
    const targets: { modeConfiguration?: Record<string, boolean>; setModeConfiguration?(c: Record<string, boolean>): void }[] = [];
    if (server === "typescript") targets.push(L.typescript?.typescriptDefaults, L.typescript?.javascriptDefaults);
    if (server === "css") targets.push(L.css?.cssDefaults, L.css?.scssDefaults, L.css?.lessDefaults);
    if (server === "html") targets.push(L.html?.htmlDefaults);
    if (server === "json") targets.push(L.json?.jsonDefaults);
    const overlapping = ["completionItems", "hovers", "definitions", "references", "documentHighlights", "rename", "signatureHelp", "codeActions", "inlayHints", "diagnostics"];
    for (const d of targets) {
      if (!d?.setModeConfiguration) continue;
      const current = d.modeConfiguration ?? {};
      const next: Record<string, boolean> = { ...current };
      for (const k of overlapping) if (k in current) next[k] = on;
      d.setModeConfiguration(next);
    }
  }

  // ── Documents ──────────────────────────────────────────────────────────────

  private watchModel(model: Model): void {
    if (model.uri.scheme !== "file") return;
    const uri = model.uri.toString();
    this.modelSubs.get(uri)?.forEach((d) => d.dispose());
    const subs: Disposable[] = [
      model.onDidChangeContent((e) => {
        const changes = e.changes.map((c) => ({ range: toLspRange(c.range), rangeLength: c.rangeLength, text: c.text }));
        for (const s of this.client.readyServers()) {
          if (this.client.isOpen(s, uri)) this.client.changeDocument(s, uri, model.getVersionId(), changes, () => model.getValue());
        }
      }),
      model.onDidChangeLanguage(() => {
        for (const s of this.client.readyServers()) this.client.closeDocument(s, uri);
        for (const s of this.serversFor(model.getLanguageId())) this.openModel(model, s);
      }),
      model.onWillDispose(() => {
        for (const s of this.client.readyServers()) this.client.closeDocument(s, uri);
        this.modelSubs.get(uri)?.forEach((d) => d.dispose());
        this.modelSubs.delete(uri);
        this.peekModels.delete(uri);
      }),
    ];
    this.modelSubs.set(uri, subs);
    for (const s of this.serversFor(model.getLanguageId())) this.openModel(model, s);
  }

  private openModel(model: Model, server: string): void {
    if (model.isDisposed() || model.uri.scheme !== "file") return;
    const lang = model.getLanguageId();
    if (!languagesOf(server).includes(lang)) return;
    const uri = model.uri.toString();
    this.client.openDocument(server, uri, lspLanguageId(model.uri.path, lang), model.getVersionId(), model.getValue());
  }

  /** A file was written (Ctrl+S): `didSave` for every server that has it open. */
  didSave(path: string): void {
    const model = this.monaco.editor.getModel(this.monaco.Uri.parse(this.uriForPath(path)));
    if (!model) return;
    const uri = model.uri.toString();
    for (const s of this.client.readyServers()) this.client.saveDocument(s, uri, model.getValue());
  }

  /** Make sure Monaco has a model for each location so Peek can show it (unopened files). */
  private async ensureModels(uris: string[]): Promise<void> {
    const wanted = [...new Set(uris.map((u) => this.canonical(u)))].slice(0, 50);
    // Peek models from an earlier lookup that nothing shows any more: let them go.
    const shown = new Set(this.monaco.editor.getEditors().map((e) => e.getModel()?.uri.toString()));
    const tabs = new Set(this.deps.openTabs().map((t) => pathKey(t.path)));
    for (const u of [...this.peekModels]) {
      if (wanted.includes(u) || shown.has(u) || tabs.has(pathKey(this.pathFor(u)))) continue;
      this.monaco.editor.getModel(this.monaco.Uri.parse(u))?.dispose();
      this.peekModels.delete(u);
    }
    await Promise.all(
      wanted.map(async (u) => {
        const uri = this.monaco.Uri.parse(u);
        if (this.monaco.editor.getModel(uri) || uri.scheme !== "file") return;
        const path = this.pathFor(u);
        const tab = this.deps.openTabs().find((t) => t.path === path);
        const text = tab?.content ?? (await this.deps.readFile(path).catch(() => null));
        if (text === null || text === undefined || this.monaco.editor.getModel(uri)) return;
        this.monaco.editor.createModel(text, this.deps.languageFor(path), uri);
        if (!tab) this.peekModels.add(uri.toString());
      })
    );
  }

  // ── Providers ──────────────────────────────────────────────────────────────

  private registerProviders(server: string): void {
    this.providers.get(server)?.forEach((d) => d.dispose());
    const caps = this.client.capabilities(server);
    const langs = languagesOf(server);
    const L = this.monaco.languages;
    const c = this.client;
    const ds: Disposable[] = [];
    const doc = (model: Model) => {
      const uri = model.uri.toString();
      return c.isOpen(server, uri) ? { uri } : null;
    };

    if (caps.completionProvider) {
      const resolve = !!caps.completionProvider.resolveProvider;
      ds.push(
        L.registerCompletionItemProvider(langs, {
          triggerCharacters: caps.completionProvider.triggerCharacters ?? [],
          provideCompletionItems: async (model, position, context, token) => {
            const td = doc(model);
            if (!td) return undefined;
            const word = model.getWordUntilPosition(position);
            const defaultRange = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
            const result = await c.request<LspCompletionItem[] | { items: LspCompletionItem[] }>(server, "textDocument/completion", {
              textDocument: td,
              position: toLspPosition(position),
              context: { triggerKind: context.triggerKind + 1, ...(context.triggerCharacter ? { triggerCharacter: context.triggerCharacter } : {}) },
            }, { token });
            if (!result) return undefined;
            const { suggestions, incomplete } = completionsToMonaco(result, defaultRange, server);
            // Monaco drops an item whose range leaves the cursor's line; fall back to the word.
            for (const s of suggestions) {
              const r = "insert" in s.range ? s.range.replace : s.range;
              if (r.startLineNumber !== position.lineNumber || r.endLineNumber !== position.lineNumber || r.startColumn > position.column) s.range = defaultRange;
            }
            return { suggestions: suggestions as unknown as Monaco.languages.CompletionItem[], incomplete };
          },
          resolveCompletionItem: resolve
            ? async (item, token) => {
                const m = item as unknown as MCompletionItem;
                if (!m.lsp || m.lsp.server !== server) return item;
                const resolved = await c.request<LspCompletionItem>(server, "completionItem/resolve", m.lsp.item, { token });
                return applyResolvedCompletion(m, resolved) as unknown as Monaco.languages.CompletionItem;
              }
            : undefined,
        })
      );
    }

    if (caps.hoverProvider) {
      ds.push(
        L.registerHoverProvider(langs, {
          provideHover: async (model, position, token) => {
            const td = doc(model);
            if (!td) return null;
            return hoverToMonaco(await c.request(server, "textDocument/hover", { textDocument: td, position: toLspPosition(position) }, { token }));
          },
        })
      );
    }

    const locations = async (method: string, model: Model, position: Monaco.Position, token: Monaco.CancellationToken, extra: object = {}) => {
      const td = doc(model);
      if (!td) return null;
      const list = locationsToMonaco(await c.request(server, method, { textDocument: td, position: toLspPosition(position), ...extra }, { token }));
      await this.ensureModels(list.map((l) => l.uri));
      return list.map((l) => ({ uri: this.monaco.Uri.parse(l.uri), range: l.range }));
    };
    if (caps.definitionProvider) {
      ds.push(L.registerDefinitionProvider(langs, { provideDefinition: (m, p, t) => locations("textDocument/definition", m, p, t) }));
    }
    if (caps.referencesProvider) {
      ds.push(
        L.registerReferenceProvider(langs, {
          provideReferences: (m, p, ctx, t) => locations("textDocument/references", m, p, t, { context: { includeDeclaration: ctx.includeDeclaration } }),
        })
      );
    }

    if (caps.renameProvider) {
      const prepare = typeof caps.renameProvider === "object" && !!caps.renameProvider.prepareProvider;
      ds.push(
        L.registerRenameProvider(langs, {
          provideRenameEdits: async (model, position, newName) => {
            const td = doc(model);
            if (!td) return { edits: [], rejectReason: "The language server has not opened this file yet." };
            let edit: LspWorkspaceEdit | null;
            try {
              edit = await c.requestStrict<LspWorkspaceEdit>(server, "textDocument/rename", { textDocument: td, position: toLspPosition(position), newName }, { timeoutMs: 10000 });
            } catch (err) {
              return { edits: [], rejectReason: String((err as Error).message ?? err) };
            }
            if (!edit) return { edits: [], rejectReason: "Nothing to rename here." };
            const r = await this.applyWorkspaceEdit(edit);
            if (r.files > 1) {
              this.deps.toast(
                r.closed
                  ? `Renamed in ${r.files} files (${r.closed} not open were saved; "Language: Undo Rename in Closed Files" reverts them).`
                  : `Renamed in ${r.files} files.`
              );
            }
            return { edits: [] };
          },
          resolveRenameLocation: prepare
            ? async (model, position, token) => {
                const td = doc(model);
                if (!td) return { range: new this.monaco.Range(1, 1, 1, 1), text: "", rejectReason: "Not ready" };
                type Prep = LspRange | { range: LspRange; placeholder: string } | { defaultBehavior: boolean } | null;
                let res: Prep;
                try {
                  res = await c.requestStrict<Prep>(server, "textDocument/prepareRename", { textDocument: td, position: toLspPosition(position) }, { token });
                } catch (err) {
                  return { range: new this.monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column), text: "", rejectReason: String((err as Error).message ?? err) };
                }
                const word = model.getWordAtPosition(position);
                const wordRange = word ? new this.monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn) : null;
                if (!res) return { range: wordRange ?? new this.monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column), text: "", rejectReason: "You cannot rename this element." };
                if ("defaultBehavior" in res) return wordRange ? { range: wordRange, text: word!.word } : { range: new this.monaco.Range(1, 1, 1, 1), text: "", rejectReason: "Nothing to rename here." };
                const range = toMonacoRange("range" in res ? res.range : res);
                return { range, text: "placeholder" in res ? res.placeholder : model.getValueInRange(range) };
              }
            : undefined,
        })
      );
    }

    if (caps.signatureHelpProvider) {
      ds.push(
        L.registerSignatureHelpProvider(langs, {
          signatureHelpTriggerCharacters: caps.signatureHelpProvider.triggerCharacters ?? ["(", ","],
          signatureHelpRetriggerCharacters: caps.signatureHelpProvider.retriggerCharacters ?? [],
          provideSignatureHelp: async (model, position, token, context) => {
            const td = doc(model);
            if (!td) return null;
            const value = signatureHelpToMonaco(
              await c.request(server, "textDocument/signatureHelp", {
                textDocument: td,
                position: toLspPosition(position),
                context: { triggerKind: context.triggerKind, triggerCharacter: context.triggerCharacter, isRetrigger: context.isRetrigger },
              }, { token })
            );
            return value ? { value: value as unknown as Monaco.languages.SignatureHelp, dispose() {} } : null;
          },
        })
      );
    }

    if (caps.codeActionProvider) {
      ds.push(
        L.registerCodeActionProvider(langs, {
          provideCodeActions: async (model, range, context, token) => {
            const td = doc(model);
            if (!td) return { actions: [], dispose() {} };
            const lspRange = toLspRange(range);
            const diagnostics = (this.rawDiagnostics.get(server)?.get(td.uri) ?? []).filter((d) => overlaps(d.range, lspRange));
            const result = await c.request<Array<Record<string, unknown>>>(server, "textDocument/codeAction", {
              textDocument: td,
              range: lspRange,
              context: { diagnostics, ...(context.only ? { only: [context.only] } : {}), triggerKind: context.trigger === 1 ? 1 : 2 },
            }, { token });
            const actions = (result ?? []).filter((a) => !a.disabled).map((a) => ({
              title: String(a.title),
              kind: typeof a.kind === "string" ? a.kind : typeof a.command === "string" ? undefined : "quickfix",
              isPreferred: !!a.isPreferred,
              diagnostics: context.markers.filter((mk) => Array.isArray(a.diagnostics) && (a.diagnostics as LspDiagnostic[]).some((d) => d.range.start.line + 1 === mk.startLineNumber && d.message === mk.message)),
              command: { id: APPLY_CODE_ACTION, title: String(a.title), arguments: [server, a] },
            }));
            return { actions, dispose() {} };
          },
        })
      );
    }

    if (caps.inlayHintProvider) {
      ds.push(
        L.registerInlayHintsProvider(langs, {
          provideInlayHints: async (model, range, token) => {
            const td = doc(model);
            if (!td) return { hints: [], dispose() {} };
            const hints = inlayHintsToMonaco(await c.request(server, "textDocument/inlayHint", { textDocument: td, range: toLspRange(range) }, { token }));
            return { hints: hints as unknown as Monaco.languages.InlayHint[], dispose() {} };
          },
        })
      );
    }

    if (caps.documentHighlightProvider) {
      ds.push(
        L.registerDocumentHighlightProvider(langs, {
          provideDocumentHighlights: async (model, position, token) => {
            const td = doc(model);
            if (!td) return null;
            return highlightsToMonaco(await c.request(server, "textDocument/documentHighlight", { textDocument: td, position: toLspPosition(position) }, { token }));
          },
        })
      );
    }

    this.providers.set(server, ds);
  }

  // ── Code actions and workspace edits ───────────────────────────────────────

  private async runCodeAction(server: string, raw: unknown): Promise<void> {
    let action = raw as { edit?: LspWorkspaceEdit; command?: { command: string; arguments?: unknown[] } | string; arguments?: unknown[]; data?: unknown };
    // A bare Command (no edit): run it on the server.
    if (typeof action.command === "string") {
      await this.client.request(server, "workspace/executeCommand", { command: action.command, arguments: action.arguments ?? [] }, { timeoutMs: 10000 });
      return;
    }
    if (!action.edit && this.client.capabilities(server).codeActionProvider?.resolveProvider) {
      action = (await this.client.request<typeof action>(server, "codeAction/resolve", action, { timeoutMs: 5000 })) ?? action;
    }
    if (action.edit) await this.applyWorkspaceEdit(action.edit);
    const cmd = action.command;
    if (cmd && typeof cmd === "object") {
      await this.client.request(server, "workspace/executeCommand", { command: cmd.command, arguments: cmd.arguments ?? [] }, { timeoutMs: 10000 });
    }
  }

  /**
   * Apply a WorkspaceEdit the way VS Code does, kept undoable:
   *  - a file with a Monaco model: one undo step on that model (Ctrl+Z reverts it);
   *  - an open tab without a model yet: its text in the store changes and it turns dirty;
   *  - a file that is not open: written to disk, its old text kept for
   *    "Language: Undo Rename in Closed Files" (`undoLastClosedEdit`).
   */
  async applyWorkspaceEdit(edit: LspWorkspaceEdit): Promise<{ ok: boolean; files: number; closed: number }> {
    const { edits, ops } = flattenWorkspaceEdit(edit);
    const backups: { path: string; before: string }[] = [];
    let files = 0;
    let ok = true;
    for (const op of ops) {
      try {
        if (op.kind === "create") await this.deps.createFile(this.pathFor(op.uri)).catch((e) => { if (!op.ignoreIfExists && !op.overwrite) throw e; });
      } catch {
        ok = false;
      }
    }
    for (const [uri, list] of edits) {
      if (!list.length) continue;
      files++;
      const path = this.pathFor(uri);
      const tab = this.deps.openTabs().find((t) => t.path === path);
      const model = this.monaco.editor.getModel(this.monaco.Uri.parse(uri));
      try {
        if (model && !model.isDisposed()) {
          model.pushStackElement();
          model.pushEditOperations([], list.map((e) => ({ range: toMonacoRange(e.range), text: e.newText })), () => null);
          model.pushStackElement();
          if (tab) this.deps.setTabContent(path, model.getValue());
          else {
            const before = await this.deps.readFile(path);
            backups.push({ path, before });
            await this.deps.writeFile(path, model.getValue());
          }
        } else if (tab && tab.content !== undefined) {
          this.deps.setTabContent(path, applyTextEdits(tab.content, list));
        } else {
          const before = await this.deps.readFile(path);
          backups.push({ path, before });
          await this.deps.writeFile(path, applyTextEdits(before, list));
        }
      } catch (err) {
        ok = false;
        console.warn("[lsp] could not apply edit to", path, err);
      }
    }
    for (const op of ops) {
      try {
        if (op.kind === "rename") await this.deps.renameFile(this.pathFor(op.oldUri), this.pathFor(op.newUri));
        // Deletes are not applied: no server Fahh starts needs them for a rename or a quick fix.
      } catch {
        ok = false;
      }
    }
    if (backups.length) {
      this.lastClosedEdit = backups;
      const changes = backups.map((b) => ({ uri: this.uriForPath(b.path), type: 2 }));
      for (const s of this.client.readyServers()) this.client.notify(s, "workspace/didChangeWatchedFiles", { changes });
    }
    return { ok, files, closed: backups.length };
  }

  /** Put back the files the last multi-file edit wrote to disk. */
  async undoLastClosedEdit(): Promise<number> {
    const list = this.lastClosedEdit;
    this.lastClosedEdit = [];
    for (const b of list) await this.deps.writeFile(b.path, b.before);
    if (list.length) {
      const changes = list.map((b) => ({ uri: this.uriForPath(b.path), type: 2 }));
      for (const s of this.client.readyServers()) this.client.notify(s, "workspace/didChangeWatchedFiles", { changes });
    }
    return list.length;
  }

  hasClosedEditToUndo(): boolean {
    return this.lastClosedEdit.length > 0;
  }
}

let service: LspService | null = null;
export const getLspService = (): LspService | null => service;
export function setLspService(s: LspService | null): void {
  service = s;
}
