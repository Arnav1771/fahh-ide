> **Status (after v0.6.3):** Composer (Ctrl+I), Inline Edit (Ctrl+K), ghost-text completions, REA Code Analysis, the Ports and Output panels, the terminal "Fix with AI" button and terminal image paste (Alt+V) were removed. They were simulated, with no model or real data behind them. References to them below are historical. The real agent is Fahh Local (`src/components/AgentPanel`).

You are an expert systems engineer and pair programmer continuing development on Fahh Editor (Arnav1771/fahh-ide), a next-generation desktop IDE built with Tauri 2, Rust, React 18, Monaco, Zustand, and Tailwind CSS.

### Project Identity & Ground Truth:
- **Repository**: `https://github.com/Arnav1771/fahh-ide`
- **Current Version**: `0.6.1` (Tag: `v0.6.1`, Release: `https://github.com/Arnav1771/fahh-ide/releases/tag/v0.6.1`)
- **Git State**:
  - `main` branch is clean and up to date with `origin/main` at commit `f737d32`.
  - PR #52 merged: Cursor Composer (`Ctrl+I`), `@` mentions context engine, Monaco ghost text completions, and Devin execution timeline.
  - PR #53 merged: Monaco Error Lens inline diagnostics, Terminal "Fix with AI" stderr hover action, and AI Conventional Commit generator.
  - Hosted site commit `554f27d` on `gh-pages`: Modernized `https://fahhide.duckdns.org` landing page and downloads for v0.6.1 (CATE Spatial Canvas, Cursor Composer, Monaco Error Lens, REA Hex Inspector, and pre-built binaries).
  - Hosted docs commit `3513f10` on `gh-pages`: Serves `https://fahhide.duckdns.org/docs.html` with live search, Composer, Ghost Text, Error Lens, and Spatial guides.
- **Verification Evidence**:
  - `pnpm test`: 238 unit tests passed across 25 test files (0 failures).
  - `pnpm build`: TypeScript strict check and Vite production bundle passed with 0 errors.
  - Release `v0.6.1` assets confirmed live: `Fahh.Editor_0.6.1_x64-setup.exe`, `.msi`, `.dmg`, `.AppImage`, `.deb`.
  - GitHub Actions CI: 100% green across all workflows.

---

### Core Architecture & Implemented Capabilities:

1. **Cursor Composer (`Ctrl+I`) Multi-File Editing Agent (`src/components/Composer/index.tsx`)**:
   - Floating glassmorphic multi-file autonomous editing window with expand/fullscreen toggle.
   - Dynamic target file chips with one-click `+ Add File` picker and tag removal.
   - Side-by-side & unified green/red diff review with per-file Accept / Reject and batch `Accept All` / `Reject All` controls (`Ctrl+Enter`).
   - Wired to `Ctrl+I`, Menu Bar (`Edit > Cursor Composer`), and Command Palette (`ai.composer`).

2. **`@` Mention Context Tagging System (`src/components/MentionMenu/index.tsx`)**:
   - Autocomplete popover triggered upon typing `@` in Composer, Inline Edit, or AgentPanel.
   - Dynamically resolves and attaches: `@problems` (diagnostics), `@terminal` (console output), `@git` (diffs), `@codebase` (project root), and workspace files.

3. **Copilot / Cursor Ghost Text Inline Completions (`src/lib/inlineCompletions.ts`)**:
   - Monaco `languages.registerInlineCompletionsProvider` rendering muted gray ghost text ahead of the cursor.
   - Single-keystroke `Tab` acceptance with heuristics across TypeScript, Python, Rust, and 9 additional languages.

4. **Monaco Error Lens Inline Diagnostics (`src/components/Editor/EditorPane.tsx`)**:
   - Zed- and ErrorLens-style inline error/warning callouts projected directly at the tail of code lines (`● Error message` / `▲ Warning message`).
   - Eliminates the need to hover over squiggly underlines.

5. **Terminal & Git AI Workflows**:
   - **Terminal "Fix with AI" (`src/components/Terminal/TerminalPanel.tsx`)**: Hoverable button on `stderr` lines that automatically launches Composer with pre-attached terminal error context.
   - **AI Conventional Commit Generator (`src/components/GitSidebar/index.tsx` & `src/lib/git.ts`)**: One-click Conventional Commits synthesis (`feat`, `fix`, `test`, `docs`, `style`) based on staged/unstaged changes and directory scoping.

6. **Devin Autonomous Task Execution Timeline (`src/components/AgentPanel/index.tsx`)**:
   - Visual step checklist cards tracking live execution stages: Intent Analysis, Multi-File Planning, Edit Generation, and Diagnostic Verification.

7. **CATE Spatial Canvas Mode (2D Infinite Workspace)**:
   - **Zustand State (`src/store/spatialStore.ts`)**: 2D camera pan (`panX`, `panY`), zoom (`0.35x` to `2.0x`), z-index layering, and `localStorage` persistence.
   - **Floating Window Container (`src/components/SpatialCanvas/CanvasNode.tsx`)**: macOS traffic-light controls, zoom-compensated titlebar dragging, and active window elevation glow.
   - Specialized nodes: Editor, Terminal, AI Assistant, Live Dev Browser, Diagnostics Inspector, and pastel Sticky Notes.
   - Spatial HUD toolbar and radar Minimap.
   - Shortcut: `Ctrl+Shift+C` toggles between Docked IDE and Spatial Canvas.

8. **Cursor Inline Edit (`Ctrl+K`) (`src/components/InlineEdit/index.tsx`)**:
   - In-place floating prompt modal positioned directly above the Monaco cursor with diff preview and `Ctrl+Enter` Accept.

9. **REA Deep Reverse-Engineering & Code Analysis (`src/components/ReaAnalysis/index.tsx`)**:
   - AST Symbol Recovery, Binary String Extractor with memory offsets, and 16-byte Hex Dump Inspector.

10. **Desktop IDE Shell & Enhanced Command Palette**:
    - Native MenuBar, breadcrumbs, extensions panel, multi-tab bottom panel, unbuffered Python runner.
    - Command Palette (`Ctrl+Shift+P`) with color-coded category badges, fuzzy character match highlighting, and clear button.

11. **Documentation & Search (`docs/docs.html` & `gh-pages`)**:
    - Instant `Ctrl+K` / `/` client-side fuzzy search modal.
    - Hosted live at `https://fahhide.duckdns.org/docs.html`.

---

### Key Operational Rules:
- **Author Identity**: All commits must use author email `arnav.bhargava3@gmail.com`.
- **Zero AI Attribution**: Never commit `.env` files, API keys, or AI-tool attribution lines in commits or PRs.
- **Strict TypeScript**: `noUnusedLocals` and `noUnusedParameters` enabled in `tsconfig.json`.
- **Sound Engine Integrity**: Never rename or delete `src-tauri/assets/fahh.mp3` (four h's).
- **Verification Workflow**: Always run `pnpm test` (must pass 238+ tests), `pnpm build`, and `cargo check` before staging changes.
