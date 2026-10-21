import { describe, expect, it } from "vitest";
import { parseJsonc, uriToPath, workspaceFolders } from "./codeWorkspace";

describe("parseJsonc", () => {
  it("reads VS Code's workspace JSON with comments and trailing commas", () => {
    const text = `{
      // saved by VS Code
      "folders": [ { "path": ".." }, /* second */ { "path": "C:\\\\other" }, ],
      "settings": { "files.autoSave": "afterDelay", },
    }`;
    expect(parseJsonc(text)).toEqual({
      folders: [{ path: ".." }, { path: "C:\\other" }],
      settings: { "files.autoSave": "afterDelay" },
    });
  });

  it("leaves comment-like text and commas inside strings alone", () => {
    expect(parseJsonc(`{"url": "http://x//y", "s": "a,]", "q": "say \\"//hi\\""}`)).toEqual({
      url: "http://x//y",
      s: "a,]",
      q: 'say "//hi"',
    });
  });
});

describe("uriToPath", () => {
  it("maps WSL remote folders to the Windows path of the distro", () => {
    expect(uriToPath("vscode-remote://wsl+ubuntu/home/dell/proj")).toBe("\\\\wsl.localhost\\ubuntu\\home\\dell\\proj");
    expect(uriToPath("vscode-remote://wsl%2BUbuntu-22.04/home/a%20b")).toBe("\\\\wsl.localhost\\Ubuntu-22.04\\home\\a b");
  });

  it("maps file URIs and refuses other remotes", () => {
    expect(uriToPath("file:///c%3A/Users/me/proj")).toBe("c:\\Users\\me\\proj");
    expect(uriToPath("file:///home/me/proj")).toBe("/home/me/proj");
    expect(uriToPath("vscode-remote://ssh-remote+box/srv/app")).toBeNull();
  });
});

describe("workspaceFolders", () => {
  it("resolves relative folders against the workspace file", () => {
    const parsed = { folders: [{ path: ".." }, { path: "libs/core" }, { path: "D:\\abs" }] };
    expect(workspaceFolders(parsed, "C:\\work\\app\\team.code-workspace")).toEqual(["C:\\work", "C:\\work\\app\\libs\\core", "D:\\abs"]);
  });

  it("works for WSL workspace files and uri folders", () => {
    const parsed = { folders: [{ path: "." }, { uri: "vscode-remote://wsl+Ubuntu/srv/x" }] };
    expect(workspaceFolders(parsed, "\\\\wsl.localhost\\Ubuntu\\home\\me\\proj\\p.code-workspace")).toEqual([
      "\\\\wsl.localhost\\Ubuntu\\home\\me\\proj",
      "\\\\wsl.localhost\\Ubuntu\\srv\\x",
    ]);
  });

  it("keeps Fahh's own root first and skips duplicates", () => {
    expect(workspaceFolders({ root: "C:/p", folders: [{ path: "C:/p" }] })).toEqual(["C:/p"]);
    expect(workspaceFolders({})).toEqual([]);
  });
});
