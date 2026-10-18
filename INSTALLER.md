# Optional Tools Installer

Fahh Editor can install several optional tools at first launch. This document
describes how the installer works and how to add new tools.

---

## Principles

- **No Docker.** Every tool runs as a native local process.
- **Opt-in only.** Nothing is installed without the user explicitly selecting it.
- **Idempotent.** The installer is safe to run multiple times. It checks if a
  tool is already installed before attempting to install it.
- **Transparent.** Install output is streamed to the UI in real time.
- **Re-runnable.** The wizard is accessible any time from Settings > Integrations.

---

## State file

Tool installation state is persisted in `~/.fahh/config.json`:

```json
{
  "fahh_sfx_enabled": true,
  "fahh_sfx_cooldown_ms": 3000,
  "fahh_sfx_show_toast": true,
  "installed_tools": {
    "n8n": { "installed": true, "version": "1.x.x", "port": 5678 },
    "browser_use": { "installed": false },
    "flowise": { "installed": false },
    "github_cli": { "installed": true, "version": "2.x.x" },
    "claude_cli": { "installed": false }
  },
  "mcp_servers": []
}
```

---

## Tools

### n8n

**What it does:** Visual workflow automation. Runs a local server with a web UI.

**Requires:** Node.js 18+

**Check installed:** `n8n --version` exits 0

**Install:**
```bash
npm install -g n8n
```

**Run:** Fahh Editor starts n8n as a child process on `localhost:5678` when
the IDE launches (if installed). The n8n UI is accessible via an embedded
panel or by opening `http://localhost:5678` in the browser.

**Tauri integration:** `installer.rs` spawns `n8n start --port 5678` and
manages the process lifecycle (start on IDE open, stop on IDE close).

---

### browser-use

**What it does:** Python-based AI web browsing agent. Lets the AI panel
control a browser to complete tasks.

**Requires:** Python 3.11+

**Check installed:** `python -c "import browser_use"` exits 0

**Install:**
```bash
pip install browser-use
playwright install chromium
```

**Run:** Exposed as an MCP-compatible sidecar. The AI panel calls it via MCP
tool calls.

---

### Flowise AI

**What it does:** Visual drag-and-drop LLM workflow builder with a web UI.

**Requires:** Node.js 18+

**Check installed:** `flowise --version` exits 0

**Install:**
```bash
npm install -g flowise
```

**Run:** Fahh Editor starts Flowise as a child process on `localhost:3001`
when the IDE launches (if installed).

---

### GitHub CLI

**What it does:** `gh` command-line tool for GitHub. Available in the
integrated terminal once installed.

**Requires:** Nothing (standalone binary)

**Check installed:** `gh --version` exits 0

**Install:** Platform-specific:
- macOS: `brew install gh`
- Ubuntu/Debian: official apt repo at `https://cli.github.com/packages`
- Windows: winget `GitHub.cli` or the MSI from `https://github.com/cli/cli/releases`
- Cross-platform fallback: download binary from GitHub releases

---

### Claude CLI

**What it does:** Anthropic's Claude coding agent. Integrates with the AI panel
via MCP.

**Requires:** Node.js 18+

**Check installed:** `claude --version` exits 0

**Install:**
```bash
npm install -g @anthropic-ai/claude-code
```

After install, registers itself as an MCP server in `~/.fahh/config.json`.

---

## Adding a new tool

1. Add a variant to `OptionalTool` in `src-tauri/src/core/installer.rs`
2. Implement the `check_installed()` method for it (runs a version check command)
3. Implement the `install(sender)` method — stream stdout lines to the UI
4. Add the prerequisite check (e.g. Node version, Python version)
5. Add it to the wizard UI in `src/components/InstallerWizard/ToolCard.tsx`
6. Add it to the state schema in the config section above
7. Document it in this file

---

## Process lifecycle

Tools that run servers (n8n, Flowise) are managed by Fahh Editor as child
processes via Tauri's `tauri::process::Command`:

- **Started** when the IDE window opens (if the tool is installed)
- **Stopped** when the IDE window closes (graceful SIGTERM, then SIGKILL after 5s)
- **Restarted** if they crash (exponential backoff, max 3 attempts)

The PID is stored in memory only — not persisted. If the IDE crashes and a
tool process is left running, the user can stop it manually or it will be
replaced when the IDE restarts.
