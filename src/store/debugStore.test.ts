import { describe, expect, it } from "vitest";
import { appendOutput } from "./debugStore";

const texts = (l: { text: string }[]) => l.map((x) => x.text);
describe("appendOutput", () => {
  it("joins stdout chunks until the newline (print('hello fahh', 42))", () => {
    let c = appendOutput([], "stdout", "hello fahh");
    c = appendOutput(c, "stdout", " 42");
    c = appendOutput(c, "stdout", "\n");
    expect(texts(c)).toEqual(["hello fahh 42"]);
    expect(c[0].open).toBe(false);
  });
  it("splits multi-line chunks and keeps an unfinished tail open", () => {
    const c = appendOutput([], "stdout", "a\nb\nc");
    expect(texts(c)).toEqual(["a", "b", "c"]);
    expect(c.map((x) => !!x.open)).toEqual([false, false, true]);
  });
  it("does not join different streams or Fahh messages", () => {
    let c = appendOutput([], "stdout", "partial");
    c = appendOutput(c, "stderr", "err\n");
    c = appendOutput(c, "console", "Process exited with code 0");
    c = appendOutput(c, "console", "next");
    expect(texts(c)).toEqual(["partial", "err", "Process exited with code 0", "next"]);
  });
  it("handles CRLF", () => {
    expect(texts(appendOutput([], "stdout", "x\r\ny\r\n"))).toEqual(["x", "y"]);
  });
});
