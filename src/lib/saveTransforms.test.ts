import { describe, expect, it } from "vitest";
import { cleanText } from "./saveTransforms";

const all = { trimTrailingWhitespace: true, insertFinalNewline: true };
describe("cleanText", () => {
  it("trims line ends and adds one final newline", () => {
    expect(cleanText("a  \nb\t\nc", all)).toBe("a\nb\nc\n");
  });
  it("collapses several trailing newlines into one and keeps CRLF", () => {
    expect(cleanText("x \r\ny\r\n\r\n\r\n", all)).toBe("x\r\ny\r\n");
  });
  it("leaves text alone when both are off, and empty files empty", () => {
    expect(cleanText("a  \n\n", { trimTrailingWhitespace: false, insertFinalNewline: false })).toBe("a  \n\n");
    expect(cleanText("", all)).toBe("");
  });
  it("keeps indentation and inner spaces", () => {
    expect(cleanText("  if (a  b) {}   ", all)).toBe("  if (a  b) {}\n");
  });
});
