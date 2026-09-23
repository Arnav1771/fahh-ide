export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
}

export interface Document {
  path: string;
  language: string;
  dirty: boolean;
}

export interface CommandOutput {
  id: number;
  stdout: string;
  stderr: string;
  exit_code: number | null;
}

export interface ToolStatus {
  tool: string;
  installed: boolean;
  version: string | null;
}

export interface FahhConfig {
  sfx_cooldown_secs?: number;
  last_workspace?: string;
  installed_tools: string[];
  theme?: string;
}

export interface TerminalOutputEvent {
  stdout: string;
  stderr: string;
  exit_code: number | null;
}

export interface InstallerProgressEvent {
  tool: string;
  status: "starting" | "done" | "error";
  message: string;
}

// ─── Phase 2 types ────────────────────────────────────────────────────────────

export type ThemeId =
  | "fahh-gold"
  | "fahh-dark"
  | "fahh-light"
  | "github-dark"
  | "dracula"
  | "solarized-dark";

export interface RunConfig {
  /** Absolute path to the file to execute */
  path: string;
  language: string;
  /** Optional extra arguments forwarded to the interpreter */
  args?: string[];
  /** Working directory; defaults to the file's parent */
  cwd?: string;
  /** Environment variable overrides */
  env?: Record<string, string>;
}

export interface RunResult {
  pid: number;
  exit_code: number | null;
  /** Milliseconds the process ran */
  duration_ms: number;
}

export interface RunOutputEvent {
  pid: number;
  line: string;
  stream: "stdout" | "stderr" | "info";
}

export interface DapConfig {
  /** DAP adapter executable */
  adapter: string;
  adapter_args?: string[];
  language: string;
  /** Absolute path to the program to debug */
  program: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stop_on_entry?: boolean;
}

export interface StackFrame {
  id: number;
  name: string;
  file: string;
  line: number;
  column: number;
}

export interface Variable {
  name: string;
  value: string;
  type: string | null;
  variablesReference: number;
}

export interface DebugEvent {
  session_id: number;
  event: "stopped" | "continued" | "exited" | "output" | "breakpoint";
  body: Record<string, unknown>;
}

export type PluginKind =
  | "theme"
  | "language"
  | "formatter"
  | "linter"
  | "builtin";

export interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  kind: PluginKind;
  author: string;
  /** File extensions supported (language packs) */
  extensions?: string[];
  /** CLI command used by formatter plugins */
  command?: string;
  /** Whether the plugin ships with the editor and cannot be removed */
  builtin: boolean;
  /** Monaco theme id (theme plugins) */
  monaco_theme?: string;
}

export interface LspMessage {
  language: string;
  /** Raw JSON-RPC payload */
  payload: string;
}

// ─── Git / source control ─────────────────────────────────────────────────────

export type GitChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "typechange"
  | "untracked"
  | "conflicted";

export interface GitFileChange {
  /** Path relative to the repository root, forward-slashed. */
  path: string;
  status: GitChangeStatus;
  /** `true` for index entries, `false` for working-tree entries. */
  staged: boolean;
}

export interface GitStatus {
  /** `false` when the open folder simply is not a repo — not an error. */
  is_repo: boolean;
  /** Absolute work-tree root; empty string when `is_repo` is false. */
  repo_root: string;
  /** Short branch name; `null` on a detached HEAD. */
  branch: string | null;
  /** `true` before the first commit exists. */
  unborn: boolean;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
}
