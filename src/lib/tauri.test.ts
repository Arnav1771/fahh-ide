import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Tauri IPC boundary — these tests are about the argument shapes the
// wrappers send, which must match the Rust command signatures exactly. A
// renamed parameter here is a silent runtime failure in the real app.
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import * as tauri from "./tauri";

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe("file-system wrappers", () => {
  it("passes the root through to get_file_tree", async () => {
    await tauri.getFileTree("/home/dell/proj");
    expect(invoke).toHaveBeenCalledWith("get_file_tree", {
      root: "/home/dell/proj",
    });
  });

  it("sends path and content to write_file", async () => {
    await tauri.writeFile("/a.ts", "const a = 1;");
    expect(invoke).toHaveBeenCalledWith("write_file", {
      path: "/a.ts",
      content: "const a = 1;",
    });
  });

  it("uses from/to for rename_file", async () => {
    await tauri.renameFile("/a.ts", "/b.ts");
    expect(invoke).toHaveBeenCalledWith("rename_file", {
      from: "/a.ts",
      to: "/b.ts",
    });
  });

  it("resolves with whatever the backend returned", async () => {
    invoke.mockResolvedValue("file contents");
    await expect(tauri.readFile("/a.ts")).resolves.toBe("file contents");
  });
});

describe("execute_command", () => {
  it("defaults args to an empty array so the Rust side never sees null", async () => {
    await tauri.executeCommand("ls");
    expect(invoke).toHaveBeenCalledWith("execute_command", {
      command: "ls",
      args: [],
      cwd: undefined,
    });
  });

  it("forwards args and cwd when given", async () => {
    await tauri.executeCommand("git", ["status"], "/repo");
    expect(invoke).toHaveBeenCalledWith("execute_command", {
      command: "git",
      args: ["status"],
      cwd: "/repo",
    });
  });
});

describe("LSP wrappers", () => {
  it("names the language and workspace for lsp_start", async () => {
    await tauri.lspStart("python", "/repo");
    expect(invoke).toHaveBeenCalledWith("lsp_start", {
      language: "python",
      workspace: "/repo",
    });
  });

  it("sends the raw JSON-RPC string for lsp_send", async () => {
    await tauri.lspSend("python", '{"jsonrpc":"2.0"}');
    expect(invoke).toHaveBeenCalledWith("lsp_send", {
      language: "python",
      message: '{"jsonrpc":"2.0"}',
    });
  });
});

describe("debugger wrappers", () => {
  it("uses camelCase sessionId, which Tauri maps to session_id", async () => {
    await tauri.debugContinue(7);
    expect(invoke).toHaveBeenCalledWith("debug_continue", { sessionId: 7 });
  });

  it("sends breakpoint lines as an array", async () => {
    await tauri.debugSetBreakpoints(1, "/a.py", [3, 9]);
    expect(invoke).toHaveBeenCalledWith("debug_set_breakpoints", {
      sessionId: 1,
      file: "/a.py",
      lines: [3, 9],
    });
  });
});

describe("git wrappers", () => {
  it("calls git_status with the workspace path", async () => {
    invoke.mockResolvedValue({
      is_repo: true,
      repo_root: "/repo",
      branch: "main",
      unborn: false,
      staged: [],
      unstaged: [],
    });

    const status = await tauri.gitStatus("/repo");

    expect(invoke).toHaveBeenCalledWith("git_status", { path: "/repo" });
    expect(status.branch).toBe("main");
  });

  it("calls git_current_branch and tolerates a null branch", async () => {
    invoke.mockResolvedValue(null);
    await expect(tauri.gitCurrentBranch("/repo")).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith("git_current_branch", {
      path: "/repo",
    });
  });

  it("stages and unstages a repo-relative file", async () => {
    await tauri.gitStage("/repo", "src/a.ts");
    expect(invoke).toHaveBeenCalledWith("git_stage", {
      path: "/repo",
      file: "src/a.ts",
    });

    await tauri.gitUnstage("/repo", "src/a.ts");
    expect(invoke).toHaveBeenCalledWith("git_unstage", {
      path: "/repo",
      file: "src/a.ts",
    });
  });

  it("returns the new oid from git_commit", async () => {
    invoke.mockResolvedValue("9f1c0ddeadbeef");
    await expect(tauri.gitCommit("/repo", "fix: thing")).resolves.toBe(
      "9f1c0ddeadbeef"
    );
    expect(invoke).toHaveBeenCalledWith("git_commit", {
      path: "/repo",
      message: "fix: thing",
    });
  });

  it("passes the staged flag through to git_diff", async () => {
    invoke.mockResolvedValue("@@ -1 +1 @@");
    await tauri.gitDiff("/repo", "a.ts", true);
    expect(invoke).toHaveBeenCalledWith("git_diff", {
      path: "/repo",
      file: "a.ts",
      staged: true,
    });
  });

  it("propagates a rejection instead of swallowing it", async () => {
    invoke.mockRejectedValue("not a git repository");
    await expect(tauri.gitStatus("/tmp")).rejects.toBe("not a git repository");
  });
});
