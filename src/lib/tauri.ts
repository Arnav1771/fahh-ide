import { invoke } from "@tauri-apps/api/core";
import type {
  CommandOutput,
  DapConfig,
  Document,
  FahhConfig,
  FileEntry,
  Plugin,
  RunConfig,
  RunResult,
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
