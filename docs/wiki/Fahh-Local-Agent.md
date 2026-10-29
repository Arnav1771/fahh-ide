# Fahh Local Agent

**Fahh Local** is Fahh Editor's coding agent. It runs on your machine with your own provider key and works on the open folder: chat, a card per tool call, approvals, and per-file diff review. Open it from the robot icon or with `Ctrl+L` (outside the editor and terminal). `Ctrl+Shift+A` searches your saved sessions. **Agent mode** (the Agent | Editor switch at the top left) turns the window into the chat, with New session and your sessions on the left. It docks in the right side bar by default and can be dragged (or moved from the palette) anywhere; `/exit` hides it. The same agent runs in a terminal as `fahh-agent`. Details: [IMP_DOCS/FAHH_LOCAL.md](https://github.com/Arnav1771/fahh-ide/blob/main/IMP_DOCS/FAHH_LOCAL.md).

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

## Your own endpoint

Any OpenAI-compatible server (vLLM, LM Studio, llama.cpp, LiteLLM, a company gateway, OpenRouter-style proxies) or an Anthropic Messages endpoint can be added once and picked like a built-in provider.

1. Open Fahh Local settings (the gear in the Fahh Local header).
2. In **Provider**, choose **+ Add your own endpoint…**.
3. Enter a name, the base URL (for example `https://llm.example.com/v1`), the API key if it needs one, and the type.
4. **Save and fetch models** calls the endpoint's `/models` and fills the model list; the first model is selected. If the endpoint does not list models, **Save anyway** keeps it and you type the model name.

Saved endpoints appear under **Your endpoints** in the Provider list; picking one fetches its models again. Editing the base URL or key while one is selected updates it, and **Remove** deletes it. Keys stay in this machine's local storage and are never synced or written into your project.

## Subagents

The main agent can hand a self-contained job to a **subagent** with the `delegate` tool, in every mode. A subagent works with a fresh context and returns a short result; several can run at once, and each shows as its own card in the transcript.

- Built in: `explore` (reads and searches the project), `reviewer` (reviews a diff), `planner` (writes a plan).
- Your own: a Markdown file in `.fahh/agents/<name>.md` (project) or `~/.fahh/agents/<name>.md` (all projects) with `name`, `description`, `mode` and `max_steps` front matter; the body is its instructions. Project agents override user ones, which override built-ins.
- Ask for one directly with `/agent <name> <task>`, or just say "use the explore subagent to …". A subagent never gets more permission than the turn that started it.

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
