# Fahh Editor — AI Starter Prompt

Copy-paste this at the start of any new AI conversation to instantly orient the model:

---

## Paste this verbatim

```
You are continuing development on Fahh Editor — a cross-platform desktop IDE built with 
Tauri 2 (Rust backend) + React 18 + TypeScript frontend. The repo is at 
https://github.com/Arnav1771/fahh-ide and the live site is at 
https://arnav1771.github.io/fahh-ide/

Before doing anything, read these files from the repo in this order:
1. IMP_DOCS/HANDOFF.md    — full project state, what works, what's broken, next steps
2. IMP_DOCS/TECH_SPEC.md  — architecture, every Tauri command API, env setup, known bugs
3. IMP_DOCS/PROMPT_TRAIL.md — every decision made so far, why things are the way they are
4. CLAUDE.md              — original feature spec (source of truth for intent)

After reading, confirm what you understood and ask me what I want to work on next.

Key facts to keep in mind:
- The app's signature feature is fahhhh.mp3 (4 h's) — plays when code has errors. Never rename it.
- GitHub account: Arnav1771 (credentials in Windows Credential Manager)
- Local repo: D:\OneDrive - Aligned Automation Services Private Limited\Documents\fahh
- Current version: v0.2.0 — released, 9 assets on GitHub Releases
- pnpm tauri dev on Windows needs VS Build Tools (install as Admin) — not yet done
- pnpm tauri dev in WSL works — run as root: wsl -d Ubuntu -u root bash -c "..."
- TypeScript strict mode, no any, no unwrap() in Rust
- Every new Tauri command needs: Rust fn + lib.rs registration + tauri.ts wrapper + capabilities/default.json grant
```

---

## What the AI will know after reading those 4 files

- Full repo structure and every file's purpose
- All 20+ Tauri command signatures with TypeScript types
- What Phase 1 is done vs what Phase 2 still needs
- Every bug that was hit and how it was fixed (so it doesn't repeat them)
- The WSL dev workflow with all the gotchas (sudo hang, CRLF, path translation, apt mirror hang)
- The CI/CD release process and race-condition fix
- Why capabilities/default.json exists and what permissions are needed
- The website structure (landing page, docs, web IDE)
- The color system, font choices, design tokens

## What the AI will NOT know (context from this session that didn't make it to docs)

- The 650k token conversation history — it's not in the docs, just the outcomes
- Real-time system state (what's running, open windows, etc.)
- Personal preferences not captured in CLAUDE.md

## Suggested first message after the starter prompt

> "What's the highest priority thing to work on next?"

The AI will read HANDOFF.md and point you to the Phase 2 priority list.
