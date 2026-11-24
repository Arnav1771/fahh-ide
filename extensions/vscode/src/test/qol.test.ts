import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Checkpoints, Entry, addEvent, answerApproval, effectiveMode, exportMarkdown, foldersOf, fuzzy, mentionOptions, mentionToken, parseMentions, proposedContent, pushHistory, rulesMode, selectionToken, usageDetail, usageText, withContext } from "../qol";
import { LineReader, SLASH, parseSlash, slashFor } from "../protocol";

test("parseMentions: paths, folders, quoted paths, selection, problems; not e-mail addresses", () => {
  assert.deepEqual(parseMentions("look at @src/a.ts, and @src/ please"), [
    { kind: "path", path: "src/a.ts", folder: false },
    { kind: "path", path: "src", folder: true },
  ]);
  assert.deepEqual(parseMentions('@"my dir/b c.ts" @problems'), [{ kind: "path", path: "my dir/b c.ts", folder: false }, { kind: "problems" }]);
  assert.deepEqual(parseMentions("why? @selection:src/x.rs#L3-9"), [{ kind: "selection", path: "src/x.rs", start: 3, end: 9 }]);
  assert.deepEqual(parseMentions("mail me at a@b.com"), []);
  assert.deepEqual(parseMentions("@file @folder @selection left unchosen"), []);
  assert.deepEqual(parseMentions("@src\\win\\p.ts"), [{ kind: "path", path: "src/win/p.ts", folder: false }]);
});

test("mention tokens round-trip through parseMentions", () => {
  assert.equal(mentionToken("a b/c.ts"), '@"a b/c.ts"');
  assert.equal(mentionToken("src", true), "@src/");
  assert.deepEqual(parseMentions(mentionToken("a b/c.ts")), [{ kind: "path", path: "a b/c.ts", folder: false }]);
  assert.deepEqual(parseMentions(selectionToken("src\\m.ts", 1, 4)), [{ kind: "selection", path: "src/m.ts", start: 1, end: 4 }]);
});

test("withContext delimits the context; files are named, selections and problems included", () => {
  assert.equal(withContext("hi", []), "hi");
  const out = withContext("explain", [
    { kind: "file", path: "a.ts" },
    { kind: "folder", path: "src" },
    { kind: "selection", path: "a.ts", start: 2, end: 3, text: "x = 1\n```\ny", lang: "typescript" },
    { kind: "problems", lines: ["a.ts:2:1 error: bad"] },
  ]);
  assert.ok(out.startsWith("explain\n\n<vscode-context>\n"));
  assert.ok(out.endsWith("\n</vscode-context>"));
  assert.match(out, /File: a\.ts \(read it/);
  assert.match(out, /Folder: src\//);
  assert.match(out, /Selection: a\.ts lines 2-3\n````typescript\nx = 1\n```\ny\n````/, "a fence the selection cannot close");
  assert.match(out, /Problems \(1\):\na\.ts:2:1 error: bad/);
  assert.match(withContext("p", [{ kind: "problems", lines: [] }]), /Problems: none/);
});

test("fuzzy prefers the file name, then substrings, then subsequences with fewer gaps", () => {
  const files = ["src/extension.ts", "src/test/protocol.test.ts", "media/chat.js", "src/protocol.ts", "README.md"];
  assert.deepEqual(fuzzy("proto", files), ["src/protocol.ts", "src/test/protocol.test.ts"]);
  assert.equal(fuzzy("chjs", files)[0], "media/chat.js");
  assert.deepEqual(fuzzy("zzz", files), []);
  assert.equal(fuzzy("", files, 2).length, 2);
  assert.deepEqual(foldersOf(["a/b/c.ts", "a/d.ts", "e.ts"]), ["a/", "a/b/"]);
});

test("mentionOptions: the four kinds by prefix, then file matches", () => {
  const all = mentionOptions("", ["a.ts"]);
  assert.deepEqual(all.map((o) => o.label), ["@file", "@folder", "@selection", "@problems"]);
  const f = mentionOptions("f", ["src/foo.ts", "bar.ts"]);
  assert.deepEqual(f.map((o) => o.label), ["@file", "@folder", "src/foo.ts"]);
  assert.equal(f[2].insert, "@src/foo.ts");
  assert.equal(mentionOptions("pro", [])[0].insert, "@problems");
});

test("pushHistory: newest last, no duplicates, at most 50, blank ignored", () => {
  assert.deepEqual(pushHistory(["a", "b"], "a"), ["b", "a"]);
  assert.deepEqual(pushHistory(["a"], "   "), ["a"]);
  const many = Array.from({ length: 60 }, (_, i) => String(i)).reduce((h, x) => pushHistory(h, x), [] as string[]);
  assert.equal(many.length, 50);
  assert.equal(many[0], "10");
  assert.equal(many[49], "59");
});

test("Checkpoints keep the first original per file and restore it", () => {
  const c = new Checkpoints();
  c.record(1, "a.ts", "v1");
  c.record(1, "a.ts", "v2"); // a second change in the same turn keeps the first original
  c.record(1, "new.ts", null);
  c.changedFile(1, "a.ts");
  c.changedFile(1, "auto.ts"); // changed without a snapshot (accept-edits mode)
  c.record(2, "a.ts", "v3");
  assert.deepEqual(c.files(1), { restorable: ["a.ts", "new.ts"], unknown: ["auto.ts"] });
  const writes: [string, string | null][] = [];
  assert.deepEqual(c.restore(1, (p, t) => writes.push([p, t])), ["a.ts", "new.ts"]);
  assert.deepEqual(writes, [["a.ts", "v1"], ["new.ts", null]]);
  assert.deepEqual(c.files(1), { restorable: [], unknown: [] }, "a restored turn is forgotten");
  assert.ok(c.has(2, "a.ts"));
  c.clear();
  assert.ok(!c.has(2, "a.ts"));
});

test("proposedContent applies edit_file and write_file like the agent", () => {
  assert.equal(proposedContent("write_file", { path: "a", content: "new" }, null), "new");
  assert.equal(proposedContent("edit_file", { old_str: "b", new_str: "X" }, "a b b"), "a X b");
  assert.equal(proposedContent("edit_file", { old_str: "b", new_str: "X", replace_all: true }, "a b b"), "a X X");
  assert.equal(proposedContent("edit_file", { old_str: "b", new_str: "$&$1" }, "a b"), "a $&$1", "no regex replacement patterns");
  assert.equal(proposedContent("edit_file", { old_str: "zz", new_str: "X" }, "a b"), undefined);
  assert.equal(proposedContent("edit_file", { old_str: "a", new_str: "X" }, null), undefined);
  assert.equal(proposedContent("run_command", {}, "x"), undefined);
  assert.equal(proposedContent("write_file", undefined, "x"), undefined);
});

test("auto-approve rules map onto the agent's own modes and only ever raise one", () => {
  assert.equal(rulesMode({ edits: "ask", commands: "ask" }), "normal");
  assert.equal(rulesMode({ edits: "always", commands: "ask" }), "accept-edits");
  assert.equal(rulesMode({ edits: "ask", commands: "always" }), "bypass", "commands can write files: always means bypass");
  assert.equal(effectiveMode("normal", { edits: "always", commands: "ask" }), "accept-edits");
  assert.equal(effectiveMode("smart", { edits: "always", commands: "ask" }), "smart", "never lowered");
  assert.equal(effectiveMode("normal", { edits: "ask", commands: "ask" }), "normal");
  assert.equal(effectiveMode("plan", { edits: "always", commands: "always" }), "plan", "read-only modes stay read-only");
  assert.equal(effectiveMode("qa", { edits: "always", commands: "always" }), "qa");
  assert.equal(effectiveMode("accept-edits", { edits: "ask", commands: "always" }), "bypass");
});

test("the transcript follows agent events and exports to Markdown with tool calls", () => {
  const t: Entry[] = [{ kind: "user", text: "fix it", mode: "normal" }];
  addEvent(t, { type: "text_delta", text: "Looking" });
  addEvent(t, { type: "text_delta", text: " now." });
  addEvent(t, { type: "tool_call", id: "1", name: "read_file", args: { path: "a.ts" } });
  addEvent(t, { type: "tool_result", id: "1", ok: true, output: "const a = 1;" });
  addEvent(t, { type: "approval_request", tool: "edit_file", summary: "Edit a.ts" });
  answerApproval(t, "allowed");
  addEvent(t, { type: "file_changed", path: "a.ts" });
  addEvent(t, { type: "sub", name: "explorer", event: { type: "text_delta", text: "hidden" } });
  addEvent(t, { type: "sub", name: "explorer", event: { type: "tool_call", id: "2", name: "grep", args: {} } });
  addEvent(t, { type: "text_delta", text: "Done." });
  assert.deepEqual(t.map((e) => e.kind), ["user", "assistant", "tool", "approval", "note", "tool", "assistant"]);
  const md = exportMarkdown(t, { title: "Fahh Familiar chat", model: "Groq / m", folder: "proj", date: "2026-11-24 10:00" });
  assert.ok(md.startsWith("# Fahh Familiar chat\n\nproj · Groq / m · 2026-11-24 10:00\n"));
  assert.match(md, /## You\n\nfix it\n/);
  assert.match(md, /## Fahh Familiar\n\nLooking now\.\n/);
  assert.match(md, /<summary>Tool: read_file \(ok\)<\/summary>\n\n```json\n\{\n {2}"path": "a\.ts"\n\}\n```\n\n```text\nconst a = 1;\n```/);
  assert.match(md, /> \*\*Approval:\*\* Edit a\.ts: allowed/);
  assert.match(md, /_Changed a\.ts_/);
  assert.match(md, /Tool: \[explorer\] grep<\/summary>/);
  assert.ok(!md.includes("hidden"), "subagent prose stays out, as in the view");
  assert.ok(!/\n{3}/.test(md));
});

test("usage text and the slash commands that need agent features", () => {
  const u = { model_calls: 3, tool_calls: 5, tokens_in: 11800, tokens_out: 500, context: { used: 9000, window: 128000, percent: 7 } };
  assert.equal(usageText(u), "~12k tokens · 7% context");
  assert.equal(usageText({ ...u, tokens_in: 900, tokens_out: 50, context: undefined }), "~950 tokens");
  assert.match(usageDetail(u), /Model calls: 3 · tool calls: 5\nTokens in: ~12k · out: ~500 \(estimated\)\nContext: ~9\.0k of ~128k tokens \(7%\)/);
  const names = (f?: string[]) => slashFor(f).map((c) => c.name);
  assert.ok(!names(undefined).includes("compact") && !names([]).includes("usage"), "an older agent: hidden");
  assert.ok(names(["compact", "usage", "revert"]).includes("compact") && names(["compact"]).includes("export"));
  for (const c of ["export", "compact", "usage", "permissions"]) assert.ok(SLASH.some((s) => s.name === c), c);
  assert.deepEqual(parseSlash("/permissions"), { name: "permissions", arg: "" });
});

test("LineReader passes the new JSON lines (features, usage, compacted, reverted)", () => {
  const r = new LineReader();
  const got: { type: string }[] = [];
  r.push(
    '{"type":"ready","session":"s","model":"m","mode":"normal","cwd":"/w","features":["compact","usage","revert"]}\n' +
      '{"type":"turn_end","ok":true,"plan":null,"text":"t","usage":{"type":"usage","model_calls":1,"tool_calls":0,"tokens_in":5,"tokens_out":2}}\n' +
      '{"type":"compacted","messages":4,"before":900,"after":300}\n{"type":"reverted","turn":2,"files":["a.ts"]}\n',
    (l) => got.push(l),
    () => assert.fail("all lines are JSON")
  );
  assert.deepEqual(got.map((l) => l.type), ["ready", "turn_end", "compacted", "reverted"]);
  assert.deepEqual((got[0] as { features?: string[] }).features, ["compact", "usage", "revert"]);
});
