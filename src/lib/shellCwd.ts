/**
 * The terminal runs every command in a fresh shell, so a `cd` used to be
 * forgotten as soon as the command finished: `mkdir hello && cd hello`, then
 * `git init`, initialised the *old* folder. VS Code's terminal is one
 * long-lived shell; this gets the same result without one: after the user's
 * command, the shell prints the folder it ended up in behind a marker, the
 * terminal moves there and hides the line. The command's own exit code is kept.
 */

import { parseWslPath } from "./wslPath";

export const CWD_MARKER = "__FAHH_CWD__:";

export type ShellKind = "posix" | "cmd" | "powershell" | "wsl";

/** The backend runs commands with `cmd /C` on Windows and `sh -c` elsewhere. */
export function detectShell(userAgent?: string): ShellKind {
  const ua = userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return /Windows/i.test(ua) ? "cmd" : "posix";
}

/** The name shown in the terminal header. */
export const shellName = (kind: ShellKind): string => (kind === "posix" ? "sh" : kind);

/**
 * The shell a tab really runs. A tab opened from the "+ Shell" menu keeps its choice;
 * a plain tab ("auto") uses WSL for a folder inside WSL and cmd for any other Windows folder.
 */
export function effectiveShell(sessionShell: string, cwd: string, platform: ShellKind = detectShell()): ShellKind {
  if (platform === "posix") return "posix";
  const s = sessionShell.toLowerCase();
  if (s === "powershell" || s === "pwsh") return "powershell";
  if (s === "bash" || s === "wsl") return "wsl";
  if (s === "cmd") return "cmd";
  return parseWslPath(cwd) ? "wsl" : "cmd";
}

/** UNC folders (\\server\share, \\wsl.localhost\...), which cmd cannot start in. */
export const isUncPath = (p: string): boolean => p.startsWith("\\\\") || p.startsWith("//");

/** The command to hand the backend (which runs it with `sh -c` / `cmd /C`). */
export function wrapForCwd(command: string, shell: ShellKind, cwd = ""): string {
  if (shell === "powershell") {
    return `${command}; $__fahh = if ($LASTEXITCODE) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }; Write-Output ("${CWD_MARKER}" + (Get-Location).ProviderPath); exit $__fahh`;
  }
  if (shell === "cmd") {
    // In a UNC folder the backend pushd-es to a temporary drive letter, so %CD% would
    // report that drive: the terminal resolves `cd` itself there (see useTerminal).
    if (isUncPath(cwd)) return command;
    // cmd has no clean way to keep the exit code across `&`; track only a
    // plain `cd <dir>` (or `cd /d <dir>`), which is what people type.
    const m = /^\s*cd(?:\s+\/d)?\s+(.+?)\s*$/i.exec(command);
    return m ? `cd /d ${m[1]} && echo ${CWD_MARKER}%CD%` : command;
  }
  return `${command}\n__fahh_status=$?; printf '${CWD_MARKER}%s\\n' "$PWD"; exit $__fahh_status`;
}

/** The folder a marker line reports, or null for ordinary output. */
export function cwdFromLine(line: string): string | null {
  return splitCwdLine(line).cwd;
}

/**
 * Split a line of output into what to show and the folder it reports. The
 * marker follows the command's output directly, so when that output does not
 * end in a newline both share a line: the text before the marker is kept.
 */
export function splitCwdLine(line: string): { text: string | null; cwd: string | null } {
  const i = line.indexOf(CWD_MARKER);
  if (i === -1) return { text: line, cwd: null };
  const dir = line.slice(i + CWD_MARKER.length).trim();
  const before = line.slice(0, i);
  return { text: before.length ? before : null, cwd: dir || null };
}

/** The prompt shows where you are: "~/fahh-hello", or the folder's name. */
export function promptLabel(cwd: string, home: string | null): string {
  if (!cwd) return "~";
  const h = home?.replace(/[\\/]+$/, "");
  if (h && (cwd === h || cwd.startsWith(h + "/") || cwd.startsWith(h + "\\"))) return "~" + cwd.slice(h.length).replace(/\\/g, "/");
  return cwd;
}
