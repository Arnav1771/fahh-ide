import { test } from "node:test";
import * as assert from "node:assert/strict";
import { compareSemver, isAllowedUrl, parseLatest } from "../updateCore";

const HOSTS = ["arnav1771.github.io"];

test("compareSemver orders numerically, not as strings", () => {
  assert.ok(compareSemver("0.3.10", "0.3.9") > 0);
  assert.ok(compareSemver("1.0.0", "0.99.99") > 0);
  assert.ok(compareSemver("0.3.0", "0.3.1") < 0);
  assert.equal(compareSemver("v1.2.3", "1.2.3"), 0);
  assert.equal(compareSemver("1.2.3-beta", "1.2.3"), 0);
  assert.throws(() => compareSemver("1.2", "1.2.0"));
  assert.throws(() => compareSemver("1.2.0", "latest"));
});

test("isAllowedUrl accepts only https on an allowed host", () => {
  assert.ok(isAllowedUrl("https://arnav1771.github.io/x/vscode/a-1.0.0.vsix", HOSTS));
  assert.ok(isAllowedUrl("https://ARNAV1771.github.io/x/a.vsix", HOSTS));
  assert.ok(!isAllowedUrl("http://arnav1771.github.io/x/a.vsix", HOSTS));
  assert.ok(!isAllowedUrl("https://evil.example/a.vsix", HOSTS));
  assert.ok(!isAllowedUrl("https://arnav1771.github.io.evil.example/a.vsix", HOSTS));
  assert.ok(!isAllowedUrl("https://someone.github.io/a.vsix", HOSTS));
  assert.ok(!isAllowedUrl("https://user:pw@arnav1771.github.io/a.vsix", HOSTS));
  assert.ok(!isAllowedUrl("https://arnav1771.github.io:8443/a.vsix", HOSTS));
  assert.ok(!isAllowedUrl("file:///C:/a.vsix", HOSTS));
  assert.ok(!isAllowedUrl("not a url", HOSTS));
});

test("parseLatest validates version, url and notes", () => {
  const ok = parseLatest('{"version":"1.2.3","url":"https://arnav1771.github.io/r/vscode/r-1.2.3.vsix","notes":"n"}', HOSTS);
  assert.deepEqual(ok, { version: "1.2.3", url: "https://arnav1771.github.io/r/vscode/r-1.2.3.vsix", notes: "n" });
  assert.equal(parseLatest('{"version":"1.2.3","url":"https://arnav1771.github.io/r.vsix"}', HOSTS).notes, "");
  assert.throws(() => parseLatest("<html>", HOSTS));
  assert.throws(() => parseLatest("null", HOSTS));
  assert.throws(() => parseLatest('{"version":"soon","url":"https://arnav1771.github.io/r.vsix"}', HOSTS));
  assert.throws(() => parseLatest('{"version":"1.2.3","url":"https://evil.example/r.vsix"}', HOSTS));
  assert.throws(() => parseLatest('{"version":"1.2.3","url":"https://arnav1771.github.io/r.exe"}', HOSTS));
  assert.throws(() => parseLatest('{"version":"1.2.3"}', HOSTS));
});
