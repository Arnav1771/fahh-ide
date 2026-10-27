import { describe, expect, it } from "vitest";
import { linuxToWindows, parseWslPath, toWslUnc } from "./wslPath";

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
