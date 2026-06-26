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
