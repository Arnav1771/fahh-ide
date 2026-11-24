# Changelog

## 0.4.0

Renamed to **Fahh Familiar** (it was Fahh Local Chat). The ID `stealth-keqing.fahh-local-chat` and the
`fahhLocalChat.*` commands and settings are unchanged, so keys and settings carry over.

- `@` mentions: `@file` and `@folder` pickers, `@selection` (path and lines), `@problems` (current
  errors and warnings), and fuzzy file matches as you type. The context is sent below the message.
- **Ask Fahh Familiar about this** in the editor's right-click menu, and `Ctrl+L` / `Cmd+L` in the
  editor: adds the selection as `@selection`, or just focuses the chat.
- **Open diff** on edit approvals: VS Code's diff editor, current file against the proposed one,
  with Accept and Reject in its title bar.
- **Undo this turn** on every turn that changed files, after a confirmation naming them. With an
  agent that supports it, the agent's own checkpoints restore every file; otherwise the files you
  approved are restored from snapshots taken before the edit.
- Prompt history: `Up` / `Down` at the start of the message box (the last 50, per workspace).
- A status bar item with the model, mode and usage; click it for model, provider, mode, rules and the chat.
- Auto-approve rules for edits and commands (`/permissions`, or Settings), mapped onto the agent's
  own modes; its built-in blocks and deny rules always apply.
- `/export` and the view's `...` menu: the conversation, tool calls included, as Markdown.
- `/compact` and `/usage`, and usage in the status bar, with a fahh-agent that lists them in its
  ready line (the next Fahh Editor release); hidden with an older one.
- The 0.2.x `fahhLocal.*` settings are no longer read.

## 0.3.1

Slash commands, every provider fahh-agent supports, a model picker, a real chat with tool and
approval cards, and self-update from the Fahh site.
