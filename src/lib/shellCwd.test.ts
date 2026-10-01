import { execFileSync } from "child_process";
import { mkdtempSync, mkdirSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { CWD_MARKER, cwdFromLine, promptLabel, splitCwdLine, wrapForCwd } from "./shellCwd";

/** Run a wrapped command the way the backend does (`sh -c`) and report what the terminal would see. */
function runPosix(command: string, cwd: string): { cwd: string | null; out: string[]; code: number } {
  let stdout = "";
  let code = 0;
  try {
    stdout = execFileSync("sh", ["-c", wrapForCwd(command, "posix")], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    const err = e as { status: number; stdout: string };
    code = err.status;
    stdout = err.stdout;
  }
  // The terminal receives one event per line; mimic that, keeping empty lines.
  const lines = stdout.endsWith("\n") ? stdout.slice(0, -1).split("\n") : stdout.split("\n");
  const parts = lines.map(splitCwdLine);
  const marker = parts.map((p) => p.cwd).find((x) => x !== null) ?? null;
  return { cwd: marker, out: parts.map((p) => p.text).filter((x): x is string => x !== null), code };
}

describe("terminal cd", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "fahh-cd-")));
  mkdirSync(join(base, "existing"));

  it.runIf(process.platform !== "win32")("mkdir && cd moves the terminal into the new folder", () => {
    const r = runPosix("mkdir hello && cd hello && echo made", base);
    expect(r.cwd).toBe(join(base, "hello"));
    expect(r.out).toEqual(["made"]);
    expect(r.code).toBe(0);
  });

  it.runIf(process.platform !== "win32")("a command without cd reports the same folder, and keeps its exit code", () => {
    const r = runPosix("ls nope-not-here", base);
    expect(r.cwd).toBe(base);
    expect(r.code).not.toBe(0);
  });

  it.runIf(process.platform !== "win32")("cd .. and cd into an existing folder work; a failed cd stays put", () => {
    expect(runPosix("cd existing", base).cwd).toBe(join(base, "existing"));
    expect(runPosix("cd ..", join(base, "existing")).cwd).toBe(base);
    const bad = runPosix("cd missing-folder", base);
    expect(bad.cwd).toBe(base);
    expect(bad.code).not.toBe(0);
  });

  it("cmd: only a plain cd is tracked", () => {
    expect(wrapForCwd("cd C:\\work", "cmd")).toBe(`cd /d C:\\work && echo ${CWD_MARKER}%CD%`);
    expect(wrapForCwd("cd /d D:\\x", "cmd")).toBe(`cd /d D:\\x && echo ${CWD_MARKER}%CD%`);
    expect(wrapForCwd("dir", "cmd")).toBe("dir");
  });

  it.runIf(process.platform !== "win32")("no blank line is added, and output without a trailing newline is kept", () => {
    expect(runPosix("echo one", base).out).toEqual(["one"]);
    const r = runPosix("printf no-newline", base);
    expect(r.out).toEqual(["no-newline"]);
    expect(r.cwd).toBe(base);
  });

  it("parses marker lines and labels the prompt", () => {
    expect(splitCwdLine(`text${CWD_MARKER}/x`)).toEqual({ text: "text", cwd: "/x" });
    expect(splitCwdLine(`${CWD_MARKER}/x`)).toEqual({ text: null, cwd: "/x" });
    expect(cwdFromLine(`${CWD_MARKER}/home/me/x`)).toBe("/home/me/x");
    expect(cwdFromLine("hello")).toBeNull();
    expect(promptLabel("/home/me/fahh-hello", "/home/me")).toBe("~/fahh-hello");
    expect(promptLabel("/home/me", "/home/me/")).toBe("~");
    expect(promptLabel("/srv/app", "/home/me")).toBe("/srv/app");
    expect(promptLabel("", null)).toBe("~");
  });
});
