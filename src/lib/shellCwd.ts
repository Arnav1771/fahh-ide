/**
 * The terminal runs every command in a fresh shell, so a `cd` used to be
 * forgotten as soon as the command finished: `mkdir hello && cd hello`, then
 * `git init`, initialised the *old* folder. VS Code's terminal is one
 * long-lived shell; this gets the same result without one: after the user's
 * command, the shell prints the folder it ended up in behind a marker, the
 * terminal moves there and hides the line. The command's own exit code is kept.
 */

export const CWD_MARKER = "__FAHH_CWD__:";

export type ShellKind = "posix" | "cmd";

/** The command to hand the backend (which runs it with `sh -c` / `cmd /C`). */
export function wrapForCwd(command: string, shell: ShellKind): string {
  if (shell === "cmd") {
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
