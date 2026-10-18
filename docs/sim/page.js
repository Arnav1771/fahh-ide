// Home page behaviour: the simulator, plus the page's small animations.
import { createPipeline, publishMessage, diagnoseJs, diagnoseJson, cooldownMsFromSecs, LspSeverity } from "./sim-core.js";

const $ = (s) => document.querySelector(s);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const t0 = performance.now();

// ───────────────────────── sound ─────────────────────────
// Same approach as the app's src/lib/fahh.ts: decode once, play from memory.
const sound = {
  ctx: null,
  buffer: null,
  fallback: null,
  muted: false,
  state: "loading",
  async load() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error("no Web Audio");
      this.ctx = new Ctx();
      const res = await fetch("fahh.mp3");
      if (!res.ok) throw new Error(`fahh.mp3: HTTP ${res.status}`);
      const data = await res.arrayBuffer();
      this.buffer = await new Promise((ok, bad) => this.ctx.decodeAudioData(data, ok, bad));
      this.state = "ready";
    } catch {
      try {
        this.fallback = new Audio("fahh.mp3");
        this.fallback.preload = "auto";
        this.state = "fallback";
      } catch {
        this.state = "unavailable";
      }
    }
    renderSoundStatus();
  },
  unlock() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  },
  play() {
    if (this.muted) return "muted";
    if (this.buffer && this.ctx) {
      this.unlock();
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.connect(this.ctx.destination);
      src.start(0);
      return this.ctx.state === "running" ? "played" : "blocked";
    }
    if (this.fallback) {
      this.fallback.currentTime = 0;
      this.fallback.play().catch(() => {});
      return "played";
    }
    return "unavailable";
  },
};

function renderSoundStatus() {
  const el = $("#sound-status");
  if (!el) return;
  const text = el.querySelector(".status-text");
  el.classList.remove("ok", "bad");
  if (sound.state === "ready" || sound.state === "fallback") {
    el.classList.add("ok");
    text.textContent = "[SOUND READY]";
  } else if (sound.state === "unavailable") {
    el.classList.add("bad");
    text.textContent = "[SOUND UNAVAILABLE]";
  } else {
    text.textContent = "[CHECKING SOUND]";
  }
}

["pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, () => sound.unlock(), { passive: true }));

// ───────────────────────── simulator ─────────────────────────
const SAMPLES = {
  js: {
    uri: "file:///sim/main.js",
    clean: `// A tiny cart. Break it and listen.
const items = [
  { name: "keyboard", price: 49 },
  { name: "mouse", price: 19 },
];

function total(list) {
  return list.reduce((sum, item) => sum + item.price, 0);
}

console.log(\`total: \${total(items)}\`);
`,
    broken: `// A tiny cart. Break it and listen.
const items = [
  { name: "keyboard", price: 49 },
  { name: "mouse", price: 19 },
];

function total(list) {
  return list.reduce((sum, item) => sum + item.price, 0;
}

console.log(\`total: \${total(items)}\`);
`,
    warnings: `// Legal JavaScript, but a linter would complain.
var items = [49, 19];

function hasPrice(list, price) {
  debugger;
  return list.some((p) => p == price);
}

console.log(hasPrice(items, "49"));
`,
  },
  json: {
    uri: "file:///home/you/.fahh/config.json",
    clean: `{
  "sfx_cooldown_secs": 3,
  "theme": "fahh-gold",
  "installed_tools": ["gh"]
}
`,
    broken: `{
  "sfx_cooldown_secs": 3,
  "theme": "fahh-gold",
  "installed_tools": ["gh",]
}
`,
  },
};

const LSP_PRESETS = {
  pyright: {
    jsonrpc: "2.0", method: "textDocument/publishDiagnostics",
    params: { uri: "file:///home/you/app/main.py", diagnostics: [{
      range: { start: { line: 1, character: 42 }, end: { line: 1, character: 47 } },
      severity: 1, source: "Pyright", code: "reportUndefinedVariable", message: "\"itmes\" is not defined" }] },
  },
  warning: {
    jsonrpc: "2.0", method: "textDocument/publishDiagnostics",
    params: { uri: "file:///home/you/app/src/main.rs", diagnostics: [{
      range: { start: { line: 3, character: 8 }, end: { line: 3, character: 9 } },
      severity: 2, source: "rust-analyzer", code: "unused_variables", message: "unused variable: `x`" }] },
  },
  noseverity: {
    jsonrpc: "2.0", method: "textDocument/publishDiagnostics",
    params: { uri: "file:///home/you/app/lib.go", diagnostics: [{
      range: { start: { line: 0, character: 7 }, end: { line: 0, character: 12 } },
      source: "gopls", message: "could not import fmtt (no required module provides package \"fmtt\")" }] },
  },
  clear: {
    jsonrpc: "2.0", method: "textDocument/publishDiagnostics",
    params: { uri: "file:///home/you/app/main.py", diagnostics: [] },
  },
};

const sim = $("#sim");
if (sim) initSimulator();

function initSimulator() {
  const code = $("#sim-code");
  const gutter = $("#gutter");
  const pipe = createPipeline({ cooldownMs: 3000 });
  const state = {
    file: "js",
    text: { js: SAMPLES.js.clean, json: SAMPLES.json.clean, lsp: JSON.stringify(LSP_PRESETS.pyright, null, 2) },
    acorn: null,
    lastDiagnostics: [],
    storming: false,
  };
  let timer = 0;

  import("https://cdn.jsdelivr.net/npm/acorn@8.14.0/dist/acorn.mjs")
    .then((m) => { state.acorn = m; renderParser(); if (state.file === "js") check(); })
    .catch(() => renderParser());

  function renderParser() {
    const label = state.file === "js" ? (state.acorn ? "parser: acorn 8.14" : "parser: browser")
      : state.file === "json" ? "parser: JSON" : "raw JSON-RPC";
    $("#sim-parser").textContent = label;
  }

  function setFile(file) {
    state.text[state.file] = code.value;
    state.file = file;
    document.querySelectorAll(".sim-tabs [role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.file === file)));
    code.value = state.text[file];
    $("#lsp-bar").hidden = file !== "lsp";
    renderParser();
    if (file === "lsp") {
      state.lastDiagnostics = [];
      renderGutter();
      renderProblems([], "Edit the message, or pick a preset, then press Send to LspBridge.");
    } else {
      check();
    }
  }

  function diagnose() {
    const text = code.value;
    return state.file === "js" ? diagnoseJs(text, state.acorn) : diagnoseJson(text);
  }

  function check() {
    if (state.file === "lsp") return;
    const diagnostics = diagnose();
    state.lastDiagnostics = diagnostics;
    renderGutter();
    renderProblems(diagnostics);
    handle(publishMessage(SAMPLES[state.file].uri, diagnostics), `${state.file === "js" ? "main.js" : "config.json"}`);
  }

  function sendLsp() {
    const raw = code.value;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { /* the pipeline reports it */ }
    const diags = parsed?.params?.diagnostics;
    state.lastDiagnostics = [];
    renderGutter();
    renderProblems(Array.isArray(diags) ? diags : [], Array.isArray(diags) ? null : "Not a publishDiagnostics message.");
    handle(raw, "lsp message");
  }

  function handle(message, label) {
    const r = pipe.receive(message);
    const played = r.stage === "fired" ? sound.play() : null;
    renderPipeline(r, played);
    renderCounters();
    log(r, label, played);
    if (r.stage === "fired") celebrate();
    return r;
  }

  // ── rendering ──
  function renderGutter() {
    const lines = code.value.split("\n").length;
    const marks = new Map();
    for (const d of state.lastDiagnostics) {
      const line = d.range?.start?.line ?? 0;
      const sev = (d.severity ?? 1) === LspSeverity.Error ? "error" : d.severity === LspSeverity.Warning ? "warn" : "info";
      if (marks.get(line) !== "error") marks.set(line, sev);
    }
    const frag = document.createDocumentFragment();
    for (let i = 0; i < lines; i++) {
      const div = document.createElement("div");
      div.textContent = String(i + 1);
      const m = marks.get(i);
      if (m === "error") div.className = "has-error";
      else if (m === "warn") div.className = "has-warn";
      frag.append(div);
    }
    gutter.replaceChildren(frag);
    gutter.scrollTop = code.scrollTop;
  }

  function renderProblems(diags, emptyText) {
    const ul = $("#problems");
    $("#problem-count").textContent = String(diags.length);
    if (!diags.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = emptyText || "No problems. The server publishes an empty list, which clears the squiggles and plays nothing.";
      ul.replaceChildren(li);
      return;
    }
    ul.replaceChildren(...diags.map((d) => {
      const li = document.createElement("li");
      const sev = (d.severity ?? 1) === 1 ? "error" : d.severity === 2 ? "warn" : "info";
      const line = (d.range?.start?.line ?? 0) + 1;
      const col = (d.range?.start?.character ?? 0) + 1;
      const dot = document.createElement("span");
      dot.className = `sev ${sev}`;
      dot.setAttribute("aria-label", sev === "error" ? "error" : sev === "warn" ? "warning" : "information");
      const where = document.createElement("span");
      where.className = "where";
      where.textContent = `${line}:${col}`;
      const msg = document.createElement("span");
      msg.className = "msg";
      msg.textContent = d.message;
      if (d.source) {
        const src = document.createElement("span");
        src.className = "src";
        src.textContent = d.source;
        msg.append(src);
      }
      li.append(dot, where, msg);
      if (state.file !== "lsp") {
        li.tabIndex = 0;
        const go = () => jumpTo(d.range?.start?.line ?? 0, d.range?.start?.character ?? 0);
        li.addEventListener("click", go);
        li.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      }
      return li;
    }));
  }

  function jumpTo(line, ch) {
    const lines = code.value.split("\n");
    let offset = 0;
    for (let i = 0; i < line && i < lines.length; i++) offset += lines[i].length + 1;
    offset += Math.min(ch, (lines[line] || "").length);
    code.focus();
    code.setSelectionRange(offset, offset + 1);
  }

  function renderPipeline(r, played) {
    const stopAt = { unparsed: 0, ignored: 0, "no-error": 1, cooled: 2, fired: 3 }[r.stage];
    document.querySelectorAll("#pipeline li").forEach((li, i) => {
      li.classList.remove("pass", "stop", "fire");
      if (r.stage === "fired") li.classList.add(i === 3 ? "fire" : "pass");
      else if (i < stopAt) li.classList.add("pass");
      else if (i === stopAt) li.classList.add("stop");
    });
    let text;
    if (r.stage === "fired") {
      text = played === "muted" ? "Would have played - you muted it." :
        played === "blocked" ? "Fired, but your browser is still blocking sound. Click anywhere on the page, then try again." :
        played === "unavailable" ? "Fired, but this browser could not load the sound." : "Fahh. An error, and the cooldown was ready.";
    } else if (r.stage === "cooled") {
      text = `Held back: ${r.reason}.`;
    } else if (r.stage === "no-error") {
      text = `Silent: ${r.reason}.`;
    } else {
      text = `Ignored: ${r.reason}.`;
    }
    $("#verdict").textContent = text;
  }

  function renderCounters() {
    $("#c-messages").textContent = pipe.stats.messages;
    $("#c-errors").textContent = pipe.stats.errorMessages;
    $("#c-played").textContent = pipe.stats.played;
    $("#c-suppressed").textContent = pipe.stats.suppressed;
  }

  function log(r, label, played) {
    const li = document.createElement("li");
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = `+${((performance.now() - t0) / 1000).toFixed(1)}s`;
    li.className = r.stage === "fired" ? "fired" : r.stage === "cooled" ? "cooled" : "";
    const what = r.stage === "fired" ? (played === "muted" ? "fired (muted)" : "fahh") : r.stage === "cooled" ? "held back" : r.stage === "no-error" ? "silent" : "ignored";
    li.append(t, `${label} -> ${what}`);
    const ol = $("#log");
    ol.prepend(li);
    while (ol.children.length > 60) ol.lastChild.remove();
  }

  function celebrate() {
    if (reduceMotion) return;
    sim.classList.add("firing");
    const b = $("#burst");
    b.classList.remove("go");
    void b.offsetWidth;
    b.classList.add("go");
    setTimeout(() => sim.classList.remove("firing"), 650);
  }

  function tickCooldown() {
    const cd = pipe.cooldown;
    const win = cd.windowMs;
    const rem = cd.remainingMs();
    $("#cd-fill").style.width = win ? `${(rem / win) * 100}%` : "0%";
    const cdText = $("#cd-text");
    const next = win === 0 ? "off - every error plays" : rem > 0 ? `${(rem / 1000).toFixed(1)} s left of ${(win / 1000).toFixed(1)} s` : `ready · ${(win / 1000).toFixed(1)} s window`;
    if (cdText.textContent !== next) cdText.textContent = next;
    requestAnimationFrame(tickCooldown);
  }
  requestAnimationFrame(tickCooldown);

  // ── events ──
  code.addEventListener("input", () => {
    state.text[state.file] = code.value;
    renderGutter();
    if (state.file === "lsp") return;
    clearTimeout(timer);
    timer = setTimeout(check, 350); // a server publishes after a short pause, not per keystroke
  });
  code.addEventListener("scroll", () => { gutter.scrollTop = code.scrollTop; });
  document.querySelectorAll(".sim-tabs [role=tab]").forEach((b) => b.addEventListener("click", () => setFile(b.dataset.file)));
  $(".sim-tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = [...document.querySelectorAll(".sim-tabs [role=tab]")];
    const i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    n.focus();
    setFile(n.dataset.file);
  });

  $("#break").addEventListener("click", () => {
    if (state.file === "lsp") setFile("js");
    code.value = SAMPLES[state.file].broken;
    state.text[state.file] = code.value;
    check();
  });
  $("#fix").addEventListener("click", () => {
    if (state.file === "lsp") setFile("js");
    code.value = SAMPLES[state.file].clean;
    state.text[state.file] = code.value;
    check();
  });
  $("#warnings").addEventListener("click", () => {
    if (state.file !== "js") setFile("js");
    code.value = SAMPLES.js.warnings;
    state.text.js = code.value;
    check();
  });
  $("#send-lsp").addEventListener("click", sendLsp);
  document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
    code.value = JSON.stringify(LSP_PRESETS[b.dataset.preset], null, 2);
    state.text.lsp = code.value;
    renderGutter();
    sendLsp();
  }));

  $("#storm").addEventListener("click", async (e) => {
    if (state.storming) return;
    state.storming = true;
    const btn = e.currentTarget;
    btn.disabled = true;
    const before = pipe.stats.played;
    for (let i = 0; i < 40; i++) {
      handle(publishMessage("file:///sim/storm.ts", [{
        range: { start: { line: i, character: 0 }, end: { line: i, character: 6 } },
        severity: 1, source: "tsserver", message: `Cannot find name 'widget${i}'.`,
      }]), `storm ${i + 1}/40`);
      await new Promise((r) => setTimeout(r, 25));
    }
    const heard = pipe.stats.played - before;
    $("#verdict").textContent = `40 error messages in one second -> ${heard} sound${heard === 1 ? "" : "s"}. That is the cooldown doing its job.`;
    btn.disabled = false;
    state.storming = false;
  });

  $("#cooldown").addEventListener("change", (e) => {
    const secs = Number(e.target.value);
    pipe.setCooldownMs(cooldownMsFromSecs(secs));
    const li = document.createElement("li");
    li.textContent = `sfx_cooldown_secs = ${secs}`;
    $("#log").prepend(li);
  });
  $("#mute").addEventListener("click", (e) => {
    sound.muted = !sound.muted;
    e.currentTarget.setAttribute("aria-pressed", String(sound.muted));
    e.currentTarget.textContent = sound.muted ? "Unmute" : "Mute";
  });
  $("#soundcheck").addEventListener("click", () => {
    const wasMuted = sound.muted;
    sound.muted = false;
    const r = sound.play();
    sound.muted = wasMuted;
    $("#verdict").textContent = r === "played" ? "Sound check: that is the sound. The simulator plays it only when the rule says so."
      : r === "blocked" ? "Your browser is still blocking sound. Click the page once, then try again."
      : "This browser could not load the sound.";
  });

  code.value = state.text.js;
  renderParser();
  renderGutter();
  renderProblems([]);
  // The first check is silent: a clean file publishes an empty list.
  check();
}

// ───────────────────────── page ─────────────────────────
const nav = $("#nav");
const onScroll = () => nav && nav.classList.toggle("scrolled", window.scrollY > 12);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

const io = new IntersectionObserver((entries) => entries.forEach((x) => {
  if (!x.isIntersecting) return;
  setTimeout(() => x.target.classList.add("visible"), Number(x.target.dataset.delay || 0));
  io.unobserve(x.target);
}), { threshold: 0.08 });
document.querySelectorAll(".reveal").forEach((el) => {
  const sibs = [...el.parentElement.children].filter((c) => c.classList.contains("reveal"));
  if (!el.dataset.delay) el.dataset.delay = String(Math.min(sibs.indexOf(el), 6) * 90);
  io.observe(el);
});

if (!reduceMotion) {
  document.querySelectorAll("[data-countup]").forEach((el) => {
    // The real number stays in the markup until the animation starts, so a
    // visitor who never scrolls here (or a crawler, or a printout) sees it.
    const target = Number(el.dataset.countup);
    new IntersectionObserver(([e], obs) => {
      if (!e.isIntersecting) return;
      obs.disconnect();
      el.textContent = "0";
      const s = performance.now();
      const tick = (n) => {
        const p = Math.min((n - s) / 1800, 1);
        el.textContent = String(Math.floor((1 - Math.pow(1 - p, 3)) * target));
        if (p < 1) requestAnimationFrame(tick); else el.textContent = String(target);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.4 }).observe(el);
  });

  const cw = $(".cycle");
  if (cw) {
    const words = ["hear it.", "know it.", "regret it."];
    let idx = 0;
    cw.closest("h1").setAttribute("aria-label", "Your code broke. You'll hear it.");
    setInterval(() => {
      cw.style.cssText = "opacity:0;transform:translateY(-8px);transition:opacity 300ms ease,transform 300ms ease";
      setTimeout(() => {
        idx = (idx + 1) % words.length;
        cw.textContent = words[idx];
        cw.style.cssText = "opacity:0;transform:translateY(10px);transition:none";
        requestAnimationFrame(() => { cw.style.cssText = "opacity:1;transform:none;transition:opacity 350ms ease,transform 350ms ease"; });
      }, 320);
    }, 2600);
  }
}

// Highlight the download for this visitor's system.
const ua = navigator.userAgent;
const os = /Windows/i.test(ua) ? "windows" : /Mac OS X|Macintosh/i.test(ua) && !/iPhone|iPad/.test(ua) ? "mac" : /Linux/i.test(ua) && !/Android/i.test(ua) ? "linux" : null;
if (os) document.querySelector(`.dl[data-os="${os}"]`)?.classList.add("featured");

// Background texture for the numbers section: the sound's own bytes, as hex.
const bin = $("#binary");
if (bin) {
  fetch("fahh.mp3").then((r) => r.arrayBuffer()).then((buf) => {
    const bytes = new Uint8Array(buf, 0, Math.min(buf.byteLength, 2400));
    bin.textContent = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
  }).catch(() => {});
}

sound.load();
