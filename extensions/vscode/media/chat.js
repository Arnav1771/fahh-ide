// The chat view: renders agent events, the slash-command popup, the mode menu and the empty
// state. Everything it shows comes from the extension (state) or the agent (events).
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const log = $("log"), form = $("composer"), input = $("input"), send = $("send"), stop = $("stop");
  const modeBtn = $("mode"), modelBtn = $("model"), slashBox = $("slash"), modesBox = $("modes");
  const activity = $("activity"), activityText = $("activity-text");

  let state = { slash: [], modes: [], starters: [], mode: "normal", model: "", provider: "", providerLabel: "", key: "none-needed", folder: null, agentFound: true };
  let busy = false, waiting = false, turnStart = 0, toolCount = 0, ticker = 0;
  let reply = null, replyText = "", queued = false;
  const tools = new Map();

  // ─── small helpers ──────────────────────────────────────────────────────────
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  };
  // constant SVG strings only; nothing from the agent goes through innerHTML
  const ICONS = {
    send: '<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/>',
    stop: '<rect x="4.5" y="4.5" width="7" height="7" rx="1" fill="currentColor" stroke="none"/>',
    copy: '<rect x="5.5" y="5.5" width="7.5" height="8" rx="1.2"/><path d="M3 10.5V3.8C3 3.3 3.3 3 3.8 3h6.7"/>',
    check: '<path d="M3 8.5 6.5 12 13 4.5"/>',
    chevron: '<path d="M4.5 6.5 8 10l3.5-3.5"/>',
    arrow: '<path d="M3 8h9.5M9 4.5 12.5 8 9 11.5"/>',
    file: '<path d="M4 2.5h5l3 3v8H4z"/><path d="M9 2.5v3h3"/>',
    warn: '<path d="M8 2.5 14 13H2z"/><path d="M8 6.5v3M8 11.2v.3"/>',
    shield: '<path d="M8 2 13 4v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z"/>',
    mark: '<rect x="2.5" y="5" width="11" height="8.5" rx="2.2"/><path d="M8 2.2V5"/><circle cx="6" cy="9.2" r=".9" fill="currentColor"/><circle cx="10" cy="9.2" r=".9" fill="currentColor"/>',
  };
  const icon = (name, cls) => {
    const s = el("span", "ic" + (cls ? " " + cls : ""));
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
    return s;
  };
  const btn = (label, cls, onclick, title) => {
    const b = el("button", cls, label);
    b.type = "button";
    if (title) b.title = title;
    b.onclick = onclick;
    return b;
  };
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  const add = (node, parent = log) => {
    const stick = nearBottom();
    parent.appendChild(node);
    if (stick) log.scrollTop = log.scrollHeight;
    return node;
  };
  const one = (s, n = 200) => {
    s = String(s ?? "").split("\n")[0];
    return s.length > n ? s.slice(0, n) + "…" : s;
  };
  const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n… ${s.length - n} more characters` : s);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const modeOf = (id) => state.modes.find((m) => m.id === id);

  // ─── markdown (built as DOM nodes, so agent text is never parsed as HTML) ───
  const INLINE = /(`+)([^`][\s\S]*?)\1(?!`)|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|(?<![\w_])_([^_\s][^_]*?)_(?![\w_])/g;
  function inline(text, node) {
    let last = 0;
    for (const m of text.matchAll(INLINE)) {
      node.append(text.slice(last, m.index));
      if (m[1]) node.append(el("code", "", m[2]));
      else if (m[3]) inline(m[3], node.appendChild(el("strong")));
      else if (m[4]) {
        const a = el("a", "", m[4]);
        a.href = m[5];
        node.append(a);
      } else inline(m[6] || m[7], node.appendChild(el("em")));
      last = m.index + m[0].length;
    }
    node.append(text.slice(last));
  }
  function codeBlock(code, lang) {
    const wrap = el("div", "code");
    const head = wrap.appendChild(el("div", "code-head"));
    head.append(el("span", "lang", lang || "text"));
    const copy = btn("", "ghost copy", () => {
      vscode.postMessage({ type: "copy", text: code });
      copy.replaceChildren(icon("check"), "Copied");
      setTimeout(() => copy.replaceChildren(icon("copy"), "Copy"), 1400);
    }, "Copy code");
    copy.append(icon("copy"), "Copy");
    head.append(copy);
    wrap.appendChild(el("pre")).appendChild(el("code", "", code));
    return wrap;
  }
  function markdown(text, root) {
    root.replaceChildren();
    const lines = text.split("\n");
    let para = [], list = null, i = 0;
    const flush = () => {
      if (para.length) inline(para.join("\n"), root.appendChild(el("p")));
      para = [];
    };
    while (i < lines.length) {
      const line = lines[i];
      const fence = /^\s*(```+|~~~+)\s*([\w+#.-]*)/.exec(line);
      if (fence) {
        flush();
        list = null;
        const code = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
        i++;
        root.append(codeBlock(code.join("\n"), fence[2]));
        continue;
      }
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (h) {
        flush();
        list = null;
        inline(h[2], root.appendChild(el("div", "h h" + Math.min(h[1].length, 3))));
      } else if (li) {
        flush();
        const ordered = /\d/.test(li[1]);
        if (!list || list.dataset.ordered !== String(ordered)) {
          list = root.appendChild(el(ordered ? "ol" : "ul"));
          list.dataset.ordered = String(ordered);
          if (ordered) list.start = parseInt(li[1], 10) || 1;
        }
        inline(li[2], list.appendChild(el("li")));
      } else if (/^\s*\|/.test(line)) {
        flush();
        list = null;
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++].trim());
        root.append(el("pre", "table", rows.join("\n")));
        continue;
      } else if (/^\s*>/.test(line)) {
        flush();
        list = null;
        inline(line.replace(/^\s*>\s?/, ""), root.appendChild(el("blockquote")));
      } else if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
        flush();
        list = null;
        root.append(el("hr"));
      } else if (!line.trim()) {
        flush();
        if (!/^\s*([-*+]|\d+[.)])\s/.test(lines[i + 1] ?? "")) list = null;
      } else if (list && /^\s{2,}\S/.test(line)) {
        inline(" " + line.trim(), list.lastElementChild);
      } else {
        list = null;
        para.push(line);
      }
      i++;
    }
    flush();
  }
  function renderReply() {
    queued = false;
    if (!reply) return;
    const stick = nearBottom();
    markdown(replyText, reply);
    if (stick) log.scrollTop = log.scrollHeight;
  }
  // a reply ends at a tool call, an approval or the end of the turn: draw what is pending first
  function endReply() {
    renderReply();
    reply = null;
  }

  // ─── the composer bar ───────────────────────────────────────────────────────
  send.append(icon("send"));
  stop.append(icon("stop"));
  function paintBar() {
    const m = modeOf(state.mode);
    modeBtn.replaceChildren(icon(m && m.warn ? "warn" : "shield"), el("span", "", m ? m.label : state.mode), icon("chevron", "chev"));
    modeBtn.classList.toggle("warn", !!(m && m.warn));
    const missing = !state.model && state.provider !== "mock";
    modelBtn.replaceChildren(el("span", "prov", state.providerLabel), el("span", "sep", "/"), el("span", "mdl", missing ? "choose a model" : state.model || "scripted"));
    modelBtn.classList.toggle("attention", missing || state.key === "missing");
    modelBtn.title = `${state.providerLabel}${state.model ? " / " + state.model : ""}. Click to change (/model, /provider)`;
  }
  function setBusy(b) {
    busy = b;
    waiting = false;
    send.hidden = b;
    stop.hidden = !b;
    activity.hidden = !b;
    clearInterval(ticker);
    if (b) {
      turnStart = Date.now();
      toolCount = 0;
      ticker = setInterval(paintActivity, 1000);
      paintActivity();
    }
  }
  function paintActivity() {
    const s = Math.round((Date.now() - turnStart) / 1000);
    activity.classList.toggle("waiting", waiting);
    activityText.textContent = (waiting ? "Waiting for your answer" : "Working") + ` · ${s}s` + (toolCount ? ` · ${plural(toolCount, "tool call")}` : "");
  }

  // ─── empty state ─────────────────────────────────────────────────────────────
  const hasConversation = () => !!log.querySelector(".msg, .tool, .approval, .card");
  function renderEmpty() {
    log.querySelector(".empty")?.remove();
    if (hasConversation()) return;
    const e = el("section", "empty");
    const hero = e.appendChild(el("div", "hero"));
    hero.append(icon("mark", "logo"));
    hero.append(el("h1", "", "Fahh Local"));
    const p = hero.appendChild(el("p"));
    if (state.folder) p.append("Reads, edits and runs things in ", el("strong", "", state.folder), ". It shows you every edit and command first, unless you pick a mode that doesn't.");
    else p.append("A coding agent for the open folder. It shows you every edit and command first.");

    if (!state.agentFound) {
      const c = e.appendChild(el("div", "callout warn"));
      c.append(icon("warn"), el("span", "", "Fahh Editor isn't installed. This extension runs its agent."));
      c.append(btn("Download", "link", () => vscode.postMessage({ type: "download" })));
    }
    if (!state.folder) {
      const c = e.appendChild(el("div", "callout"));
      c.append(el("span", "", "Open a folder to start."));
      c.append(btn("Open folder", "link", () => vscode.postMessage({ type: "openFolder" })));
    } else if (state.starters.length) {
      e.append(el("div", "label", "Start with"));
      const list = e.appendChild(el("div", "starters"));
      for (const s of state.starters) {
        const b = btn("", "starter", () => submit(s));
        b.append(el("span", "", s), icon("arrow"));
        list.append(b);
      }
    }

    e.append(el("div", "label", "Setup"));
    const dl = e.appendChild(el("div", "setup"));
    const row = (k, v, action, attention) => {
      const r = dl.appendChild(el("div", "row" + (attention ? " attention" : "")));
      r.append(el("span", "k", k), el("span", "v", v));
      if (action) r.append(btn(action[0], "link", action[1]));
    };
    row("Provider", state.providerLabel, ["Change", () => vscode.postMessage({ type: "pickProvider" })]);
    const missing = !state.model && state.provider !== "mock";
    row("Model", missing ? "not chosen" : state.model || "scripted", ["Choose", () => vscode.postMessage({ type: "pickModel" })], missing);
    if (state.key !== "none-needed") {
      const v = { stored: "saved in VS Code", env: "from the environment", missing: "missing" }[state.key];
      row("API key", v, [state.key === "missing" ? "Add" : "Change", () => vscode.postMessage({ type: "setKey" })], state.key === "missing");
    }
    const m = modeOf(state.mode);
    row("Mode", m ? `${m.label}: ${m.desc}` : state.mode, ["Change", () => openModes()], !!(m && m.warn));
    const hint = e.appendChild(el("p", "hint"));
    hint.append(el("kbd", "", "/"), " commands  ", el("kbd", "", "Enter"), " send  ", el("kbd", "", "Shift+Enter"), " new line");
    log.prepend(e);
  }

  // ─── agent events ────────────────────────────────────────────────────────────
  function argSummary(args) {
    if (!args || typeof args !== "object") return "";
    for (const k of ["path", "command", "pattern", "query", "url", "file", "dir", "name", "task"]) if (typeof args[k] === "string") return args[k];
    const first = Object.values(args).find((v) => typeof v === "string");
    return first || "";
  }
  function fileChip(p) {
    const prev = log.lastElementChild;
    const row = prev && prev.classList.contains("files") ? prev : add(el("div", "files"));
    const b = btn("", "file-chip", () => vscode.postMessage({ type: "openFile", text: p }), `Open ${p}`);
    b.append(icon("file"), el("span", "", p.split(/[\\/]/).pop()));
    add(b, row);
  }
  function approval(ev, who) {
    waiting = true;
    paintActivity();
    const card = add(el("div", "approval"));
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", "Approval needed");
    const head = card.appendChild(el("div", "ap-head"));
    head.append(icon("shield"), el("span", "", (who ? `[${who}] ` : "") + String(ev.summary || ev.tool).replace(/\\\\\?\\/g, "")));
    if (ev.path && !ev.command) {
      const p = btn(ev.path, "link path", () => vscode.postMessage({ type: "openFile", text: ev.path }));
      card.append(p);
    }
    let cmdBox = null;
    if (ev.command) {
      card.append(el("pre", "cmd", "$ " + ev.command));
    } else if (ev.old_text || ev.new_text) {
      const pre = card.appendChild(el("pre", "diff"));
      const part = (text, cls, sign) => {
        const ls = String(text || "").split("\n");
        if (ls[ls.length - 1] === "") ls.pop();
        ls.slice(0, 80).forEach((l) => pre.append(el("div", cls, sign + " " + l)));
        if (ls.length > 80) pre.append(el("div", "more", `… ${ls.length - 80} more lines`));
      };
      part(ev.old_text, "del", "-");
      part(ev.new_text, "ins", "+");
    }
    const row = card.appendChild(el("div", "ap-actions"));
    const answer = (allow, always, command) => {
      vscode.postMessage({ type: "approve", allow, always, command });
      waiting = false;
      paintActivity();
      card.classList.add(allow ? "allowed" : "denied");
      row.replaceWith(el("div", "ap-answer", allow ? (always ? "Allowed, and remembered" : command ? "Allowed with your edit" : "Allowed") : "Denied"));
      cmdBox?.setAttribute("readonly", "");
      input.focus();
    };
    const yes = row.appendChild(btn("Allow", "primary", () => answer(true, false, cmdBox ? cmdBox.value.trim() : undefined)));
    row.append(btn("Always", "secondary", () => answer(true, true), "Allow, and remember this rule in your own app data"));
    if (ev.tool === "run_command" && ev.command) {
      const edit = row.appendChild(btn("Edit", "secondary", () => {
        cmdBox = el("textarea", "cmd-edit");
        cmdBox.value = ev.command;
        cmdBox.rows = Math.min(6, ev.command.split("\n").length + 1);
        cmdBox.setAttribute("aria-label", "Command to run");
        card.querySelector(".cmd").replaceWith(cmdBox);
        yes.textContent = "Run edited";
        edit.remove();
        cmdBox.focus();
      }));
    }
    row.append(btn("Deny", "secondary", () => answer(false, false)));
    yes.focus({ preventScroll: true });
    log.scrollTop = log.scrollHeight;
  }
  function onEvent(ev, who) {
    switch (ev.type) {
      case "text_delta": {
        if (who) return; // a subagent's prose is its own; the parent gets its summary
        if (!reply) {
          const msg = add(el("div", "msg assistant"));
          reply = msg.appendChild(el("div", "md"));
          replyText = "";
        }
        replyText += ev.text;
        if (!queued) {
          queued = true;
          requestAnimationFrame(renderReply);
        }
        return;
      }
      case "tool_call": {
        endReply();
        toolCount++;
        const d = add(el("details", "tool running" + (who ? " sub" : "")));
        const s = d.appendChild(el("summary"));
        s.append(el("span", "dot"), el("span", "tname", ev.name));
        if (who) s.append(el("span", "who", who));
        const a = argSummary(ev.args);
        s.append(el("span", "targ", a), el("span", "tdur"));
        if (a) s.title = a;
        const body = d.appendChild(el("div", "tbody"));
        if (ev.args && Object.keys(ev.args).length) {
          body.append(el("div", "tlabel", "Input"), el("pre", "", clip(JSON.stringify(ev.args, null, 2), 4000)));
        }
        tools.set(ev.id, d);
        return;
      }
      case "tool_result": {
        const d = tools.get(ev.id);
        if (!d) return;
        d.classList.remove("running");
        d.classList.add(ev.ok ? "ok" : "failed");
        if (ev.elapsed_ms != null) d.querySelector(".tdur").textContent = ev.elapsed_ms < 1000 ? `${ev.elapsed_ms}ms` : `${(ev.elapsed_ms / 1000).toFixed(1)}s`;
        if (!ev.ok) d.querySelector("summary").append(el("span", "terr", one(ev.output, 160)));
        const body = d.querySelector(".tbody");
        body.append(el("div", "tlabel", ev.ok ? "Output" : "Error"), el("pre", "", clip(String(ev.output ?? ""), 8000) || "(no output)"));
        return;
      }
      case "approval_request":
        endReply();
        return approval(ev, who);
      case "file_changed":
        return fileChip(ev.path);
      case "plan_written": {
        endReply();
        const c = add(el("div", "card plan"));
        c.append(el("div", "card-title", "Plan ready"));
        const det = c.appendChild(el("details"));
        det.append(el("summary", "", ev.path));
        markdown(ev.markdown || "", det.appendChild(el("div", "md")));
        const row = c.appendChild(el("div", "ap-actions"));
        row.append(btn("Implement it", "primary", () => submit(`Implement the approved plan in ${ev.path}, step by step.`, "normal")));
        row.append(btn("Open plan", "secondary", () => vscode.postMessage({ type: "openFile", text: ev.path })));
        return;
      }
      case "judge":
        add(el("div", "line " + (ev.safe ? "" : "warn"), `Judge: ${ev.safe ? "safe" : "unsafe"} · ${one(ev.command, 60)} · ${one(ev.reason, 120)}`));
        return;
      case "sub_started":
        endReply();
        add(el("div", "line sub-line", `${ev.name} agent started: ${one(ev.task, 140)}`));
        return;
      case "sub_done":
        add(el("div", "line sub-line", `${ev.name} agent ${ev.ok ? "finished" : "failed"} in ${plural(ev.steps, "step")}: ${one(ev.summary, 160)}`));
        return;
      case "sub":
        return onEvent(ev.event, ev.name);
      case "loop_round":
        add(el("div", "line", `Review round ${ev.round}/${ev.max}: ${ev.approved ? "approved" : "changes requested: " + one(ev.notes, 140)}`));
        return;
      case "compacted":
        add(el("div", "line", `Context compacted: ~${ev.before} to ~${ev.after} tokens`));
        return;
      case "notice":
        add(el("div", "line", ev.text));
        return;
      case "error":
        endReply();
        add(el("div", "error", ev.message));
        return;
      case "done": {
        if (who) return;
        endReply();
        const secs = Math.round((Date.now() - turnStart) / 1000);
        const files = ev.files || [];
        add(el("div", "done", `Done · ${plural(ev.steps, "step")}${files.length ? ` · ${plural(files.length, "file")} changed` : ""} · ${secs}s`));
        return;
      }
    }
  }

  function help() {
    const c = add(el("div", "card help"));
    c.append(el("div", "card-title", "Commands"));
    const t = c.appendChild(el("div", "help-list"));
    for (const s of state.slash) {
      const r = t.appendChild(el("button", "help-row"));
      r.type = "button";
      r.onclick = () => {
        input.value = "/" + s.name + (s.args ? " " : "");
        input.focus();
        updateSlash();
      };
      r.append(el("code", "", "/" + s.name + (s.args ? " " + s.args : "")), el("span", "", s.desc));
    }
    c.append(el("div", "card-title", "Keys"));
    const k = c.appendChild(el("p", "hint"));
    k.append(el("kbd", "", "Enter"), " send  ", el("kbd", "", "Shift+Enter"), " new line  ", el("kbd", "", "↑ ↓"), " move in a menu  ", el("kbd", "", "Tab"), " complete a command  ", el("kbd", "", "Esc"), " close");
  }

  // ─── slash popup ─────────────────────────────────────────────────────────────
  let slashItems = [], slashIdx = 0;
  // same rule as filterSlash in src/protocol.ts
  const filterSlash = (q) => {
    q = q.toLowerCase();
    const starts = state.slash.filter((c) => c.name.startsWith(q));
    return [...starts, ...state.slash.filter((c) => !c.name.startsWith(q) && (c.name.includes(q) || c.desc.toLowerCase().includes(q)))];
  };
  function hideSlash() {
    slashBox.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
  function updateSlash() {
    const m = /^\/(\S*)$/.exec(input.value);
    slashItems = m ? filterSlash(m[1]) : [];
    if (!slashItems.length) return hideSlash();
    slashIdx = Math.max(0, Math.min(slashIdx, slashItems.length - 1));
    slashBox.replaceChildren();
    slashItems.forEach((c, i) => {
      const o = slashBox.appendChild(el("div", "opt"));
      o.id = "slash-" + i;
      o.setAttribute("role", "option");
      o.setAttribute("aria-selected", String(i === slashIdx));
      o.append(el("span", "name", "/" + c.name), el("span", "args", c.args || ""), el("span", "desc", c.desc));
      o.onmousedown = (e) => e.preventDefault();
      o.onclick = () => chooseSlash(i, false);
      o.onmousemove = () => {
        if (slashIdx !== i) {
          slashIdx = i;
          updateSlash();
        }
      };
    });
    slashBox.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-activedescendant", "slash-" + slashIdx);
    slashBox.children[slashIdx]?.scrollIntoView({ block: "nearest" });
  }
  function chooseSlash(i, complete) {
    const c = slashItems[i];
    if (!c) return;
    // Tab, or a command whose argument is required, fills the input; otherwise it runs
    if (complete || (c.args && c.args.startsWith("<"))) {
      input.value = "/" + c.name + (c.args ? " " : "");
      hideSlash();
      input.focus();
      autoGrow();
    } else submit("/" + c.name);
  }

  // ─── mode menu ───────────────────────────────────────────────────────────────
  function openModes() {
    modesBox.replaceChildren();
    state.modes.forEach((m) => {
      const o = modesBox.appendChild(el("div", "opt" + (m.warn ? " warn" : "")));
      o.setAttribute("role", "option");
      o.tabIndex = -1;
      o.dataset.id = m.id;
      o.setAttribute("aria-selected", String(m.id === state.mode));
      const top = o.appendChild(el("div", "top"));
      top.append(el("span", "name", m.label));
      if (m.id === state.mode) top.append(icon("check", "cur"));
      o.append(el("div", "desc", m.desc));
      o.onclick = () => pickMode(m.id);
    });
    modesBox.hidden = false;
    modeBtn.setAttribute("aria-expanded", "true");
    (modesBox.querySelector('[aria-selected="true"]') || modesBox.firstElementChild).focus();
  }
  function closeModes(refocus) {
    if (modesBox.hidden) return;
    modesBox.hidden = true;
    modeBtn.setAttribute("aria-expanded", "false");
    if (refocus) modeBtn.focus();
  }
  function pickMode(id) {
    vscode.postMessage({ type: "setMode", mode: id });
    state.mode = id; // the extension confirms with a state message
    paintBar();
    closeModes(false);
    input.focus();
  }
  modesBox.addEventListener("keydown", (e) => {
    const opts = [...modesBox.children];
    const i = opts.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      opts[(i + (e.key === "ArrowDown" ? 1 : opts.length - 1)) % opts.length].focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (i >= 0) pickMode(opts[i].dataset.id);
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      closeModes(true);
    }
  });
  modeBtn.addEventListener("click", () => (modesBox.hidden ? openModes() : closeModes(true)));
  document.addEventListener("mousedown", (e) => {
    if (!modesBox.hidden && !modesBox.contains(e.target) && !modeBtn.contains(e.target)) closeModes(false);
  });
  modelBtn.addEventListener("click", () => vscode.postMessage({ type: "pickModel" }));

  // ─── sending ─────────────────────────────────────────────────────────────────
  function submit(text, mode) {
    text = text.trim();
    if (!text) return;
    if (busy && !text.startsWith("/")) return;
    vscode.postMessage({ type: "prompt", text, mode: mode || state.mode });
    input.value = "";
    hideSlash();
    autoGrow();
  }
  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 220) + "px";
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit(input.value);
  });
  input.addEventListener("input", () => {
    slashIdx = 0;
    updateSlash();
    autoGrow();
  });
  input.addEventListener("keydown", (e) => {
    if (!slashBox.hidden) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        slashIdx = (slashIdx + (e.key === "ArrowDown" ? 1 : slashItems.length - 1)) % slashItems.length;
        return updateSlash();
      }
      if (e.key === "Tab") {
        e.preventDefault();
        return chooseSlash(slashIdx, true);
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        return chooseSlash(slashIdx, false);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        return hideSlash();
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit(input.value);
    }
  });
  input.addEventListener("blur", () => setTimeout(hideSlash, 100));
  stop.addEventListener("click", () => vscode.postMessage({ type: "stop" }));

  // ─── messages from the extension ─────────────────────────────────────────────
  window.addEventListener("message", (e) => {
    const m = e.data;
    switch (m.type) {
      case "state":
        state = m;
        paintBar();
        if (!busy) renderEmpty();
        return;
      case "openMode":
        return openModes();
      case "help":
        log.querySelector(".empty")?.remove();
        return help();
      case "user": {
        log.querySelector(".empty")?.remove();
        const u = add(el("div", "msg user"));
        if (m.mode && m.mode !== "normal") u.append(el("span", "tag", m.mode === "qa" ? "ask" : m.mode));
        u.append(el("div", "text", m.text));
        endReply();
        setBusy(true);
        log.scrollTop = log.scrollHeight;
        return;
      }
      case "event":
        return onEvent(m.event);
      case "turn_end":
        endReply();
        setBusy(false);
        return;
      case "error":
        add(el("div", "error", m.message));
        if (busy) setBusy(false);
        return;
      case "notice":
        add(el("div", "line", m.text));
        if (busy && /^Stopped/.test(m.text)) setBusy(false);
        return;
      case "log":
        add(el("div", "line mono", m.text));
        return;
      case "resumed": {
        log.replaceChildren();
        setBusy(false);
        const c = add(el("div", "card"));
        c.append(el("div", "card-title", "Resumed " + (m.title ? `“${m.title}”` : m.id)));
        c.append(el("p", "hint", `${m.steps != null ? plural(m.steps, "step") + ". " : ""}Earlier messages aren't shown here, but the agent still has them. Your next message continues the session.`));
        return;
      }
      case "cleared":
        log.replaceChildren();
        tools.clear();
        endReply();
        setBusy(false);
        renderEmpty();
        if (m.keep) add(el("div", "line", "View cleared. The session continues; /new starts a fresh one."));
        return;
    }
  });
  vscode.postMessage({ type: "ready" });
})();
