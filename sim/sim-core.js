// The simulator's logic, kept free of the DOM so it can be tested in Node.
//
// It is a port of the real editor's code, not an imitation of it:
//   createCooldown, cooldownMsFromSecs  <- src/lib/cooldown.ts
//   LspSeverity, toMarkerSeverity,
//   hasErrorDiagnostic,
//   parsePublishDiagnostics             <- src/lib/diagnostics.ts
//   pipeline order                      <- src/components/LspBridge/index.tsx
// If those files change, change these.

export const DEFAULT_COOLDOWN_MS = 3000;

export function createCooldown(cooldownMs = DEFAULT_COOLDOWN_MS, options = {}) {
  const now = options.now ?? (() => Date.now());
  const window = Number.isFinite(cooldownMs) && cooldownMs > 0 ? cooldownMs : 0;
  let lastTrigger = null;
  return {
    tryTrigger() {
      const t = now();
      if (window === 0) {
        lastTrigger = t;
        return true;
      }
      if (lastTrigger !== null && t - lastTrigger < window) return false;
      lastTrigger = t;
      return true;
    },
    remainingMs() {
      if (window === 0 || lastTrigger === null) return 0;
      const elapsed = now() - lastTrigger;
      return elapsed >= window ? 0 : window - elapsed;
    },
    reset() {
      lastTrigger = null;
    },
    get windowMs() {
      return window;
    },
  };
}

export function cooldownMsFromSecs(secs) {
  if (secs === undefined || secs === null || !Number.isFinite(secs) || secs < 0) return DEFAULT_COOLDOWN_MS;
  return Math.round(secs * 1000);
}

export const MarkerSeverity = { Hint: 1, Info: 2, Warning: 4, Error: 8 };
export const LspSeverity = { Error: 1, Warning: 2, Information: 3, Hint: 4 };

export function toMarkerSeverity(severity) {
  switch (severity) {
    case LspSeverity.Warning: return MarkerSeverity.Warning;
    case LspSeverity.Information: return MarkerSeverity.Info;
    case LspSeverity.Hint: return MarkerSeverity.Hint;
    default: return MarkerSeverity.Error; // missing or unknown counts as Error, per LSP
  }
}

export function hasErrorDiagnostic(diagnostics) {
  return diagnostics.some((d) => toMarkerSeverity(d.severity) === MarkerSeverity.Error);
}

export function parsePublishDiagnostics(message) {
  if (typeof message !== "object" || message === null) return null;
  if (message.method !== "textDocument/publishDiagnostics") return null;
  const params = message.params;
  if (!params || typeof params.uri !== "string") return null;
  if (!Array.isArray(params.diagnostics)) return null;
  return params;
}

export function publishMessage(uri, diagnostics) {
  return { jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics } };
}

// One inbound LSP message, handled in LspBridge's order. Returns what happened
// and why, so the page can light up the stage where it stopped.
export function createPipeline({ cooldownMs = DEFAULT_COOLDOWN_MS, now } = {}) {
  let cooldown = createCooldown(cooldownMs, { now });
  const stats = { messages: 0, errorMessages: 0, played: 0, suppressed: 0 };
  return {
    stats,
    get cooldown() {
      return cooldown;
    },
    setCooldownMs(ms) {
      cooldown = createCooldown(ms, { now });
    },
    receive(raw) {
      let parsed = raw;
      if (typeof raw === "string") {
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          return { stage: "unparsed", reason: `not JSON: ${e.message}` };
        }
      }
      const params = parsePublishDiagnostics(parsed);
      if (!params) return { stage: "ignored", reason: "not a textDocument/publishDiagnostics notification" };
      stats.messages++;
      if (!hasErrorDiagnostic(params.diagnostics)) {
        const n = params.diagnostics.length;
        return { stage: "no-error", reason: n ? `${n} diagnostic${n > 1 ? "s" : ""}, none at error severity` : "no diagnostics - the file is clean", params };
      }
      stats.errorMessages++;
      if (!cooldown.tryTrigger()) {
        stats.suppressed++;
        return { stage: "cooled", reason: `cooling down - ${Math.ceil(cooldown.remainingMs() / 100) / 10}s left`, params };
      }
      stats.played++;
      return { stage: "fired", reason: "error diagnostic and the cooldown was ready", params };
    },
  };
}

// ---------- producing diagnostics from code, like a language server would ----------

const pos = (line, character) => ({ line, character });
const range = (l1, c1, l2, c2) => ({ start: pos(l1, c1), end: pos(l2, c2) });

// JavaScript: a real parser when one is available (acorn, loaded by the page),
// otherwise the engine's own parser via `new Function`, which parses but never
// runs the code. Style warnings come from acorn's tokenizer only.
export function diagnoseJs(code, acorn) {
  const out = [];
  if (acorn) {
    try {
      acorn.parse(code, { ecmaVersion: "latest", sourceType: "module", locations: true, allowHashBang: true });
    } catch (e) {
      const line = (e.loc?.line ?? 1) - 1;
      const col = e.loc?.column ?? 0;
      out.push({
        range: range(line, col, line, col + 1),
        severity: LspSeverity.Error,
        source: "acorn",
        message: String(e.message).replace(/\s*\(\d+:\d+\)$/, ""),
      });
      return out;
    }
    try {
      for (const t of acorn.tokenizer(code, { ecmaVersion: "latest", sourceType: "module", locations: true })) {
        const l = t.loc.start.line - 1;
        const c = t.loc.start.column;
        const end = t.loc.end.column;
        if (t.type.label === "==/!=/===/!==" && (t.value === "==" || t.value === "!=")) {
          out.push({ range: range(l, c, l, end), severity: LspSeverity.Warning, source: "fahh-lint",
            message: `Use '${t.value}=' - '${t.value}' converts types before comparing.` });
        } else if (t.type.keyword === "var") {
          out.push({ range: range(l, c, l, end), severity: LspSeverity.Warning, source: "fahh-lint",
            message: "Prefer 'let' or 'const' - 'var' is function-scoped." });
        } else if (t.type.keyword === "debugger") {
          out.push({ range: range(l, c, l, end), severity: LspSeverity.Warning, source: "fahh-lint",
            message: "A 'debugger' statement is left in the code." });
        }
      }
    } catch {
      /* the parse succeeded, so this cannot happen; warnings are best effort */
    }
    return out;
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function(code);
  } catch (e) {
    if (e instanceof SyntaxError) {
      out.push({ range: range(0, 0, 0, 1), severity: LspSeverity.Error, source: "browser", message: e.message });
    }
  }
  return out;
}

// Offset of the first character that makes `s` invalid JSON, or -1 if valid.
// A small strict scanner (RFC 8259), because engines disagree on whether -
// and how - their JSON.parse messages report a position.
export function firstBadOffset(s) {
  let i = 0;
  const fail = () => { throw i; };
  const ws = () => { while (i < s.length && " \t\n\r".includes(s[i])) i++; };
  const lit = (w) => { if (s.startsWith(w, i)) i += w.length; else fail(); };
  const str = () => {
    i++;
    while (i < s.length) {
      const c = s[i];
      if (c === '"') { i++; return; }
      if (c === "\\") {
        const e = s[i + 1];
        if (e === "u") { if (!/^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) { i++; fail(); } i += 6; }
        else if (e !== undefined && '"\\/bfnrt'.includes(e)) i += 2;
        else { i++; fail(); }
      } else if (c < " ") fail();
      else i++;
    }
    fail();
  };
  const num = () => {
    const re = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m || !m[0] || m[0] === "-") fail();
    i += m[0].length;
  };
  const value = () => {
    ws();
    const c = s[i];
    if (c === "{") {
      i++; ws();
      if (s[i] === "}") { i++; return; }
      for (;;) {
        ws();
        if (s[i] !== '"') fail();
        str(); ws();
        if (s[i] !== ":") fail();
        i++; value(); ws();
        if (s[i] === ",") { i++; continue; }
        if (s[i] === "}") { i++; return; }
        fail();
      }
    }
    if (c === "[") {
      i++; ws();
      if (s[i] === "]") { i++; return; }
      for (;;) {
        value(); ws();
        if (s[i] === ",") { i++; continue; }
        if (s[i] === "]") { i++; return; }
        fail();
      }
    }
    if (c === '"') return str();
    if (c === "t") return lit("true");
    if (c === "f") return lit("false");
    if (c === "n") return lit("null");
    if (c === "-" || (c >= "0" && c <= "9")) return num();
    fail();
  };
  try {
    value(); ws();
    if (i < s.length) fail();
    return -1;
  } catch (at) {
    if (typeof at !== "number") throw at;
    return Math.min(at, Math.max(0, s.length - 1));
  }
}

// JSON: the browser's own parser. Engines report the failure position in
// different ways, so read whichever the message offers.
export function diagnoseJson(text) {
  try {
    JSON.parse(text);
    return [];
  } catch (e) {
    if (text.trim() === "") {
      return [{ range: range(0, 0, 0, 0), severity: LspSeverity.Error, source: "json", message: "Empty document - expected a JSON value." }];
    }
    // The browser's message, our position (see firstBadOffset).
    const at = Math.max(0, firstBadOffset(text));
    const before = text.slice(0, at);
    const line = (before.match(/\n/g) || []).length;
    const col = before.length - before.lastIndexOf("\n") - 1;
    const msg = String(e.message).replace(/\s*in JSON at position \d+(\s*\(line \d+ column \d+\))?/i, "");
    return [{ range: range(line, col, line, col + 1), severity: LspSeverity.Error, source: "json", message: msg }];
  }
}
