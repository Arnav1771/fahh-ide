# Fahh Local Chat for VS Code

Fahh Local Chat is the extension for VS Code-like editors. Fahh Local is the agent panel built
into Fahh Editor; both run the same agent.

Fahh Editor's coding agent (fahh-agent) as a chat in VS Code's side bar. It reads, edits and runs things in the open
folder, and asks before every edit and command (unless you pick another mode).

## What you need

- **Fahh Editor 0.8.8 or newer** installed. The extension runs its agent (`fahh-agent --json`);
  nothing else is downloaded. Get it at https://fahhide.duckdns.org.
- A provider: Groq, Google Gemini, NVIDIA NIM, OpenRouter or Anthropic with an API key, or a
  local Ollama with no key. Pick it with `/provider`; the extension asks for the key the first
  time. Keys live in VS Code's secret storage, one per provider, and reach the agent only as an
  environment variable. A key already set in your environment works too.

## Use it

Open a folder, click **Fahh Local Chat** in the activity bar, and ask, or click one of the starter
prompts built from what is in the folder. Edits show a diff and commands show the command line
before they run: **Allow**, **Always**, **Deny**, or **Edit** the command first. Tool calls fold
into one line each; click one for its input and output. Changed files appear as chips you can
open. **Stop** ends the turn; the session is saved and your next message continues it.

Type `/` for commands:

| Command | What it does |
|---|---|
| `/new` | Start a fresh session |
| `/model [id]` | Pick from the models your key can use (`fahh-agent models list`), or type one |
| `/provider [name]` | Switch provider; asks for its key if there is none |
| `/mode [mode]` | normal, accept-edits, smart, plan or bypass |
| `/resume [id]` | Continue a saved session of this folder |
| `/ask <question>` | A read-only question: nothing is changed |
| `/plan [prompt]` | Plan mode: research, then write a plan you can implement with one click |
| `/copy` | Copy the last reply |
| `/clear` | Clear the view; the session continues |
| `/keys` | Add or remove a provider's key |
| `/settings` | Provider, model, keys and the Fahh program path |
| `/help` | Commands and shortcuts |

Modes: **Normal** asks before every change, **Accept edits** applies edits but asks before
commands, **Smart** lets a judge model screen commands, **Plan** only writes a plan, **Bypass**
asks for nothing (deny rules in `.fahh/permissions.json` still apply).

## Settings

`fahhLocalChat.provider`, `fahhLocalChat.model`, `fahhLocalChat.mode`, and `fahhLocalChat.binary` (the Fahh
Editor program, when it is installed somewhere unusual). Changing the provider or model restarts
the agent and resumes the same session.

Upgrading from 0.2.x (published as `stealth-keqing.fahh-local`): `fahhLocal.*` settings are still
read for this release when the matching `fahhLocalChat.*` one is not set; move them over. The
extension ID changed, so VS Code keeps the old secret storage apart: add your keys again with
`/keys`.
