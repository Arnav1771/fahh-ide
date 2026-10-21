/**
 * Folders inside WSL as Windows sees them: \\wsl.localhost\<distro>\home\... (or \\wsl$\...).
 * Mirrors src-tauri/src/core/wsl.rs: the backend runs commands for these folders inside
 * the distro, and the terminal translates the Linux folder it reports back.
 */
export interface WslPath {
  distro: string;
  /** Absolute Linux path, e.g. /home/dell/proj */
  linux: string;
}

export function parseWslPath(path: string): WslPath | null {
  let p = path.replace(/\//g, "\\");
  if (p.toUpperCase().startsWith("\\\\?\\UNC\\")) p = "\\\\" + p.slice(8);
  const m = /^\\\\(wsl\.localhost|wsl\$)\\([^\\]+)(\\.*)?$/i.exec(p);
  if (!m) return null;
  const segs = (m[3] ?? "").split("\\").filter(Boolean);
  return { distro: m[2], linux: "/" + segs.join("/") };
}

export function toWslUnc(distro: string, linux: string): string {
  const tail = linux.replace(/^\/+/, "").replace(/\//g, "\\");
  return tail ? `\\\\wsl.localhost\\${distro}\\${tail}` : `\\\\wsl.localhost\\${distro}`;
}

/**
 * The Windows spelling of a Linux folder reported by a WSL shell: /mnt/c/x -> C:\x,
 * /home/x -> \\wsl.localhost\<distro>\home\x (distro taken from the folder the shell
 * started in). Null when it cannot be known.
 */
export function linuxToWindows(linux: string, startedIn: string): string | null {
  const mnt = /^\/mnt\/([a-z])(?:\/(.*))?$/i.exec(linux);
  if (mnt) return `${mnt[1].toUpperCase()}:\\${(mnt[2] ?? "").replace(/\//g, "\\")}`;
  const from = parseWslPath(startedIn);
  return from ? toWslUnc(from.distro, linux) : null;
}
