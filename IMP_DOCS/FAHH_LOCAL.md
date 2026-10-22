# Fahh Local

An in-editor coding agent modelled on the local agent in Cognition's Devin
Desktop. It replaces the old AI Composer panel.

## Where things live

| Piece | Files |
|-------|-------|
| Agent loop, events, Tauri commands | `src-tauri/src/agent/mod.rs` |
| Permission engine, workspace path rules | `src-tauri/src/agent/perm.rs` |
| Tools, checkpoints (undo), `run_command` | `src-tauri/src/agent/tools.rs` |
| Providers (OpenAI-compatible, Anthropic, mock) | `src-tauri/src/agent/provider.rs` |
| Terminal CLI | `src-tauri/src/agent/cli.rs`, `src-tauri/src/bin/fahh-agent.rs` |
| IPC contract (source of truth) | `src/lib/types.ts` (`Agent*`) |
| Panel state reducer, settings | `src/lib/agentState.ts`, `src/lib/agent.ts`, `src/store/agentStore.ts` |
| Panel UI | `src/components/AgentPanel/` |

## Loop

model call (streamed) -> tool calls -> each call is classified, checked by the
permission engine, optionally approved by the user -> result back to the model
-> repeat until the model answers without a tool call, the user stops it, or 25
steps pass. Events go to the panel on `agent://event`.

## Tools

`list_dir`, `read_file`, `search` (regex, skips `.git`, `node_modules`,
`target`, ...), `get_diagnostics` (the editor's current errors, pushed by the
frontend), `edit_file` (exact replace; no match or several matches is an error
the model sees), `write_file`, `run_command` (120 s default timeout, no console
window on Windows, stdin closed so a password prompt cannot hang), `write_plan`.

## Permissions

Modes: see Modes below (Normal, Accept Edits, Smart, Plan, Ask, Bypass). Order of precedence:

1. built-in denies (`sudo`, `rm -rf /`, pipe to a shell, force push, writes to
   `.git/` and `.fahh/permissions.json`)
2. deny rules in `.fahh/permissions.json`
3. Plan mode: edits denied, only read-only commands (`ls`, `git status`, ...)
4. Bypass: allow everything left (this is why 1 and 2 come first)
5. ask rules, and any file with unsaved changes in the editor (always asks)
6. allow rules (an allow never covers a chained command like `a; b`)
7. mode default: reads allowed; edits ask (Normal) or apply (Accept Edits, Smart); commands ask
   (Smart: the judge decides)

Paths: nothing outside the workspace, and nothing written through a symlink.
The old Composer rule (never write into a file other than the one shown, ask
first) lives here: an Ask-mode approval names the exact file and diff, and
"Always" saves a rule for that one file.

`.fahh/permissions.json`:

```json
{ "rules": [
  { "action": "allow", "kind": "run",  "pattern": "cargo test*" },
  { "action": "deny",  "kind": "edit", "pattern": "src/generated/*" }
] }
```

`kind` is `read`, `edit` or `run`; `*` matches anything, `?` one character.
A command you edit in the approval prompt is checked again, so a deny rule
still wins.

## Checkpoints

The first time a turn touches a file, its bytes are kept in memory (or "did not
exist"). Per-file Reject and Revert turn restore them. They do not survive an
app restart (phase 2).

## Context

Active file, selection, open files, current diagnostics, and `AGENTS.md` /
`.fahh/rules.md` if present.

## Keys

Panel: `localStorage` (same place the old panel used), sent to the backend per
turn, never logged, never in the project. CLI: environment variables only.

## Modes

| Mode (Devin name) | Panel button / flag | Allows |
|---|---|---|
| Normal (default; `/code`) | Ask, `--permission-mode normal` | all tools; asks before every edit and command |
| Accept Edits | Edits, `accept-edits` | edits apply right away; commands still ask |
| Smart | Smart, `smart` | edits auto-approved; a fast judge model classifies each command SAFE or UNSAFE; SAFE runs, UNSAFE asks. The verdict is shown in the transcript and logged. If the judge fails or answers anything but SAFE, it asks |
| Plan | Plan, `plan` | read-only tools and read-only commands; writes `.fahh/plans/<id>.md`; Implement afterwards |
| Ask (`/ask`, one shot) | none (command only) | read-only Q&A: list, read, search, diagnostics. No commands, no plan files; the session's mode is unchanged |
| Bypass (`/bypass`, `/yolo`, `/dangerous`) | Bypass, `bypass` | every prompt is auto-approved. A red warning badge stays visible in the panel and the terminal prints a warning |

Bypass is stricter than Devin's on purpose: **explicit deny rules, the built-in blocks
(`sudo`, `rm -rf /`, pipe to a shell, force push, `.git/` and `.fahh/permissions.json`
writes), the workspace boundary and the symlink refusal still apply in every mode,
Bypass included.** Ask rules are treated as prompts, so Bypass approves them.

The Smart-mode judge is the fast model (Settings, "Fast model", or `--fast-model` /
`--judge-model`); with none set the main model judges. Autonomous mode (needs an OS
sandbox) is not built.

## Slash commands

Type `/` in the panel for a filterable menu (grouped, an icon and a one-line description
each; Up/Down move, Enter runs, Tab fills in, Esc closes). A command that takes an argument
runs it as a prompt, for example `/plan add a cache`. The same names work in the
`fahh-agent` terminal REPL. Both read one table, `src/lib/slash-commands.json`, so they
cannot drift; a test checks this page lists every command.

| Command | Aliases | What it does |
|---|---|---|
| **Session** | | |
| `/model [name]` |  | Show or switch the model |
| `/mode [normal|accept-edits|smart|plan|bypass]` |  | Show or switch the permission mode |
| `/ask <question>` |  | Read-only Q&A, one shot: no changes |
| `/plan [prompt]` |  | Plan mode: research read-only, write a plan |
| `/code [prompt]` |  | Normal mode: all tools, normal prompts |
| `/normal` |  | Switch to normal mode |
| `/accept-edits [prompt]` | /edits, /auto | Edits apply right away; commands still ask |
| `/smart [prompt]` |  | Edits auto-approved; a judge model screens commands |
| `/bypass [prompt]` | /yolo, /dangerous | Auto-approve everything (deny rules still apply) |
| `/fast [prompt]` |  | Use the fast model for this prompt |
| `/loop <prompt>` |  | Run, then review the diff and repeat until approved |
| `/btw <prompt>` |  | Side question, not added to the conversation |
| `/compact` |  | Summarise older turns to free context |
| `/context` |  | Context window usage |
| `/usage` | /stats, /session-stats | Calls and estimated tokens this session |
| `/clear` | /new | Start a fresh session |
| `/continue [id]` |  | Continue the latest (or a given) session |
| `/resume [id]` |  | Pick a saved session to resume |
| `/ls` | /list-sessions | List saved sessions for this workspace |
| `/title <title>` | /rename-session | Rename this session |
| `/rm-session <id>` |  | Delete a saved session |
| `/steps` |  | List the steps (user requests) so far |
| `/fork [step]` |  | Branch the conversation into a new session |
| `/undo` |  | Revert the files the latest turn changed |
| `/revert <step>` |  | Undo file changes from a step and rewind to it |
| `/export [path]` |  | Write the session as Markdown |
| `/copy` |  | Copy the last reply |
| `/exit` | /quit | Leave |
| **Workspace** | | |
| `/workspace` |  | Show the workspace folders |
| `/add-dir <path>` |  | Let the agent work in another folder too |
| `/remove-dir <path>` |  | Stop including an added folder |
| `/agents` |  | List subagent definitions (and problems) |
| `/agent <name> <task>` |  | Run one subagent directly |
| **Help** | | |
| `/help` | /? | List the slash commands |
| `/shortcuts` |  | Keyboard shortcuts |
| `/config` |  | Show the current settings (never the key) |

Terminal-only differences: `/copy` prints the last reply (no clipboard), `/resume` without an
id asks for a number from the list. Not built: `/mcp`, `/hooks`, `/autonomous`, `/cloud` and
the other Devin account commands, rebindable shortcuts.

CLI flags: `--model`, `--provider`, `--permission-mode normal|accept-edits|smart|plan|bypass`
(alias `--mode`), `-c/--continue`, `-r/--resume <id>`, `-p/--print <prompt>` (only the answer
on stdout), `--prompt-file <file>`, `--config <file>` (JSON: provider, model, mode, fast_model,
judge_model; flags win), `--export <path|->`, `--fast-model`, `--judge-model`. Subcommands:
`models list` (asks the provider which models your key can use), `sessions ls`.

## Panel shortcuts

- **Ctrl+Shift+A** toggles the panel from anywhere. **Ctrl+L** does too, except while the
  cursor is in the code editor (it keeps "select line", the VS Code convention) or the
  terminal (clear screen).
- **Esc** stops a running turn; with the "/" menu open it only closes the menu.
- **Enter** or **Ctrl+Enter** sends, **Shift+Enter** adds a line.
- The quick-action pills above the input (Find Bugs, Generate Plan, Add Tests, Explain
  Selection) send a canned prompt; one that starts with `/` runs as that command.
- The badge by the model name is a live estimate of what the next prompt carries (input plus
  the open file); `/context` reports the whole session.

## Sessions

Every session is saved after each step under the app data dir (`FAHH_DATA_DIR` overrides),
one folder per workspace: the conversation, the step list, usage and the **checkpoints**. So
`/ls`, `/resume`, `/continue`, `/fork [step]` and `/revert <step>` work across restarts.

- A *step* is one user request (a `/loop` is one step).
- `/revert <step>` restores every file changed in that step and later ones from the
  checkpoints and rewinds the conversation to just before it. If the step was folded by
  `/compact` the files are restored but the conversation cannot be rewound (it says so).
- `/fork [step]` makes a new session from the conversation up to that step; the original's
  checkpoints stay with the original.
- `/compact` summarises older turns with the model (it also happens automatically at 80% of
  the window). `/context` and `/usage` show **estimated** tokens (about 3.8 characters per token); the window
  size is a guess from the model name.
- `/btw <prompt>` answers a side question that is not added to the conversation.

## /loop

`/loop <prompt>`: run the prompt (editing modes only), then the `reviewer` subagent reads the
diff and replies `APPROVED` or `CHANGES` plus fix instructions; those become the next round.
It stops on approval, when a round changes no files, when stopped, or at the cap (3 rounds by
default). The whole loop is one step with one set of checkpoints, so one `/revert` undoes it.
If the workspace has uncommitted git changes it says so first: only the files the loop touched
are restored.

## Subagents

Definitions are markdown files with frontmatter, in `.fahh/agents/` (project) or
`~/.fahh/agents/` (user); the project wins over the user over the built-ins:

```markdown
---
name: docs
description: Writes and fixes documentation
model: optional-model-name        # default: the session's model
mode: accept-edits                # a ceiling: plan, ask/normal, accept-edits, read-only
max_steps: 10
---
You write documentation. Keep it short and accurate.
```

Built-ins: `explore` (read-only search and summary), `reviewer` (reviews a diff; `/loop`
uses it), `planner` (writes a plan file). A file with bad frontmatter is skipped and
reported by `/agents` (like `devin doctor`).

The main agent gets a `delegate` tool (`agent`, `task`). The child runs its own loop with a
fresh context and only its final message returns to the parent. Safety:

- A child can never exceed the parent: its mode is the lower of its definition's and the
  parent's (a Plan parent gives read-only children, a Normal parent's children still ask),
  and it uses the parent's rules, so deny still wins.
- A child's approvals appear in the same prompt UI, tagged with the agent's name.
- Depth 1: a child cannot start another subagent.
- Up to 3 children run at once (`limits.max_parallel`); each has its own Stop button
  (stopping one child does not cancel the parent turn or its siblings). One budget per
  turn covers all of them: 80 model calls and about 400k output tokens by default.
- `/agents` lists definitions; `/agent <name> <task>` runs one directly.

## Known limitations

- **API keys are stored in the app's `localStorage` (panel) or read from environment variables
  (terminal).** There is no OS keychain integration yet. They are sent only to the provider,
  never written into a project and never logged.
- Token counts are estimates (about 3.8 characters per token, the same heuristic in the panel badge and the backend); the context window is guessed from the model name.
- Smart mode trusts a model's judgement of a command: it is a convenience, not a sandbox.
- Permission grants made with "Always" are saved per project; there are no per-session grants.
- Not built: MCP, worktree sessions, autonomous mode (needs a sandbox), rebindable shortcuts.
- The terminal binary is bundled next to the editor by `scripts/prepare-sidecar.mjs`
  (Tauri `externalBin`); a plain `cargo build` leaves a stand-in instead.
