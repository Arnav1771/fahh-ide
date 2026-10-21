# Fahh Local Agent

**Fahh Local** is Fahh Editor's coding agent. It runs on your machine with your own provider key and works on the open folder: chat, a card per tool call, approvals, and per-file diff review. Open it from the robot icon or with `Ctrl+L` (outside the editor) / `Ctrl+Shift+A`. Details: [IMP_DOCS/FAHH_LOCAL.md](https://github.com/Arnav1771/fahh-ide/blob/main/IMP_DOCS/FAHH_LOCAL.md).

---

## Operating Modes

1. **Ask Mode**: Asks before every edit and command.
2. **Auto-Edit Mode**: Edits files directly; still asks before running commands.
3. **Plan Mode**: Read-only. Researches and writes a plan you approve before anything changes.

---

## `@` Mentions

Type `@` in the prompt to insert a reference: `@file <name>`, `@problems`, `@terminal`, `@git` or `@codebase`. The mention is inserted as text; the agent reads files itself with its tools.

---

## Removed: REA Code Analysis and Cursor Composer

Earlier versions documented a "REA" analysis panel and a Cursor-style Composer (`Ctrl+I`) here. Both were simulated (sample data and canned templates behind a timer, no model) and were removed after v0.6.3. Fahh Local is the real agent.
