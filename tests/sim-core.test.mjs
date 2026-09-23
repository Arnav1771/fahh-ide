import test from "node:test";
import assert from "node:assert/strict";
import * as acorn from "acorn";
import {
  createCooldown, cooldownMsFromSecs, DEFAULT_COOLDOWN_MS, toMarkerSeverity, MarkerSeverity, LspSeverity,
  hasErrorDiagnostic, parsePublishDiagnostics, publishMessage, createPipeline, diagnoseJs, diagnoseJson, firstBadOffset,
} from "../sim/sim-core.js";

const clock = () => {
  let t = 1000;
  return { now: () => t, advance: (ms) => { t += ms; } };
};
const err = (line = 0) => ({ range: { start: { line, character: 0 }, end: { line, character: 1 } }, severity: 1, message: "boom" });
const warn = () => ({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 2, message: "meh" });

// ---- the same cases as the editor's own cooldown.test.ts ----
test("cooldown: fires, then refuses inside the window, then fires again", () => {
  const c = clock();
  const cd = createCooldown(3000, { now: c.now });
  assert.equal(cd.tryTrigger(), true);
  c.advance(2999);
  assert.equal(cd.tryTrigger(), false);
  assert.equal(cd.remainingMs(), 1);
  c.advance(1);
  assert.equal(cd.tryTrigger(), true);
});

test("cooldown: a refused call does not extend the window", () => {
  const c = clock();
  const cd = createCooldown(3000, { now: c.now });
  cd.tryTrigger();
  c.advance(2000);
  cd.tryTrigger();
  c.advance(1000);
  assert.equal(cd.tryTrigger(), true);
});

test("cooldown: 0, negative and NaN disable throttling; reset forgets", () => {
  for (const ms of [0, -5, NaN]) {
    const cd = createCooldown(ms);
    assert.ok(cd.tryTrigger() && cd.tryTrigger() && cd.tryTrigger(), String(ms));
  }
  const cd = createCooldown(3000);
  cd.tryTrigger();
  cd.reset();
  assert.equal(cd.tryTrigger(), true);
  assert.equal(DEFAULT_COOLDOWN_MS, 3000);
  assert.equal(cooldownMsFromSecs(undefined), 3000);
  assert.equal(cooldownMsFromSecs(-1), 3000);
  assert.equal(cooldownMsFromSecs(0), 0);
  assert.equal(cooldownMsFromSecs(1.5), 1500);
});

test("severity: a missing or unknown severity counts as an error", () => {
  assert.equal(toMarkerSeverity(undefined), MarkerSeverity.Error);
  assert.equal(toMarkerSeverity(99), MarkerSeverity.Error);
  assert.equal(toMarkerSeverity(LspSeverity.Warning), MarkerSeverity.Warning);
  assert.equal(hasErrorDiagnostic([warn(), { ...warn(), severity: undefined }]), true);
  assert.equal(hasErrorDiagnostic([warn(), { ...warn(), severity: 3 }, { ...warn(), severity: 4 }]), false);
  assert.equal(hasErrorDiagnostic([]), false);
});

test("only publishDiagnostics notifications are handled", () => {
  assert.equal(parsePublishDiagnostics(null), null);
  assert.equal(parsePublishDiagnostics({ method: "window/logMessage", params: {} }), null);
  assert.equal(parsePublishDiagnostics({ method: "textDocument/publishDiagnostics", params: { uri: 1, diagnostics: [] } }), null);
  assert.equal(parsePublishDiagnostics({ method: "textDocument/publishDiagnostics", params: { uri: "file:///a", diagnostics: {} } }), null);
  assert.ok(parsePublishDiagnostics(publishMessage("file:///a", [])));
});

// ---- the pipeline, in LspBridge's order ----
test("a 40-message error storm inside one window makes exactly one sound", () => {
  const c = clock();
  const p = createPipeline({ now: c.now });
  const stages = [];
  for (let i = 0; i < 40; i++) {
    stages.push(p.receive(publishMessage("file:///sim/main.js", [err(i)])).stage);
    c.advance(25);
  }
  assert.equal(stages.filter((s) => s === "fired").length, 1);
  assert.equal(stages.filter((s) => s === "cooled").length, 39);
  assert.deepEqual(p.stats, { messages: 40, errorMessages: 40, played: 1, suppressed: 39 });
});

test("warnings never play, and never use up the cooldown", () => {
  const c = clock();
  const p = createPipeline({ now: c.now });
  assert.equal(p.receive(publishMessage("f", [warn(), warn()])).stage, "no-error");
  assert.equal(p.receive(publishMessage("f", [])).stage, "no-error");
  assert.equal(p.receive(publishMessage("f", [warn(), err()])).stage, "fired", "an error next to warnings still fires");
  assert.equal(p.stats.played, 1);
});

test("cooldown 0 plays every time; a changed cooldown starts fresh", () => {
  const p = createPipeline({ cooldownMs: 0 });
  assert.equal([1, 2, 3].map(() => p.receive(publishMessage("f", [err()])).stage).join(), "fired,fired,fired");
  p.setCooldownMs(3000);
  assert.equal(p.receive(publishMessage("f", [err()])).stage, "fired");
  assert.equal(p.receive(publishMessage("f", [err()])).stage, "cooled");
});

test("raw strings are parsed; junk and other methods are ignored without counting", () => {
  const p = createPipeline();
  assert.equal(p.receive("{not json").stage, "unparsed");
  assert.equal(p.receive(JSON.stringify({ method: "initialized" })).stage, "ignored");
  assert.equal(p.stats.messages, 0);
  assert.equal(p.receive(JSON.stringify(publishMessage("f", [{ ...err(), severity: undefined }]))).stage, "fired");
});

// ---- producing diagnostics ----
test("JS with acorn: syntax error has a real position and no warnings", () => {
  const d = diagnoseJs("const a = 1;\nconst b = ;\nconsole.log(a);", acorn);
  assert.equal(d.length, 1);
  assert.equal(d[0].severity, LspSeverity.Error);
  assert.equal(d[0].range.start.line, 1);
  assert.ok(!/\(\d+:\d+\)/.test(d[0].message), "position suffix is stripped from the message");
});

test("JS with acorn: clean code gives style warnings only, with positions", () => {
  const d = diagnoseJs("var x = 1;\nif (x == '1') { debugger; }\nconst s = 'a == b';", acorn);
  assert.deepEqual(d.map((x) => [x.severity, x.range.start.line, x.range.start.character]), [[2, 0, 0], [2, 1, 6], [2, 1, 16]]);
  assert.equal(hasErrorDiagnostic(d), false, "warnings alone never play the sound");
  assert.deepEqual(diagnoseJs("const ok = 1 === 1;", acorn), []);
});

test("JS fallback without acorn parses but never runs the code", () => {
  globalThis.__ran = false;
  assert.deepEqual(diagnoseJs("globalThis.__ran = true;"), []);
  assert.equal(globalThis.__ran, false);
  const d = diagnoseJs("function (");
  assert.equal(d.length, 1);
  assert.equal(d[0].severity, LspSeverity.Error);
});

test("JSON: errors land on the right line", () => {
  assert.deepEqual(diagnoseJson('{"a": 1}'), []);
  const d = diagnoseJson('{\n  "a": 1,\n  "b": \n}');
  assert.equal(d.length, 1);
  assert.equal(d[0].range.start.line, 3);
  assert.equal(diagnoseJson("   ")[0].severity, LspSeverity.Error);
  const trailing = diagnoseJson('{\n  "a": [1, 2,]\n}');
  assert.equal(trailing[0].range.start.line, 1, "trailing comma is on line 2");
  const unquoted = diagnoseJson('{\n  "ok": true,\n  name: "x"\n}');
  assert.equal(unquoted[0].range.start.line, 2);
  assert.equal(unquoted[0].range.start.character, 2);
});

test("the JSON scanner agrees with JSON.parse on what is valid", () => {
  const cases = ['{}', '[]', '0', '-0.5e+3', '"a\\u00e9\\n"', '{"a":[1,{"b":null}],"c":true}', ' [ 1 , 2 ] ',
    '{', '[1,]', '{"a" 1}', '01', '-', '"\\x"', '"tab\there"', 'tru', '[1] 2', '{"a":1,}', '"\\u12G4"', ''];
  for (const c of cases) {
    let ok = true;
    try { JSON.parse(c); } catch { ok = false; }
    assert.equal(firstBadOffset(c) === -1, ok, JSON.stringify(c));
  }
});
