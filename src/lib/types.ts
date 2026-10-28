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
  | "solarized-dark"
  | "cate-obsidian"
  /** A colour theme installed from Open VSX (see lib/vscodeTheme). */
  | `ext-${string}`;

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

/** Starts a debug adapter; the protocol itself is driven from src/lib/dap.ts. */
export interface DapConfig {
  /** debugpy, dlv-dap or lldb-dap (aliases: python, go, lldb). */
  adapter: string;
  /** The file or binary being debugged; picks the adapter's working directory. */
  program: string;
  cwd?: string;
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
  /** Non-zero when the value has children (fetch them with a `variables` request). */
  variablesReference: number;
}

/** A raw DAP message from the adapter, as emitted on `dap://event`. */
export interface DapEventPayload {
  session_id: number;
  message: string;
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
  /** Upstream branch (`origin/main`); `null` when the branch is not published. */
  upstream: string | null;
  /** Commits to push. */
  ahead: number;
  /** Commits to pull (as of the last fetch). */
  behind: number;
}

/** One commit in a file's history (Timeline). `time` is in seconds. */
export interface GitCommitInfo {
  oid: string;
  short: string;
  summary: string;
  author: string;
  time: number;
}

// ─── Fahh Local (agent) ───────────────────────────────────────────────────────
// Mirrors src-tauri/src/agent/mod.rs. Events arrive on agent://event as
// { session, event }.

/** ask = Normal, auto-edit = Accept Edits, qa = the one-shot /ask (read-only). */
export type AgentMode = "ask" | "auto-edit" | "smart" | "plan" | "bypass" | "qa";
export type AgentToolKind = "read" | "edit" | "run" | "plan" | "agent";
export type AgentProviderKind = "openai" | "anthropic";

export interface AgentProviderConfig {
  kind: AgentProviderKind;
  base_url: string;
  model: string;
  api_key?: string | null;
}

export interface AgentContext {
  active_file?: string | null;
  selection?: string | null;
  open_files: string[];
  /** Open files with unsaved changes: edits to these always ask. */
  dirty_files: string[];
}

export type AgentRunSpec =
  | { kind: "turn" }
  | { kind: "loop"; max_rounds?: number | null }
  | { kind: "btw" }
  | { kind: "agent"; name: string };

export interface AgentLimits {
  max_parallel?: number;
  turn_steps?: number;
  turn_tokens?: number;
}

export interface AgentStartParams {
  session?: string | null;
  workspace: string;
  prompt: string;
  mode: AgentMode;
  provider: AgentProviderConfig;
  /** The fast model for Smart mode's judge; the main model if absent. */
  judge?: AgentProviderConfig | null;
  context: AgentContext;
  run?: AgentRunSpec;
  limits?: AgentLimits | null;
  /** Extra folders from /add-dir. */
  extra_dirs?: string[];
}

/** The conversation, exactly as the backend keeps it (src-tauri/src/agent/provider.rs `Msg`). */
export type AgentMsg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; calls: { id: string; name: string; args: Record<string, unknown> }[] }
  | { role: "tool_result"; id: string; name: string; content: string };

export interface AgentTurnRec {
  id: number;
  prompt: string;
  hist_start: number | null;
  mode: AgentMode;
  at: number;
}

export interface AgentSessionInfo {
  id: string;
  title: string;
  updated: number;
  steps: number;
}

export interface AgentLoaded {
  session: string;
  title: string;
  history: AgentMsg[];
  turns: AgentTurnRec[];
}

export interface AgentRevertResult {
  files: string[];
  rewound: boolean;
  loaded: AgentLoaded;
}

export interface AgentContextInfo {
  used: number;
  window: number;
  percent: number;
  messages: number;
}

export interface AgentUsage {
  model_calls: number;
  tool_calls: number;
  tokens_in: number;
  tokens_out: number;
}

export interface AgentInfo {
  name: string;
  description: string;
  model: string | null;
  mode: AgentMode;
  source: string;
  max_steps: number;
}

export interface AgentsReport {
  agents: AgentInfo[];
  problems: string[];
}

export interface AgentStartResult {
  session: string;
  turn: number;
}

export interface AgentDecision {
  allow: boolean;
  always?: boolean;
  /** The (possibly edited) command, for run_command approvals. */
  command?: string | null;
}

export interface AgentFileDiff {
  path: string;
  before: string | null;
  after: string | null;
}

export interface AgentDiagFile {
  path: string;
  items: { line: number; severity: string; message: string }[];
}

export type AgentEvent =
  | { type: "turn_started"; turn: number }
  | { type: "text_delta"; turn: number; text: string }
  | { type: "tool_call"; turn: number; id: string; name: string; args: Record<string, unknown>; kind: AgentToolKind }
  | {
      type: "approval_request";
      turn: number;
      id: string;
      tool: string;
      kind: AgentToolKind;
      summary: string;
      command: string | null;
      path: string | null;
      old_text: string | null;
      new_text: string | null;
    }
  | { type: "tool_result"; turn: number; id: string; ok: boolean; output: string; elapsed_ms?: number }
  | { type: "file_changed"; turn: number; path: string }
  | { type: "plan_written"; turn: number; id: string; path: string; markdown: string }
  | { type: "judge"; turn: number; command: string; safe: boolean; reason: string }
  | { type: "sub_started"; turn: number; child: string; name: string; task: string; model: string | null; mode: AgentMode }
  | { type: "sub"; turn: number; child: string; name: string; event: AgentEvent }
  | { type: "sub_done"; turn: number; child: string; name: string; ok: boolean; steps: number; summary: string }
  | { type: "loop_round"; turn: number; round: number; max: number; approved: boolean; notes: string }
  | { type: "notice"; turn: number; text: string }
  | { type: "compacted"; turn: number; before: number; after: number }
  | { type: "done"; turn: number; steps: number; files: string[] }
  | { type: "error"; turn: number; message: string };

export interface AgentEnvelope {
  session: string;
  event: AgentEvent;
}

// ─── `fahh <path>` command line (src-tauri/src/app/cli.rs) ────────────────────

export interface OpenRequest {
  /** Absolute, already resolved against the caller's working directory. */
  path: string;
  /** 1-based, from `fahh file:line`; only for files. */
  line: number | null;
  kind: "dir" | "file" | "missing";
}

// ─── Workspace Search & Replace ──────────────────────────────────────────────

export interface SearchMatch {
  file: string;
  line_number: number;
  line_text: string;
  match_start: number;
  match_end: number;
}

export interface SearchResult {
  query: string;
  total_matches: number;
  files_searched: number;
  matches: SearchMatch[];
}

export interface ReplaceResult {
  files_modified: number;
  total_replacements: number;
}

