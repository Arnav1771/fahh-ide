import { describe, expect, it } from "vitest";
import { createRunRouter } from "./runEvents";

function setup() {
  const log: string[] = [];
  const router = createRunRouter({
    onOutput: (line, stream) => log.push(`${stream}:${line}`),
    onExit: (code, ms) => log.push(`exit:${code}:${ms}`),
  });
  return { router, log };
}

describe("run event router", () => {
  it("a program that prints and exits before run_file resolves is not lost", () => {
    const { router, log } = setup();
    router.begin();
    router.output({ pid: 42, line: "hello", stream: "stdout" });
    router.output({ pid: 42, line: "oops", stream: "stderr" });
    router.exit({ pid: 42, exit_code: 0, duration_ms: 12 });
    expect(log).toEqual([]);
    router.attach(42);
    expect(log).toEqual(["stdout:hello", "stderr:oops", "exit:0:12"]);
    expect(router.current()).toBeNull();
  });

  it("routes live events for the current pid and ignores other runs", () => {
    const { router, log } = setup();
    router.begin();
    router.attach(7);
    router.output({ pid: 7, line: "a", stream: "stdout" });
    router.output({ pid: 99, line: "someone else", stream: "stdout" });
    router.exit({ pid: 7, exit_code: 3, duration_ms: 5 });
    router.output({ pid: 7, line: "after exit", stream: "stdout" });
    expect(log).toEqual(["stdout:a", "exit:3:5"]);
  });

  it("ignores everything when idle, and a failed start drops the buffer", () => {
    const { router, log } = setup();
    router.output({ pid: 1, line: "stray", stream: "stdout" });
    router.begin();
    router.output({ pid: 2, line: "buffered", stream: "stdout" });
    router.cancel();
    router.attach(2);
    expect(log).toEqual([]);
  });

  it("a new run forgets events buffered for the previous one", () => {
    const { router, log } = setup();
    router.begin();
    router.output({ pid: 5, line: "old", stream: "stdout" });
    router.begin();
    router.output({ pid: 6, line: "new", stream: "stdout" });
    router.attach(6);
    expect(log).toEqual(["stdout:new"]);
  });
});
