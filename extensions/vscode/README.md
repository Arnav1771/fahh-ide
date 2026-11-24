# Fahh Familiar for VS Code

Fahh Familiar is the extension for VS Code-like editors. Fahh Local is the agent panel built
into Fahh Editor; both run the same agent.

Fahh Editor's coding agent (fahh-agent) as a chat in VS Code's side bar. It reads, edits and runs things in the open
folder, and asks before every edit and command (unless you pick another mode or rule).

## What you need

- **Fahh Editor 0.8.8 or newer** installed. The extension runs its agent (`fahh-agent --json`);
  nothing else is downloaded. Get it at https://fahhide.duckdns.org.
- A provider: Groq, Google Gemini, NVIDIA NIM, OpenRouter or Anthropic with an API key, or a
  local Ollama with no key. Pick it with `/provider`; the extension asks for the key the first
  time. Keys live in VS Code's secret storage, one per provider, and reach the agent only as an
  environment variable. A key already set in your environment works too.
- `/compact`, `/usage`, the usage counter and the agent-side undo need a fahh-agent that lists them
  in its ready line (the Fahh Editor release after 0.9.0). With an older one they are hidden, and
  undo restores the files you approved edits to.

## Use it

Open a folder, click **Fahh Familiar** in the activity bar, and ask, or click one of the starter
prompts built from what is in the folder. Edits show a diff and commands show the command line
before they run: **Allow**, **Always**, **Deny**, **Edit** the command first, or **Open diff** to
compare the whole file in VS Code's diff editor and **Accept** or **Reject** from its title bar.
Tool calls fold into one line each; click one for its input and output. Changed files appear as
chips you can open. A turn that changed files ends with **Undo this turn**, which restores them
(after a confirmation naming each file). **Stop** ends the turn; the session is saved and your
next message continues it.

### Context with `@`

Type `@` in the message box:

| Mention | What the agent gets |
|---|---|
| `@file` | A picker over the workspace files; the path is named and the agent reads it itself |
| `@folder` | A picker over folders |
| `@selection` | The editor selection, with its path and line numbers, as text |
| `@problems` | The errors and warnings VS Code reports right now |
| `@src/ma…` | Fuzzy matches over the workspace files as you type |

The context goes to the agent below your message in a `<vscode-context>` block.

### Keys

| Key | What it does |
|---|---|
| `Ctrl+L` (`Cmd+L` on macOS) in the editor | With a selection: open the chat and add it as `@selection`. Without one: focus the chat |
| Editor right-click, **Ask Fahh Familiar about this** | The same, from the menu |
| `Up` / `Down` at the start of the message box | Earlier prompts (the last 50 of this workspace) |
| `Enter` / `Shift+Enter` | Send / new line |
| `Tab` | Complete a command or mention |

### The status bar

`model · mode · usage` on the right, with a robot icon. Click it to change the model, provider or
mode, edit the auto-approve rules, or open the chat. Usage (estimated tokens and how full the
context is) appears after the first turn with an agent that reports it.

### Commands

Type `/`:

| Command | What it does |
|---|---|
| `/new` | Start a fresh session |
| `/model [id]` | Pick from the models your key can use (`fahh-agent models list`), or type one |
| `/provider [name]` | Switch provider; asks for its key if there is none |
| `/mode [mode]` | normal, accept-edits, smart, plan or bypass |
| `/permissions` | Auto-approve rules: reads, edits, commands |
| `/resume [id]` | Continue a saved session of this folder |
| `/ask <question>` | A read-only question: nothing is changed |
| `/plan [prompt]` | Plan mode: research, then write a plan you can implement with one click |
| `/copy` | Copy the last reply |
| `/export` | Open the conversation, tool calls included, as a Markdown document (also in the view's `...` menu) |
| `/compact` | Fold older turns into a summary to free context |
| `/usage` | Model calls, tokens and context used |
| `/clear` | Clear the view; the session continues |
| `/keys` | Add or remove a provider's key |
| `/settings` | Provider, model, keys and the Fahh program path |
| `/help` | Commands and shortcuts |

Modes: **Normal** asks before every change, **Accept edits** applies edits but asks before
commands, **Smart** lets a judge model screen commands, **Plan** only writes a plan, **Bypass**
asks for nothing (deny rules in `.fahh/permissions.json` still apply).

### Auto-approve rules

`/permissions` (or Settings): reads and searches are always allowed; **edits** and **commands**
are each *ask first* or *always*. The rules use the agent's own modes and only ever raise the one
you picked: edits *always* is Accept edits, commands *always* is Bypass (a command can change any
file, so it allows edits too). Plan and `/ask` stay read-only. The agent's built-in blocks and the
deny rules in `.fahh/permissions.json` apply in every mode.

## Settings

`fahhLocalChat.provider`, `fahhLocalChat.model`, `fahhLocalChat.mode`,
`fahhLocalChat.autoApprove.edits`, `fahhLocalChat.autoApprove.commands`, and
`fahhLocalChat.binary` (the Fahh Editor program, when it is installed somewhere unusual).
Changing any of them restarts the agent and resumes the same session.

The extension ID (`stealth-keqing.fahh-local-chat`) and the `fahhLocalChat.*` settings are the same
as in Fahh Local Chat 0.3, so your keys and settings carry over. The 0.2.x `fahhLocal.*` settings
are no longer read.
