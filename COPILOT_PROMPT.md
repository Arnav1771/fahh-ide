You are working in the repository: https://github.com/Arnav1771/fahh-ide

Read CLAUDE.md first. It tells you everything about this project.

Then read these files before writing any code:
- README.md
- docs/ARCHITECTURE.md
- docs/FAHH_SFX.md
- docs/INSTALLER.md
- Cargo.toml
- src/core/ (all .rs files — understand what already exists)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHAT ALREADY EXISTS IN THE REPO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The repo has a working Rust backend library with:
- src/core/editor.rs    — document model, tab management, undo/redo
- src/core/workspace.rs — async file system scanning
- src/core/terminal.rs  — build task execution abstraction
- src/core/lsp.rs       — LSP client abstraction + language providers
- src/core/plugin.rs    — capability-oriented plugin registry
- src/core/state.rs     — session persistence
- src/core/runtime.rs   — logging and panic boundary
- src/core/quality.rs   — startup acceptance gates
- Cargo.toml with: tokio, serde, serde_json, anyhow, thiserror, tracing

There is also:
- fahhhh.mp3 (the Fahh SFX sound file — 4 h's in the filename)
- fahh_editor_architecture.svg

There is NO frontend yet. No Tauri setup. No React. Just the Rust library.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR TASK — PHASE 1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Build Phase 1 of Fahh Editor. Do not skip ahead to Phase 2 without asking.

PHASE 1 DELIVERABLES:

1. Convert the existing Rust library into a Tauri 2 application.

   - Add tauri 2 and tauri-build to Cargo.toml
   - Create src-tauri/ structure (move existing Rust src into src-tauri/src/)
   - Create src-tauri/tauri.conf.json with app name "Fahh Editor", identifier
     "com.fahh.editor", window size 1400x900
   - Move fahhhh.mp3 into src-tauri/assets/fahhhh.mp3
   - Register the asset in tauri.conf.json so it's bundled
   - Create src-tauri/src/lib.rs that builds the Tauri app with
     .invoke_handler() and .run()

2. Set up the React + TypeScript frontend.

   - Create package.json with: react@18, react-dom@18, typescript@5,
     @tauri-apps/api@2, @monaco-editor/react, xterm@5, zustand,
     tailwindcss@4, vite@5, @vitejs/plugin-react
   - Create vite.config.ts configured for Tauri (no open, port 1420)
   - Create tsconfig.json with strict: true
   - Create tailwind.config.ts
   - Create src/main.tsx (React root)
   - Create src/App.tsx with basic layout:
     - Left sidebar (240px) for file tree
     - Main area for Monaco editor tabs
     - Bottom panel (200px) for terminal
     - Right sidebar (280px, collapsible) for AI panel

3. Implement the Fahh SFX system (top priority — this is the core feature).

   In src-tauri/src/core/error_detector.rs:
   - Create ErrorDetector struct with cooldown logic (default 3000ms)
   - On LSP error diagnostic: check cooldown, then emit Tauri event "fahh://error"
     with payload { file: String, line: u32, message: String }
   - On build task non-zero exit: same emit
   - Wire ErrorDetector into lsp.rs and terminal.rs

   In src/lib/fahh.ts:
   - listen("fahh://error", handler) using @tauri-apps/api/event
   - On event: play /assets/fahhhh.mp3 using Web Audio API
   - Reset currentTime to 0 before each play (so rapid errors replay cleanly)
   - Export initFahhSfx() — call this once from App.tsx on mount

   Add a Tauri command "test_fahh_sfx" that emits the event directly (for
   testing from command palette without needing a real error).

4. File tree sidebar.

   In src-tauri/src/core/workspace.rs (already exists — extend it):
   - Add a Tauri command "get_file_tree" that returns the directory tree
     as JSON for a given workspace path
   - Add a Tauri command "watch_workspace" that uses the notify crate to
     stream file change events to the frontend

   In src/components/FileTree/:
   - FileTree.tsx — renders the directory tree from the Tauri command
   - Clicking a file opens it in the Monaco editor
   - Shows git status icons (M, A, D, ?) next to file names

5. Monaco Editor with tabs.

   In src/components/Editor/:
   - EditorPane.tsx — wraps @monaco-editor/react
   - TabBar.tsx — shows open file tabs, supports close, dirty indicator (•)
   - Use the Zustand editor store to track open files and active tab
   - Read file contents via a Tauri command "read_file"
   - Save via Tauri command "write_file" on Ctrl+S

6. Integrated terminal.

   In src/components/Terminal/:
   - TerminalPanel.tsx — wraps xterm.js Terminal
   - Connects to the backend via Tauri commands "start_pty" / "write_pty"
   - Uses the existing terminal.rs abstraction

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TECH RULES (non-negotiable)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Tauri 2 only. No Electron. No Docker.
- React 18 functional components only. No class components.
- TypeScript strict mode. No any. No @ts-ignore.
- Zustand for global state. useState for local component state.
- TailwindCSS 4 for all styling. No inline styles. No CSS modules.
- No unwrap() in production Rust. Use ? or handle explicitly.
- The fahhhh.mp3 filename must not change. Ever. It has 4 h's.
- Use pnpm as the package manager.
- Target: Windows 10+, macOS 13+, Ubuntu 22.04+

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REFERENCE ARCHITECTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use https://github.com/0-AI-UG/cate as the reference for:
- How to structure the panel layout (sidebar, editor area, terminal, git panel)
- How to implement the file tree
- How to wire the terminal

Do not copy code from CATE. Reimplement the patterns in this stack.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHEN PHASE 1 IS DONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Stop and ask me to review before starting Phase 2. Phase 2 covers:
- LSP client wired to diagnostics panel
- Git sidebar
- AI panel with MCP
- Optional tools installer wizard (n8n, browser-use, Flowise, CLIs)
- Settings panel with Fahh SFX toggle
- Infinite canvas mode

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEFINITION OF DONE FOR PHASE 1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Phase 1 is complete when ALL of these are true:
- pnpm tauri dev starts the app without errors
- The window opens showing the three-panel layout
- Clicking a file in the file tree opens it in Monaco
- The terminal panel accepts input
- Making a syntax error in an open file triggers the Fahh SFX
- "Fahh: Test Error Sound" command palette entry plays the sound manually
- cargo test passes
- pnpm lint passes
