import { test } from "node:test";
import * as assert from "node:assert/strict";
import { LineReader, agentArgs, findAgent } from "../protocol";

test("LineReader splits chunks into JSON lines and passes other text on", () => {
  const r = new LineReader();
  const lines: unknown[] = [];
  const text: string[] = [];
  r.push('{"type":"ready","session":"s1"', (l) => lines.push(l), (t) => text.push(t));
  assert.equal(lines.length, 0, "half a line waits");
  r.push(',"model":"m","mode":"normal","cwd":"/x"}\nnot json\n{"type":"turn_end","ok":true,"plan":null,"text":"hi"}\n', (l) => lines.push(l), (t) => text.push(t));
  assert.deepEqual(lines.map((l) => (l as { type: string }).type), ["ready", "turn_end"]);
  assert.deepEqual(text, ["not json"]);
});

test("agentArgs adds the agent word only for the editor program", () => {
  assert.deepEqual(agentArgs("C:\\x\\fahh-editor.exe", { cwd: "C:\\w", provider: "groq", mode: "normal" }), ["agent", "--json", "--cwd", "C:\\w", "--provider", "groq", "--permission-mode", "normal"]);
  assert.deepEqual(agentArgs("/usr/bin/fahh-agent", { cwd: "/w", provider: "ollama", mode: "smart", model: "m", resume: "s9" }), ["--json", "--cwd", "/w", "--provider", "ollama", "--permission-mode", "smart", "--model", "m", "-r", "s9"]);
});

test("findAgent prefers the setting, then the installed editor, then PATH", () => {
  const has = (set: string[]) => (p: string) => set.includes(p);
  assert.equal(findAgent("D:\\fahh.exe", {}, "win32", has(["D:\\fahh.exe"])), "D:\\fahh.exe");
  assert.equal(findAgent("D:\\missing.exe", {}, "win32", has([])), undefined);
  const local = "C:\\Users\\u\\AppData\\Local";
  const agent = `${local}\Fahh Editor\fahh-agent.exe`;
  assert.equal(findAgent("", { LOCALAPPDATA: local }, "win32", has([`${local}\Fahh Editor\fahh-editor.exe`, agent])), agent, "the console agent, not the windowed editor");
  assert.equal(findAgent("", { HOME: "/h", PATH: "/opt/bin" }, "linux", has(["/opt/bin/fahh-agent"])), "/opt/bin/fahh-agent");
  assert.equal(findAgent("", { PATH: "" }, "linux", has([])), undefined);
});
