# Fahh Local in a terminal

The same agent as the editor's Fahh Local panel, without a window. It has the same tools, the same approvals, and the same sessions, saved per folder.

## Start it

| Where | Command |
|---|---|
| Linux / macOS (`fahh` installed by the AppImage or the app menu) | `fahh agent` |
| Windows | `fahh-agent` (in `%LOCALAPPDATA%\Fahh Editor\`, on PATH after install) |
| Any OS, from a source build | `cargo run --bin fahh-agent --` |

Give it a key for one provider, as an environment variable. Fahh never prints it.

```bash
export GROQ_API_KEY=...          # or GEMINI_API_KEY, NVIDIA_API_KEY, OPENROUTER_API_KEY, ANTHROPIC_API_KEY
cd my-project
fahh agent                       # interactive: type a request, /help lists the slash commands
fahh agent "add a test for parse_date"            # one request, then the prompt
fahh agent -p "summarise this repo"               # print only the answer, then exit (for scripts)
fahh agent -c                                     # continue the latest session in this folder
fahh agent --provider ollama --model qwen2.5-coder  # a local model, no key
```

Useful flags:
- `--cwd DIR`: the folder to work in.
- `--provider P`: one of groq, gemini, nvidia, openrouter, ollama, anthropic.
- `--model M`
- `--mode normal|accept-edits|smart|plan|bypass`
- `-r ID`: resume that session.
- `--export out.md`: write the conversation.

`fahh agent sessions ls` lists the sessions saved for this folder. `fahh agent models list` shows what your key can use.

Every edit shows a diff, and every command is shown before it runs, with `allow? [y]es / [N]o / [a]lways`. **Always** remembers the rule in your own app data. A project cannot pre-approve anything.

## For editors: `--json`

`fahh agent --json` turns the terminal session into a machine interface, which the VS Code extension uses:

- **Out (stdout), one JSON object per line:**
  - `{"type":"ready","session":...}`, once, at start.
  - `{"type":"event","event":{...}}`, one per agent event: text, tool calls, approval requests, file changes, done.
  - `{"type":"turn_end","ok":true,"text":"..."}`, when a turn ends.
- **In (stdin), one JSON object per line:**
  - `{"prompt":"...","mode":"smart"}` starts a turn.
  - `{"allow":true,"always":false}` answers the approval that is waiting.

## Test it

**Unit tests** live next to the code in `src-tauri/src/agent/cli.rs`. They cover argument parsing, the `--json` flag and approval answers, and how subagent output is shown. The `rust` job in `.github/workflows/ci.yml` runs them on every pull request, on Linux and Windows.

```bash
cd src-tauri
cargo test --lib agent::cli        # the terminal agent
cargo test --lib agent::           # the whole agent: runner, tools, permissions, sessions
```

**A whole run without a model or a key.** The scripted provider replays a JSON list of model turns, so you can watch the full flow (tools, approvals, file changes) for free:

```bash
cat > /tmp/script.json <<'EOF'
[{"text":"Let me look first.","calls":[{"id":"c1","name":"list_dir","args":{"path":"."}}]},
 {"text":"","calls":[{"id":"c2","name":"write_file","args":{"path":"greet.py","content":"print(\"hi\")\n"}}]},
 {"text":"Created greet.py.","calls":[]}]
EOF
mkdir -p /tmp/try && cd /tmp/try
FAHH_DATA_DIR=/tmp/try/.data FAHH_AGENT_MOCK_SCRIPT=/tmp/script.json \
  fahh agent --provider mock "make a greeting script"
# answer y at "allow?", then: python3 greet.py
```

`FAHH_DATA_DIR` keeps the test's sessions out of your real ones. The same script works with `--json`: pipe `{"prompt":"..."}` and `{"allow":true}` lines in.

**The VS Code extension** (`extensions/vscode`) is tested with `npm test`, which checks how it finds Fahh, the command line it builds, and how it reads the JSON lines.
