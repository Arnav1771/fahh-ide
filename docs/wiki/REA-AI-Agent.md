# REA AI Agent & Cursor Composer Integration

**REA (Reactive Engineering Assistant)** is Fahh Editor's native autonomous coding sidecar. It bridges natural language intent with Monaco code edits, terminal diagnosis, and multi-file architecture planning.

---

## Operating Modes

1. **Ask Mode**: Conversational assistance with codebase awareness. Answers architecture questions, explains algorithms, and inspects files.
2. **Auto-Edit Mode**: Surgical inline code modifications. Directly applies patches, creates new modules, and updates existing files.
3. **Plan Mode**: Multi-step implementation planning. Breaks complex features into dependency-ordered task checklists before writing code.

---

## Cursor Composer Integration (`Ctrl+I`)

- Pressing `Ctrl+I` opens the **Composer floating overlay** over the Monaco editor.
- Attach codebase context dynamically using `@` tags:
  - `@file <filename>`: Attach full file content.
  - `@folder <dirname>`: Attach folder tree summary.
  - `@terminal`: Attach recent terminal outputs or runtime errors.
  - `@codebase`: Global codebase semantic indexing.
- Review proposed diffs with accept/reject chunk controls.

---

## Audio Sound Effects Engine

Fahh Editor incorporates an auditory feedback system that sounds distinct tones for:
- Agent response completion
- Task success
- Terminal error detection
- File save confirmation
- Mode switching

Sound effects can be customized or muted from the Settings panel.
