# Fahh Local (phase 1)

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

Modes: **Ask** (default), **Auto-edit**, **Plan**. Order of precedence:

1. built-in denies (`sudo`, `rm -rf /`, pipe to a shell, force push, writes to
   `.git/` and `.fahh/permissions.json`)
2. deny rules in `.fahh/permissions.json`
3. Plan mode: edits denied, only read-only commands (`ls`, `git status`, ...)
4. ask rules, and any file with unsaved changes in the editor (always asks)
5. allow rules (an allow never covers a chained command like `a; b`)
6. mode default: reads allowed; edits ask (Ask) or apply (Auto-edit); commands ask

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

## Not in phase 1

Subagents, MCP, worktree sessions, persistent checkpoints, OS keychain.
