import { describe, expect, it } from "vitest";
import { applyKernelEvent, ipykernelInstallCommand, kernelBusy, lastLines, parseKernelLine, queueCells, serialQueue, settleRuns, shellProgram, type CellRuns, type KernelEvent } from "./python";

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

it("ipykernelInstallCommand installs ipykernel with that interpreter", () => {
  expect(ipykernelInstallCommand("C:\\proj\\.venv\\Scripts\\python.exe", "C:\\proj")).toBe(".venv\\Scripts\\python -m pip install ipykernel");
  expect(ipykernelInstallCommand("python3", null)).toBe("python3 -m pip install ipykernel");
});

it("lastLines keeps the tail without blanks", () => {
  expect(lastLines(["a", "", "b", "c", " "], 2)).toEqual(["b", "c"]);
});

describe("parseKernelLine", () => {
  it("reads the runner's events", () => {
    expect(parseKernelLine('{"type": "ready", "version": "3.11.4"}')).toEqual({ type: "ready", version: "3.11.4" });
    expect(parseKernelLine('{"type": "missing", "module": "ipykernel"}')).toEqual({ type: "missing", module: "ipykernel" });
    expect(parseKernelLine('{"type": "done", "cell": 3, "count": 7, "status": "error"}')).toEqual({ type: "done", cell: 3, count: 7, status: "error" });
    expect(parseKernelLine('{"type": "cancelled", "cells": [4, 5]}')).toEqual({ type: "cancelled", cells: [4, 5] });
  });

  it("turns nbformat outputs into preview outputs (HTML table, PNG plot, error)", () => {
    const html = parseKernelLine(JSON.stringify({ type: "output", cell: 2, output: { output_type: "execute_result", data: { "text/plain": "df", "text/html": "<table></table>" }, execution_count: 2 } }));
    expect(html).toEqual({ type: "output", cell: 2, output: { type: "html", html: "<table></table>" } });
    const png = parseKernelLine(JSON.stringify({ type: "output", cell: 5, output: { output_type: "display_data", data: { "image/png": "iVBOR\n" } } }));
    expect(png).toMatchObject({ output: { type: "image", src: "data:image/png;base64,iVBOR" } });
    const err = parseKernelLine(JSON.stringify({ type: "output", cell: 1, output: { output_type: "error", ename: "ZeroDivisionError", evalue: "division by zero", traceback: ["\u001b[31mboom\u001b[0m"] } }));
    expect(err).toMatchObject({ output: { type: "error", ename: "ZeroDivisionError", traceback: "boom" } });
  });

  it("ignores stray lines", () => {
    expect(parseKernelLine("[IPKernelApp] WARNING | something")).toBeNull();
    expect(parseKernelLine('{"type": "nope"}')).toBeNull();
    expect(parseKernelLine("42")).toBeNull();
  });
});

describe("applyKernelEvent", () => {
  const run = (runs: CellRuns, ...evs: KernelEvent[]) => evs.reduce(applyKernelEvent, runs);
  const out = { type: "stream", name: "stdout", text: "hi\n" } as const;

  it("queues, runs, streams and finishes a cell", () => {
    let r = queueCells({}, [1, 2]);
    expect(kernelBusy(r)).toBe(true);
    r = run(r, { type: "busy", cell: 1 }, { type: "output", cell: 1, output: out }, { type: "done", cell: 1, count: 4, status: "ok" });
    expect(r[1]).toEqual({ status: "ok", count: 4, outputs: [out] });
    expect(r[2].status).toBe("queued");
    r = run(r, { type: "cancelled", cells: [2] });
    expect(r[2]).toBeUndefined();
    expect(kernelBusy(r)).toBe(false);
  });

  it("clear_output empties a running cell, a rerun drops old outputs", () => {
    let r = run({}, { type: "busy", cell: 0 }, { type: "output", cell: 0, output: out }, { type: "clear", cell: 0 });
    expect(r[0].outputs).toEqual([]);
    r = run(r, { type: "output", cell: 0, output: out }, { type: "done", cell: 0, count: 1, status: "ok" }, { type: "busy", cell: 0 });
    expect(r[0]).toEqual({ status: "busy", count: null, outputs: [] });
  });

  it("settleRuns drops the queue and fails the running cell when the kernel goes away", () => {
    const r = settleRuns(run(queueCells({}, [1, 2]), { type: "busy", cell: 1 }));
    expect(r).toEqual({ 1: { status: "error", count: null, outputs: [] } });
  });
});

describe("serialQueue (kernel stdin writes)", () => {
  // A run_stdin invoke: the line reaches the kernel after a random delay, like concurrent Tauri IPC.
  const fakeStdin = () => {
    const received: string[] = [];
    const write = (line: string) => new Promise<void>((done) => setTimeout(() => (received.push(line), done()), Math.random() * 15));
    return { received, write };
  };
  const lines = Array.from({ length: 11 }, (_, i) => `run ${i}`);

  it("delivers fire-and-forget writes in call order despite random delays", async () => {
    const { received, write } = fakeStdin();
    const q = serialQueue();
    await Promise.all(lines.map((l) => q(() => write(l))));
    expect(received).toEqual(lines);
  });

  it("(the old way, each write fired on its own, scrambles them)", async () => {
    let scrambled = false;
    for (let attempt = 0; attempt < 5 && !scrambled; attempt++) {
      const { received, write } = fakeStdin();
      await Promise.all(lines.map((l) => write(l)));
      scrambled = received.join() !== lines.join();
    }
    expect(scrambled).toBe(true);
  });

  it("keeps going after a failed write; that write still rejects", async () => {
    const q = serialQueue();
    const seen: number[] = [];
    const bad = q(() => Promise.reject(new Error("kernel stopped")));
    const good = q(async () => void seen.push(2));
    await expect(bad).rejects.toThrow("kernel stopped");
    await good;
    expect(seen).toEqual([2]);
  });
});
