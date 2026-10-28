# Outline, Timeline and Git in the Status Bar

---

## Outline

The **Outline** view lists the symbols in the active file: classes, functions, methods, structs, traits, interfaces, top-level constants, and Markdown headings. Methods are nested under their class by indentation. The symbol the cursor is in is highlighted. Click a symbol to jump to it.

It reads declarations directly, so it works in every language without a language server. A declaration split over several lines may be missed.

## Timeline

The **Timeline** view lists the commits that changed the active file, newest first, with author and age. Click a commit to see what it changed in this file. It refreshes after you commit or sync.

History stops at a rename (like `git log` without `--follow`).

## Git in the status bar

When the open folder is a git repository, the left of the status bar shows:

| Item | What it does |
|---|---|
| **Branch name** (`*` when there are changes) | Opens Source Control |
| **Sync** (↓ commits to pull, ↑ commits to push) | Pulls, then pushes, like VS Code's Sync Changes |
| **Publish** (cloud icon, for a branch with no upstream) | Pushes the branch to `origin` and sets it as upstream |

Pull and push use your installed `git` and its credentials (Git Credential Manager, SSH keys), so they behave like they do in a terminal. The counts follow the last fetch; Sync fetches. The status refreshes when files change and when the window regains focus.

Both views can be opened from the command palette (**Outline**, **Timeline**; **Sync Changes** for git) and dragged anywhere like any other view.
