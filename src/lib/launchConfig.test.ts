import { describe, it, expect } from "vitest";
import {
  adapterFor,
  defaultConfigFor,
  launchArguments,
  launchJsonTemplate,
  parseJsonc,
  readConfigurations,
  substitute,
} from "./launchConfig";

describe("launch.json parsing", () => {
  it("accepts comments and trailing commas but keeps // inside strings", () => {
    const text = `{
      // a comment
      "version": "0.2.0", /* block */
      "configurations": [
        { "name": "Py", "type": "debugpy", "request": "launch", "url": "http://x//y", },
      ],
    }`;
    expect(parseJsonc(text)).toEqual({
      version: "0.2.0",
      configurations: [{ name: "Py", type: "debugpy", request: "launch", url: "http://x//y" }],
    });
  });

  it("reads configurations and drops broken entries", () => {
    const text = JSON.stringify({ configurations: [{ name: "A", type: "go", request: "launch" }, { type: "go" }, 3] });
    expect(readConfigurations(text).map((c) => c.name)).toEqual(["A"]);
    expect(readConfigurations("{ not json")).toEqual([]);
    expect(readConfigurations("{}")).toEqual([]);
  });

  it("the template it writes parses back to the default config", () => {
    const cfgs = readConfigurations(launchJsonTemplate("python"));
    expect(cfgs).toHaveLength(1);
    expect(cfgs[0]).toEqual(defaultConfigFor("python"));
  });
});

describe("variables", () => {
  const ctx = { file: "C:\\proj\\src\\app.py", workspaceFolder: "C:\\proj" };

  it("replaces VS Code variables, deeply", () => {
    const out = substitute(
      { program: "${file}", cwd: "${fileDirname}", args: ["${fileBasenameNoExtension}", "${relativeFile}"], env: { ROOT: "${workspaceFolder}" } },
      ctx
    );
    expect(out).toEqual({
      program: "C:\\proj\\src\\app.py",
      cwd: "C:\\proj\\src",
      args: ["app", "src\\app.py"],
      env: { ROOT: "C:\\proj" },
    });
  });

  it("leaves unknown variables alone", () => {
    expect(substitute("${env:HOME}/${nope}", ctx)).toBe("${env:HOME}/${nope}");
  });

  it("knows the folder name", () => {
    expect(substitute("${workspaceFolder}/target/debug/${workspaceFolderBasename}", { file: "/w/me/src/main.rs", workspaceFolder: "/w/me" })).toBe(
      "/w/me/target/debug/me"
    );
  });
});

describe("adapters and launch arguments", () => {
  it("maps launch.json types to adapters", () => {
    expect(adapterFor("python")).toBe("debugpy");
    expect(adapterFor("debugpy")).toBe("debugpy");
    expect(adapterFor("go")).toBe("dlv-dap");
    expect(adapterFor("cppdbg")).toBe("lldb-dap");
    expect(adapterFor("node")).toBe("js-debug");
    expect(adapterFor("chrome")).toBeNull();
  });

  it("strips VS Code's own keys and defaults cwd and debugpy's console", () => {
    const args = launchArguments(
      { name: "x", type: "debugpy", request: "launch", program: "/a.py", console: "integratedTerminal", preLaunchTask: "build" },
      { file: "/a.py", workspaceFolder: "/w" }
    );
    expect(args).toEqual({ cwd: "/w", program: "/a.py", console: "internalConsole", redirectOutput: true });
  });

  it("keeps an explicit cwd", () => {
    expect(launchArguments({ name: "g", type: "go", request: "launch", cwd: "/x" }, { file: "", workspaceFolder: "/w" }).cwd).toBe("/x");
  });

  it("has no default for languages it cannot debug", () => {
    expect(defaultConfigFor("markdown")).toBeNull();
  });
});
