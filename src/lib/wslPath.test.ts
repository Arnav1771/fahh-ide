import { describe, expect, it } from "vitest";
import { linuxToWindows, parseWslPath, toWslUnc } from "./wslPath";
import { effectiveShell, isUncPath, wrapForCwd } from "./shellCwd";

const WSL_DIR = "\\\\wsl.localhost\\Ubuntu\\home\\dell\\proj";

describe("WSL paths", () => {
  it("parses the spellings Windows uses for a WSL folder", () => {
    const want = { distro: "Ubuntu", linux: "/home/dell/proj" };
    expect(parseWslPath(WSL_DIR)).toEqual(want);
    expect(parseWslPath("\\\\wsl$\\Ubuntu\\home\\dell\\proj\\")).toEqual(want);
    expect(parseWslPath("//wsl.localhost/Ubuntu/home/dell/proj")).toEqual(want);
    expect(parseWslPath("C:\\Users\\x")).toBeNull();
    expect(parseWslPath("\\\\server\\share")).toBeNull();
  });

  it("maps a Linux folder reported by a WSL shell back to Windows", () => {
    expect(linuxToWindows("/home/dell/proj/sub", WSL_DIR)).toBe(`${WSL_DIR}\\sub`);
    expect(linuxToWindows("/mnt/c/Users/me", WSL_DIR)).toBe("C:\\Users\\me");
    expect(linuxToWindows("/home/x", "C:\\proj")).toBeNull();
    expect(toWslUnc("Ubuntu", "/")).toBe("\\\\wsl.localhost\\Ubuntu");
  });
});

describe("terminal shell choice on Windows", () => {
  it("auto tabs use WSL for WSL folders and cmd elsewhere", () => {
    expect(effectiveShell("auto", WSL_DIR, "cmd")).toBe("wsl");
    expect(effectiveShell("auto", "C:\\proj", "cmd")).toBe("cmd");
  });

  it("a shell picked from the menu is honoured", () => {
    expect(effectiveShell("powershell", WSL_DIR, "cmd")).toBe("powershell");
    expect(effectiveShell("bash", "C:\\proj", "cmd")).toBe("wsl");
    expect(effectiveShell("cmd", WSL_DIR, "cmd")).toBe("cmd");
    expect(effectiveShell("powershell", "/home", "posix")).toBe("posix");
  });

  it("wraps commands so each shell reports its folder", () => {
    expect(wrapForCwd("ls", "wsl")).toContain('"$PWD"');
    expect(wrapForCwd("Get-ChildItem", "powershell")).toContain("(Get-Location).ProviderPath");
    expect(wrapForCwd("cd sub", "cmd", "C:\\proj")).toContain("%CD%");
    expect(wrapForCwd("cd sub", "cmd", WSL_DIR)).toBe("cd sub");
    expect(isUncPath(WSL_DIR)).toBe(true);
    expect(isUncPath("C:\\x")).toBe(false);
  });
});
