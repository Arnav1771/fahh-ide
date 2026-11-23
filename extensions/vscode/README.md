# Fahh Local for VS Code

The Fahh Local coding agent in VS Code's side bar. It reads, edits and runs things in the open
folder, and asks before every edit and command (unless you pick another mode).

## What you need

- **Fahh Editor 0.8.8 or newer** installed. The extension runs its agent (`fahh agent --json`);
  nothing else is downloaded. Get it at https://fahhide.duckdns.org.
- An API key for one provider (Groq, Gemini, NVIDIA, OpenRouter or Anthropic), or a local
  Ollama. Set it with the key button in the Fahh Local view. Keys live in VS Code's secret
  storage and reach the agent only as an environment variable.

## Use it

Open a folder, click **Fahh Local** in the activity bar, and ask. Answer **Allow**, **Always**
or **Deny** on each edit or command. **Stop** ends the turn; the session is saved, and your next
message continues it. **New session** (the + button) starts over.

Modes: **Ask** asks before every change, **Edits** applies edits but asks before commands,
**Smart** lets a second model judge commands, **Plan** only writes a plan, **Bypass** asks for
nothing (deny rules in `.fahh/permissions.json` still apply).

## Settings

`fahhLocal.provider`, `fahhLocal.model`, `fahhLocal.mode`, and `fahhLocal.binary` (the Fahh
Editor program, when it is installed somewhere unusual).
