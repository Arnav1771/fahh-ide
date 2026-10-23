# Fahh Local Agent

**Fahh Local** is Fahh Editor's coding agent. It runs on your machine with your own provider key and works on the open folder: chat, a card per tool call, approvals, and per-file diff review. Open it from the robot icon or with `Ctrl+L` (outside the editor and terminal) / `Ctrl+Shift+A` (anywhere). It docks in the right side bar by default and can be dragged (or moved from the palette) anywhere; `/exit` hides it. The same agent runs in a terminal as `fahh-agent`. Details: [IMP_DOCS/FAHH_LOCAL.md](https://github.com/Arnav1771/fahh-ide/blob/main/IMP_DOCS/FAHH_LOCAL.md).

---

## Modes

| Button | What it allows |
|---|---|
| **Ask** (Normal) | All tools; asks before every edit and command. |
| **Edits** (Accept Edits) | Edits apply right away; commands still ask. |
| **Smart** | Edits apply; a judge model rates each command SAFE or UNSAFE, and UNSAFE ones ask. |
| **Plan** | Read-only research, then a plan file you approve before anything changes. |
| **Bypass** | Auto-approves every prompt. A red badge stays on. Deny rules and the built-in blocks still apply. |

`/ask <question>` is a one-shot read-only answer that leaves the mode alone.

---

## Sessions

Every conversation is a session, saved after each step under the app data folder, one folder per workspace (with its file checkpoints, so undo survives a restart).

- **New session**: the **+** button or `/clear`.
- **Switch**: the clock button or `/ls` lists saved sessions; **Resume** opens one. `/continue` opens the latest, `/resume <id>` a given one.
- **Rename**: `/title <name>`.
- **Delete**: **Delete** in the list, or `/rm-session <id>`.
- `/steps`, `/fork [step]`, `/revert <step>`, `/undo`, `/export [path]`, `/compact`, `/context`, `/usage`.

---

## Slash commands

Type `/` for a filterable menu (Up/Down, Enter runs, Tab fills in, Esc closes). The panel and the terminal read one table, so the names are the same in both. Highlights:

- `/loop <prompt>`: runs the prompt, then a `reviewer` subagent reads the diff and asks for fixes until it approves (3 rounds by default). One step, so one `/revert` undoes it.
- `/agents`, `/agent <name> <task>`: subagents defined in `.fahh/agents/*.md` (or `~/.fahh/agents/`), plus the built-in `explore`, `reviewer` and `planner`. The main agent can also delegate to them. A child never gets more permission than its parent.
- `/fast [prompt]`, `/model [name]`, `/btw <prompt>`, `/add-dir <path>`, `/help`, `/shortcuts`, `/config`.

---

## While it runs

The line under the transcript says what the turn is doing right now (the tool or subagent that is running, or waiting for the model). **Enter** queues your next prompt; it runs when the turn ends. **Ctrl+Enter** (or **Steer**) stops the turn and sends your text instead. **Esc** stops it.

The badge under the input is an estimate of what the next prompt carries (about 3.8 characters per token: your text plus the open file).

---

## `@` Mentions

Type `@` in the prompt to insert a reference: `@file <name>`, `@problems`, `@terminal`, `@git` or `@codebase`. The mention is inserted as text; the agent reads files itself with its tools.

---

## Removed: simulated features

Earlier versions had a "REA" analysis panel and a Cursor-style Composer (`Ctrl+I`), removed after v0.6.3. The agent panel also had an **Alt+V image paste** that only typed `[Image: … attached]` into the prompt (no provider here takes images), and a fixed "Devin Task Execution Loop" banner while running. Both are gone; the run-status line above replaces the banner.
