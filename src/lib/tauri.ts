import { invoke } from "@tauri-apps/api/core";
import type {
  CommandOutput,
  DapConfig,
  Document,
  FahhConfig,
  FileEntry,
  GitStatus,
  OpenRequest,
  Plugin,
  ReplaceResult,
  RunConfig,
  RunResult,
  SearchResult,
  ToolStatus,
} from "./types";

// ─── File system ──────────────────────────────────────────────────────────────

export const getFileTree = (root: string) =>
  invoke<FileEntry>("get_file_tree", { root });

export const readFile = (path: string) =>
  invoke<string>("read_file", { path });

export const writeFile = (path: string, content: string) =>
  invoke<void>("write_file", { path, content });

export const createFile = (path: string) =>
  invoke<void>("create_file", { path });

export const deleteFile = (path: string) =>
  invoke<void>("delete_file", { path });

export const renameFile = (from: string, to: string) =>
  invoke<void>("rename_file", { from, to });

export interface SearchWorkspaceOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  isRegex?: boolean;
  includeGlob?: string;
  excludeGlob?: string;
  maxResults?: number;
}

export const searchWorkspace = async (
  root: string,
  query: string,
  options: SearchWorkspaceOptions = {}
): Promise<SearchResult> => {
  try {
    return await invoke<SearchResult>("search_workspace", {
      root,
      query,
      caseSensitive: options.caseSensitive ?? false,
      wholeWord: options.wholeWord ?? false,
      isRegex: options.isRegex ?? false,
      includeGlob: options.includeGlob ?? null,
      excludeGlob: options.excludeGlob ?? null,
      maxResults: options.maxResults ?? 1000,
    });
  } catch {
    // Browser preview fallback: search currently loaded fileContents in memory
    const { useEditorStore } = await import("../store/editorStore");
    const contents = useEditorStore.getState().fileContents;
    const matches: SearchResult["matches"] = [];
    const isCase = !!options.caseSensitive;
    const isWord = !!options.wholeWord;
    const isReg = !!options.isRegex;

    let regex: RegExp;
    try {
      let pat = isReg ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (isWord) pat = `\\b${pat}\\b`;
      regex = new RegExp(pat, isCase ? "g" : "gi");
    } catch {
      return { query, total_matches: 0, files_searched: 0, matches: [] };
    }

    let filesSearched = 0;
    for (const [file, text] of Object.entries(contents)) {
      filesSearched++;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let m: RegExpExecArray | null;
        regex.lastIndex = 0;
        while ((m = regex.exec(line)) !== null) {
          matches.push({
            file,
            line_number: i + 1,
            line_text: line,
            match_start: m.index,
            match_end: m.index + m[0].length,
          });
          if (!regex.global) break;
        }
      }
    }
    return {
      query,
      total_matches: matches.length,
      files_searched: filesSearched,
      matches,
    };
  }
};

export const replaceInWorkspace = async (
  root: string,
  query: string,
  replacement: string,
  options: SearchWorkspaceOptions & { files?: string[] } = {}
): Promise<ReplaceResult> => {
  try {
    return await invoke<ReplaceResult>("replace_in_workspace", {
      root,
      query,
      replacement,
      caseSensitive: options.caseSensitive ?? false,
      wholeWord: options.wholeWord ?? false,
      isRegex: options.isRegex ?? false,
      includeGlob: options.includeGlob ?? null,
      excludeGlob: options.excludeGlob ?? null,
      files: options.files ?? null,
    });
  } catch {
    // In-memory fallback
    const { useEditorStore } = await import("../store/editorStore");
    const { fileContents, setContent } = useEditorStore.getState();
    let pat = options.isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (options.wholeWord) pat = `\\b${pat}\\b`;
    const regex = new RegExp(pat, options.caseSensitive ? "g" : "gi");
    let filesModified = 0;
    let totalReplacements = 0;
    for (const [path, content] of Object.entries(fileContents)) {
      if (options.files && !options.files.includes(path)) continue;
      const count = (content.match(regex) || []).length;
      if (count > 0) {
        setContent(path, content.replace(regex, replacement));
        filesModified++;
        totalReplacements += count;
      }
    }
    return { files_modified: filesModified, total_replacements: totalReplacements };
  }
};

// ─── Document / editor ────────────────────────────────────────────────────────

export const openDocument = (path: string) =>
  invoke<Document>("open_document", { path });

export const closeDocument = (path: string) =>
  invoke<void>("close_document", { path });

export const getOpenDocuments = () =>
  invoke<Document[]>("get_open_documents");

// ─── Terminal / command ───────────────────────────────────────────────────────

export const executeCommand = (
  command: string,
  args: string[] = [],
  cwd?: string
) => invoke<CommandOutput>("execute_command", { command, args, cwd });

export const launchAgyTerminal = (cwd?: string, args?: string[]) =>
  invoke<string>("launch_agy_terminal", { cwd, args });

export const writeStdin = (pid: number, data: string) =>
  invoke<void>("write_stdin", { pid, data });

// ─── Installer / tools ────────────────────────────────────────────────────────

export const getToolStatus = () => invoke<ToolStatus[]>("get_tool_status");

export const installTool = (toolName: string) =>
  invoke<void>("install_tool", { toolName });

// ─── Config ───────────────────────────────────────────────────────────────────

export const loadConfig = () => invoke<FahhConfig>("load_config");

export const saveConfig = (config: FahhConfig) =>
  invoke<void>("save_config", { config });

// ─── Phase 2: Run panel ───────────────────────────────────────────────────────

/** Spawn a child process to run the given file. Returns pid + result metadata. */
export const runFile = (config: RunConfig) =>
  invoke<RunResult>("run_file", { config });

/** Send SIGTERM / TerminateProcess to the given pid. */
export const stopRun = (pid: number) =>
  invoke<void>("stop_run", { pid });

// ─── Phase 2: LSP bridge ──────────────────────────────────────────────────────

/** Start the language server for the given language in the given workspace. */
export const lspStart = (language: string, workspace: string) =>
  invoke<void>("lsp_start", { language, workspace });

/** Forward a raw JSON-RPC message to the running language server. */
export const lspSend = (language: string, message: string) =>
  invoke<void>("lsp_send", { language, message });

/** Shut down the language server for the given language. */
export const lspStop = (language: string) =>
  invoke<void>("lsp_stop", { language });

/** Ask the backend to format a file and return the formatted text. */
export const formatFile = (path: string, language: string) =>
  invoke<string>("format_file", { path, language });

// ─── Phase 2: DAP debugger ────────────────────────────────────────────────────

/** Launch a debug session. Returns the session id. */
export const debugStart = (config: DapConfig) =>
  invoke<number>("debug_start", { config });

/** Resume execution in the given debug session. */
export const debugContinue = (sessionId: number) =>
  invoke<void>("debug_continue", { sessionId });

/** Step over the current statement. */
export const debugStepOver = (sessionId: number) =>
  invoke<void>("debug_step_over", { sessionId });

/** Step into the current call. */
export const debugStepIn = (sessionId: number) =>
  invoke<void>("debug_step_in", { sessionId });

/** Terminate the debug session. */
export const debugStop = (sessionId: number) =>
  invoke<void>("debug_stop", { sessionId });

/** Set breakpoints for a file (replaces all previous breakpoints in that file). */
export const debugSetBreakpoints = (
  sessionId: number,
  file: string,
  lines: number[]
) => invoke<void>("debug_set_breakpoints", { sessionId, file, lines });

// ─── Phase 2: Plugins ─────────────────────────────────────────────────────────

/** List all registered plugins (themes, language packs, formatters, …). */
export const getPlugins = () => invoke<Plugin[]>("get_plugins");

/** List only theme plugins. */
export const getThemes = () => invoke<Plugin[]>("get_themes");

// ─── Git / source control ─────────────────────────────────────────────────────
//
// `path` is any path inside the working tree — the backend runs
// `Repository::discover` on it, so the workspace root is fine.

/**
 * Full status snapshot. A folder that is not a repository resolves normally
 * with `is_repo: false`; only real failures reject.
 */
export const gitStatus = (path: string) =>
  invoke<GitStatus>("git_status", { path });

/** Short branch name, or `null` on a detached HEAD or outside a repo. */
export const gitCurrentBranch = (path: string) =>
  invoke<string | null>("git_current_branch", { path });

/** Stage one file (`git add <file>`). `file` is repo-relative. */
export const gitStage = (path: string, file: string) =>
  invoke<void>("git_stage", { path, file });

/** Unstage one file (`git restore --staged <file>`). */
export const gitUnstage = (path: string, file: string) =>
  invoke<void>("git_unstage", { path, file });

/** Commit whatever is staged. Resolves with the new commit's oid. */
export const gitCommit = (path: string, message: string) =>
  invoke<string>("git_commit", { path, message });

/**
 * Unified diff for one file. `staged: true` diffs HEAD against the index,
 * `false` diffs the index against the working tree.
 */
export const gitDiff = (path: string, file: string, staged: boolean) =>
  invoke<string>("git_diff", { path, file, staged });

// ─── Previews ─────────────────────────────────────────────────────────────────

/** Let the previews load files from this folder (or this file's folder) through the asset protocol. */
export const allowPreview = (path: string) =>
  invoke<string>("allow_preview", { path });

// ─── `fahh` command ───────────────────────────────────────────────────────────

/** The path from launch (`fahh .`), once; null when started normally. */
export const takePendingOpen = () => invoke<OpenRequest | null>("take_pending_open");

/** Open a fresh Fahh window, optionally with a target path. */
export const openNewWindow = (path?: string) =>
  invoke<string>("open_new_window", { path: path ?? null }).catch(() => null);

/** macOS / AppImage: put a `fahh` command on the PATH. Resolves to a message to show. */
export const installCli = () => invoke<string>("install_cli");

// ─── Window controls ──────────────────────────────────────────────────────────

export const minimizeWindow = async () => {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  } catch {}
};

export const toggleMaximizeWindow = async () => {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().toggleMaximize();
  } catch {}
};

export const isWindowMaximized = async (): Promise<boolean> => {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return await getCurrentWindow().isMaximized();
  } catch {
    return false;
  }
};

export const closeWindow = async () => {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  } catch {}
};
