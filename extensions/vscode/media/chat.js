// The chat view: renders agent events and sends prompts and approval answers to the extension.
(function () {
  const vscode = acquireVsCodeApi();
  const log = document.getElementById("log");
  const form = document.getElementById("composer");
  const input = document.getElementById("input");
  const mode = document.getElementById("mode");
  const send = document.getElementById("send");
  const stop = document.getElementById("stop");
  const status = document.getElementById("status");
  let reply = null; // the assistant bubble being streamed into
  const tools = new Map(); // tool call id -> its line

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const add = (node) => {
    log.appendChild(node);
    log.scrollTop = log.scrollHeight;
    return node;
  };
  const setBusy = (b) => {
    send.disabled = b;
    stop.hidden = !b;
    status.textContent = b ? "Working…" : "";
    status.className = b ? "working" : "";
  };
  const empty = () => {
    if (log.children.length) return;
    const e = add(el("div", "empty"));
    e.appendChild(el("h2", "", "Fahh Local"));
    e.appendChild(el("p", "", "Ask it to read, change or run something in this workspace. It asks before every edit and command unless you pick another mode."));
  };

  function onEvent(ev) {
    switch (ev.type) {
      case "text_delta":
        if (!reply) reply = add(el("div", "msg assistant"));
        reply.textContent += ev.text;
        log.scrollTop = log.scrollHeight;
        return;
      case "tool_call": {
        reply = null;
        const arg = ev.args && (ev.args.path || ev.args.command || ev.args.pattern || ev.args.query || "");
        const line = add(el("div", "tool running", `${ev.name} ${arg}`));
        tools.set(ev.id, line);
        return;
      }
      case "tool_result": {
        const line = tools.get(ev.id);
        if (line) {
          line.classList.remove("running");
          line.classList.add(ev.ok ? "ok" : "failed");
          if (!ev.ok) line.title = ev.output;
        }
        return;
      }
      case "file_changed": {
        const a = add(el("button", "file", `changed ${ev.path}`));
        a.onclick = () => vscode.postMessage({ type: "openFile", text: ev.path });
        return;
      }
      case "approval_request": {
        reply = null;
        const card = add(el("div", "approval"));
        card.appendChild(el("div", "title", ev.summary));
        if (ev.command) card.appendChild(el("pre", "", "$ " + ev.command));
        else if (ev.new_text || ev.old_text) {
          const pre = el("pre", "diff");
          for (const l of (ev.old_text || "").split("\n").slice(0, 12)) if (l) pre.appendChild(el("div", "del", "- " + l));
          for (const l of (ev.new_text || "").split("\n").slice(0, 12)) if (l) pre.appendChild(el("div", "ins", "+ " + l));
          card.appendChild(pre);
        }
        const row = card.appendChild(el("div", "row"));
        const answer = (allow, always) => {
          vscode.postMessage({ type: "approve", allow, always });
          row.replaceWith(el("div", "answered", allow ? (always ? "Allowed (always)" : "Allowed") : "Denied"));
        };
        const yes = row.appendChild(el("button", "", "Allow"));
        yes.onclick = () => answer(true, false);
        const always = row.appendChild(el("button", "secondary", "Always"));
        always.onclick = () => answer(true, true);
        const no = row.appendChild(el("button", "secondary", "Deny"));
        no.onclick = () => answer(false, false);
        yes.focus();
        return;
      }
      case "notice":
        add(el("div", "notice", ev.text));
        return;
      case "error":
        add(el("div", "error", ev.message));
        return;
      case "done":
        reply = null;
        add(el("div", "meta", `Done in ${ev.steps} step${ev.steps === 1 ? "" : "s"}${ev.files && ev.files.length ? ` · ${ev.files.length} file${ev.files.length === 1 ? "" : "s"} changed` : ""}`));
        return;
    }
  }

  window.addEventListener("message", (e) => {
    const m = e.data;
    switch (m.type) {
      case "config":
        mode.value = m.mode;
        if (!m.hasFolder) add(el("div", "notice", "Open a folder to start: Fahh Local works inside a workspace."));
        empty();
        return;
      case "user":
        log.querySelector(".empty")?.remove();
        add(el("div", "msg user", m.text));
        reply = null;
        setBusy(true);
        return;
      case "event":
        return onEvent(m.event);
      case "turn_end":
        setBusy(false);
        reply = null;
        return;
      case "error":
        setBusy(false);
        add(el("div", "error", m.message));
        return;
      case "notice":
        setBusy(false);
        add(el("div", "notice", m.text));
        return;
      case "log":
        add(el("div", "meta", m.text));
        return;
      case "cleared":
        log.replaceChildren();
        setBusy(false);
        empty();
        return;
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || send.disabled) return;
    vscode.postMessage({ type: "prompt", text, mode: mode.value });
    input.value = "";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  stop.addEventListener("click", () => vscode.postMessage({ type: "stop" }));
  vscode.postMessage({ type: "ready" });
})();
