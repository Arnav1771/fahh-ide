import { invoke } from "@tauri-apps/api/core";
import type {
  CommandOutput,
  Document,
  FahhConfig,
  FileEntry,
  ToolStatus,
} from "./types";

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

export const openDocument = (path: string) =>
  invoke<Document>("open_document", { path });

export const closeDocument = (path: string) =>
  invoke<void>("close_document", { path });

export const getOpenDocuments = () =>
  invoke<Document[]>("get_open_documents");

export const executeCommand = (
  command: string,
  args: string[] = [],
  cwd?: string
) => invoke<CommandOutput>("execute_command", { command, args, cwd });

export const writeStdin = (pid: number, data: string) =>
  invoke<void>("write_stdin", { pid, data });

export const getToolStatus = () => invoke<ToolStatus[]>("get_tool_status");

export const installTool = (toolName: string) =>
  invoke<void>("install_tool", { toolName });

export const loadConfig = () => invoke<FahhConfig>("load_config");

export const saveConfig = (config: FahhConfig) =>
  invoke<void>("save_config", { config });
