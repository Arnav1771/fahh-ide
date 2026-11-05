import { describe, expect, it } from "vitest";
import { jupyterMissing, lastLines, pipInstallCommand, shellProgram } from "./python";

describe("shellProgram", () => {
  it("makes a venv inside the folder relative, Windows and Unix", () => {
    expect(shellProgram("C:\\proj\\.venv\\Scripts\\python.exe", "C:\\proj")).toBe(".venv\\Scripts\\python");
    expect(shellProgram("/home/me/w/venv/bin/python", "/home/me/w/")).toBe("venv/bin/python");
  });

  it("keeps PATH names and outside paths, quoting spaces", () => {
    expect(shellProgram("python3", "/w")).toBe("python3");
    expect(shellProgram("/w2/.venv/bin/python", "/w")).toBe("/w2/.venv/bin/python");
    expect(shellProgram("C:\\Program Files\\Python311\\python.exe", null)).toBe('"C:\\Program Files\\Python311\\python"');
  });
});

describe("pipInstallCommand", () => {
  it("installs nbconvert and ipykernel with that interpreter", () => {
    expect(pipInstallCommand("C:\\proj\\.venv\\Scripts\\python.exe", "C:\\proj")).toBe(".venv\\Scripts\\python -m pip install nbconvert ipykernel");
    expect(pipInstallCommand("python", null)).toBe("python -m pip install nbconvert ipykernel");
  });
});

describe("jupyterMissing", () => {
  it("spots a missing jupyter, nbconvert or kernel", () => {
    expect(jupyterMissing("C:\\proj\\.venv\\Scripts\\python.exe: No module named jupyter")).toBe(true);
    expect(jupyterMissing("Jupyter command `jupyter-nbconvert` not found.")).toBe(true);
    expect(jupyterMissing("ModuleNotFoundError: No module named 'ipykernel'")).toBe(true);
    expect(jupyterMissing("jupyter_client.kernelspec.NoSuchKernel: No such kernel named python3")).toBe(true);
  });

  it("leaves other failures alone", () => {
    expect(jupyterMissing("ModuleNotFoundError: No module named 'pandas'")).toBe(false);
    expect(jupyterMissing("nbformat.reader.NotJSONError: Notebook does not appear to be JSON")).toBe(false);
  });
});

it("lastLines keeps the tail without blanks", () => {
  expect(lastLines(["a", "", "b", "c", " "], 2)).toEqual(["b", "c"]);
});
