# File Icon Themes & Open VSX Marketplace

Fahh Editor shows file and folder icons in the explorer, editor tabs, breadcrumbs, Quick Open (Ctrl+P) and search results. All of them use one resolver, so a file gets the same icon everywhere.

---

## Built-in Icon Themes

Pick one in the Themes panel under **File Icon Theme**:

| Icon Theme | Description |
|---|---|
| **Material** *(Default)* | Full-colour icons from [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) (MIT). Fahh ships a curated subset of about 160 icons. Light-background variants are used with the Fahh Light theme. |
| **Fahh Colour** | Lucide line glyphs tinted by file type. |
| **Minimal** | Monochrome Lucide line glyphs. |

### How a file's icon is chosen
1. Exact filename, case-insensitive (`package.json`, `Cargo.lock`, `Makefile`, `.prettierrc`).
2. Longest extension suffix (`x.d.ts`, `x.test.ts` and `x.spec.tsx` each beat plain `.ts` / `.tsx`).
3. A known filename with a suffix (`Dockerfile.dev`, `.env.local`).
4. The editor's language id, for open tabs.
5. The default file icon.

Folders match by name (`src`, `node_modules`, `.git`, `.vscode`, `public`, `assets`, `tests`, `docs`, `target`, `venv`, ...) and have open and closed variants; anything else gets the default folder.

The vendored icons live in `src/assets/file-icons/` (with upstream's LICENSE). To change the subset, edit the seed lists in `scripts/gen-file-icons.mjs` and rerun it against an extracted `material-icon-theme` npm package.

---

## Open VSX Extensions

Installing an icon theme from the Extensions panel does **not** change Fahh's icons: Fahh cannot run VS Code icon-theme packages. Switch icon themes from the Themes panel.

---

## Extension Architecture Note

Open VSX packages (`.vsix`) are designed for VS Code's Node.js extension host. Fahh Editor is a Tauri 2 + Rust + Monaco desktop application and does not run that host. PDF viewing, Markdown preview, HTML preview and CSV viewing are built into the editor instead.

---

## Colour themes from Open VSX

Search the Extensions view (`Ctrl+Shift+X`) for a colour theme (One Dark Pro, Dracula, Tokyo Night...) and press **Install**. Fahh downloads the extension from Open VSX, converts its theme to Monaco and the workbench, and lists it under Settings > Appearance. Uninstall removes it.

Other VS Code extensions (language servers, debuggers, commands) need the VS Code extension host, which Fahh does not run. Their Install button says so instead of pretending to work.
