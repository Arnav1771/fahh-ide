import { test } from "node:test";
import * as assert from "node:assert/strict";
import { KEY_ENV, LineReader, MODES, PROVIDERS, SLASH, agentArgs, agentEnv, detectFacts, filterSlash, findAgent, keyState, parseModels, parseSessions, parseSlash, starters } from "../protocol";

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
  const agent = `${local}\\Fahh Editor\\fahh-agent.exe`;
  assert.equal(findAgent("", { LOCALAPPDATA: local }, "win32", has([`${local}\\Fahh Editor\\fahh-editor.exe`, agent])), agent, "the console agent, not the windowed editor");
  assert.equal(findAgent("", { HOME: "/h", PATH: "/opt/bin" }, "linux", has(["/opt/bin/fahh-agent"])), "/opt/bin/fahh-agent");
  assert.equal(findAgent("", { PATH: "" }, "linux", has([])), undefined);
});

test("parseSlash: commands, arguments, unknown names, and prompts that only look like commands", () => {
  assert.deepEqual(parseSlash("/model"), { name: "model", arg: "" });
  assert.deepEqual(parseSlash("  /MODEL  llama-3.3-70b "), { name: "model", arg: "llama-3.3-70b" });
  assert.deepEqual(parseSlash("/ask why\nis it slow?"), { name: "ask", arg: "why\nis it slow?" });
  assert.ok("error" in (parseSlash("/nope") as object));
  assert.equal(parseSlash("fix the bug"), null);
  assert.equal(parseSlash("/"), null);
  assert.equal(parseSlash("/usr/bin/env is missing"), null);
  for (const c of ["new", "model", "provider", "mode", "resume", "clear", "help", "settings"]) assert.ok(SLASH.some((s) => s.name === c), c);
});

test("filterSlash puts prefix matches first, then other matches", () => {
  assert.deepEqual(filterSlash("/m").map((c) => c.name).slice(0, 2), ["model", "mode"]);
  assert.equal(filterSlash("").length, SLASH.length);
  assert.ok(filterSlash("session").every((c) => c.name.includes("session") || c.desc.toLowerCase().includes("session")));
  assert.deepEqual(filterSlash("zzz"), []);
});

test("every provider fahh-agent knows is offered, with its key variable", () => {
  assert.deepEqual(PROVIDERS.map((p) => p.id), ["groq", "gemini", "nvidia", "openrouter", "anthropic", "ollama"]);
  assert.equal(KEY_ENV.ollama, "");
  assert.equal(KEY_ENV.anthropic, "ANTHROPIC_API_KEY");
});

test("agentEnv passes only the chosen provider's stored key; keyState says where a key comes from", () => {
  const base: NodeJS.ProcessEnv = { PATH: "/bin", GEMINI_API_KEY: "g-env" };
  const env = agentEnv("groq", "gsk-1", base);
  assert.equal(env.GROQ_API_KEY, "gsk-1");
  assert.equal(env.GEMINI_API_KEY, "g-env", "the parent environment is kept");
  assert.equal(base.GROQ_API_KEY, undefined, "the parent is not changed");
  assert.equal(agentEnv("gemini", "g-stored", base).GEMINI_API_KEY, "g-stored", "a stored key wins");
  assert.deepEqual(agentEnv("ollama", "x", base), base, "a keyless provider gets no key");
  assert.equal(keyState("ollama", false, {}), "none-needed");
  assert.equal(keyState("groq", true, {}), "stored");
  assert.equal(keyState("gemini", false, base), "env");
  assert.equal(keyState("groq", false, { GROQ_API_KEY: "  " }), "missing");
});

test("parseSessions and parseModels read the agent's listings", () => {
  const out = "20261120-ab12  3 step(s)  fix the parser\r\n20261121-cd34  1 step(s)  \n";
  assert.deepEqual(parseSessions(out), [
    { id: "20261120-ab12", steps: 3, title: "fix the parser" },
    { id: "20261121-cd34", steps: 1, title: "" },
  ]);
  assert.deepEqual(parseSessions("no saved sessions for /x\n"), []);
  assert.deepEqual(parseModels("a\n\n b \r\n"), ["a", "b"]);
});

test("starter prompts come only from what is in the folder", () => {
  const files: Record<string, string> = { ".git": "", "README.md": "# x", "package.json": JSON.stringify({ scripts: { test: "node --test" } }) };
  const f = detectFacts("demo", (p) => files[p], "src/a.ts");
  assert.deepEqual(f, { folder: "demo", git: true, activeFile: "src/a.ts", readme: "README.md", test: "npm test" });
  const s = starters(f);
  assert.equal(s.length, 4);
  assert.ok(s[0].includes("demo") && s.some((x) => x.includes("src/a.ts")) && s.some((x) => x.includes("npm test")));
  assert.deepEqual(starters(detectFacts("empty", () => undefined)), ["Give me a tour of empty: what it does and where the main code lives"]);
  const npmDefault = JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } });
  assert.equal(detectFacts("n", (p) => (p === "package.json" ? npmDefault : undefined)).test, undefined);
  assert.equal(detectFacts("r", (p) => (p === "Cargo.toml" ? "" : undefined)).test, "cargo test");
  assert.equal(detectFacts("b", (p) => (p === "package.json" ? "{broken" : undefined)).test, undefined);
});

test("the mode table matches fahh-agent's modes, and only bypass warns", () => {
  assert.deepEqual(MODES.map((m) => m.id), ["normal", "accept-edits", "smart", "plan", "bypass"]);
  assert.deepEqual(MODES.filter((m) => m.warn).map((m) => m.id), ["bypass"]);
});
