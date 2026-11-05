# Changelog

All notable changes to Fahh Editor are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added — language features (planned v0.8.0)

- **Language servers do more than squiggles.** Completion (with `completionItem/resolve` for docs and auto-imports), hover, go to definition (another file opens in a tab at the symbol), Find All References (Monaco's peek, unopened files included), rename across files (F2), signature help, quick fixes and refactors (Ctrl+. applies the server's edits), inlay hints and same-symbol highlights. Each provider is registered only while a server that offers it is running.
- **One source per language, no doubled suggestions.** While typescript-language-server, vscode-css/html/json-language-server is up, Monaco's built-in TS/JS/CSS/HTML/JSON worker features for that language stand down; when no server runs (not installed, starting, crashed) the built-in workers answer as before.
- **Rename and quick fixes stay undoable.** An open file takes the edit as one undo step (Ctrl+Z). A file that is not open is written to disk and its old text kept: palette **Language: Undo Rename in Closed Files** puts it back. Servers are told about those writes (`workspace/didChangeWatchedFiles`).
- **ESLint, Ruff and Tailwind** run beside the main server when installed: `vscode-eslint-language-server` (when the project has an ESLint config or dependency), `ruff server` for Python, `tailwindcss-language-server` (when the project uses Tailwind). Their diagnostics merge with the main server's instead of replacing them. **Check Setup** lists all three with their install commands.
- **Emmet** (`emmet-monaco-es`, MIT) in HTML, CSS/SCSS/Less and JSX/TSX, and **relative path completion** in import strings, `src`/`href`, `url()` and Markdown links (from the explorer's tree; skipped when a language server already does it). Settings > Editor gets **Inlay hints** and **Emmet** switches.
- Editor: **linked editing** (rename an HTML/JSX tag pair together) and inlay hints on.
- **TODOs view** (sidebar, palette "View: TODOs"): every TODO / FIXME / HACK in the folder through the workspace search, grouped by file, refreshed on save; click to jump to the line.
- HTML and Markdown previews **reload on save**, so a saved stylesheet, script or image they use shows up.
- Palette: Find All References, Rename Symbol, Quick Fix….

### Fixed — language server plumbing

- `initialize` is now awaited before `initialized` and the first `didOpen` (they used to be sent back to back), and requests the server sends (`workspace/configuration`, `window/workDoneProgress/create`, `client/registerCapability`, `workspace/applyEdit`…) are answered. pyright and ESLint wait for those answers.
- Document sync follows the Monaco model, not React state: `didOpen` per model, incremental `didChange` with the model's version (full text for servers that ask for it), `didClose` when a tab's model goes, `didSave` after Save. Messages to a server go through one queue, so a change always arrives before the completion request typed after it.
- Document URIs are proper file URIs (`file:///c%3A/...`, `file://wsl.localhost/...`); they were `file://C:\...`, which servers could not map back to the open tab on Windows.
- Servers keep running while any tab of their language is open (switching between a .py and a .ts tab used to kill and restart them) and stop when none is.
- On Windows the server binary is spawned by its resolved path, so npm's `.cmd` shims (typescript-language-server, pyright-langserver, the vscode-*-language-server family) start.

### Fixed

- **New Window opened a blank white window (Windows).** The `open_new_window` command was synchronous, so it ran on the UI thread, where building a WebView2 deadlocks; it is async now, and `fahh <folder>` from a shell builds its window off the UI thread too. A window that fails before the app mounts now shows the error and a Reload button instead of white.
- **New terminal tabs stayed empty while another terminal was busy.** Writes and resizes to every shell ran on the UI thread under one lock, so a shell that stopped reading (a TUI streaming output) froze them all, and new shells never started. Each terminal now has its own I/O thread, spawning runs off the async workers, and a tab whose shell fails says "Couldn't start ..." (or "Still starting ..." after 10 s) instead of staying blank.
- **The terminal could not scroll back and ignored resizes.** A shell started before the panel was laid out kept that size (a 12x7 ConPTY), and resizes made while it was starting were dropped, so a TUI drew into a corner with no scrollback. The terminal fits again before starting the shell, sends the latest size once it exists, and re-fits when its tab is shown. Shift+wheel always scrolls the scrollback, even while a program has mouse reporting on.
- **Kill Terminal on the last tab did nothing visible.** It killed the shell and at once started a fresh, blank "terminal" tab. Now the panel is left empty with a **New Terminal** button, as in VS Code. Kill also ends everything the shell started (`claude.exe`, dev servers): on Windows each shell runs in a job object, which also ends every terminal's processes when Fahh exits. Closing a window ends its terminals, and reloading a window ends the shells its old page started. Before, those shells kept running unseen.
- **Split panes had no identity.** Each pane of a split has a header with its shell and folder ("PowerShell — agent-proj"), its own kill button and right-click menu, and a clear outline on the focused pane. The split shows as one tab ("PowerShell, PowerShell"). Clicking another tab while split now shows that terminal instead of the split.
- Terminal output goes only to the window that owns the terminal, not to every window.
- `exit` or Ctrl+D (exit code 0) closes the tab. Any other exit leaves "Process exited (code N)" in it. Tabs can be renamed (double-click or right-click > Rename). On Windows, Ctrl+V pastes, as in VS Code. The shell gets the new size once a panel drag settles, not once per pixel.

### Changed

- `fahh <file>` from a shell while Fahh is running opens the file as a tab in the window you used last (like `code file`), instead of a whole new window. Each extra window is a separate WebView renderer (~160 MB), so opening five files that way cost about 800 MB. Folders and workspace files still open their own window.

### Added

- **First run, rebuilt:** a five-step welcome where every step is something to do, with ticks as you go and Skip on every step plus Skip tour. 1 Sound: ring the bell, set the volume or mute, and pick your own error sound. 2 Code: Open Folder, Open Recent, open a VS Code `.code-workspace`, a WSL hint on Windows, and a one-line try-it box where breaking the JavaScript rings the real fahh. 3 Look: Fahh Gold, Fahh Dark or Fahh Light applied live behind the card, and a button that really moves Explorer to the right and back. 4 Fahh Local (optional): provider, key and a real Test connection (the models list). 5 Check Setup, live. Shown once; **Help > Welcome** (or "Show Welcome") brings it back. Focus trap, Esc, Left/Right between steps, fits a 480 px window.
- **Custom error sound:** Settings > Fahh > Error sound (and the welcome tour): Change sound… takes an mp3, wav, ogg or m4a up to 5 MB, previews it, and every fahh plays it (diagnostics, failed runs, failed terminal commands, the bell), at the Settings volume and respecting mute. Fahh keeps its own copy in the app data folder, so moving the original changes nothing. Reset to default brings the fahh back. Files that are too big or not audio are refused with the reason. New Rust commands `set_custom_sound`, `load_custom_sound`, `clear_custom_sound`, with tests.
- **Check Setup** (Help > Check Setup…, palette "Fahh: Check Setup"): git, Python, Node, cargo, WSL (Windows) and the language servers Fahh uses (rust-analyzer, typescript-language-server, pylsp or pyright), each with its version, or its one-line install command when missing. New Rust command `check_setup` (spawns through `core::proc::cmd`, 5 s timeout per tool), with version-parsing tests.
- **Quiet update check at launch:** at most once a day, a toast once per new version, never a popup. Off switch in Settings > Updates; Help > About still checks on demand.
- **Dockable layout** (dockview 8.5.1): drag Explorer, Search, Source Control, Extensions, Colour Theme, Fahh Local, Problems, Debug Console, Terminal and Run to the left or right side bar, the bottom panel, or the editor area as tabs.
- **Editor splits:** Split Editor Right (Ctrl+\) and Split Editor Down; drag tabs between groups. A file open twice shares one model.
- The layout is **saved per workspace** and restored on launch; **View > Reset Layout** brings back the default (Explorer left, Fahh Local right, panel below).
- Keyboard path for every drag: palette commands "Move <view> to Left Side Bar / Right Side Bar / Panel / Editor Area", plus Toggle Primary / Secondary Side Bar (Ctrl+B / Ctrl+Alt+B) and Toggle Maximized Panel.
- **Tabs:** drag to reorder inside a group, middle-click to close, and a right-click menu: Close, Close Others, Close to the Right, Close All, Copy Path, Copy Relative Path, Reveal in File Explorer. Every close of unsaved work asks **Save / Don't Save / Cancel**, once for a whole batch.
- **Ctrl+Tab / Ctrl+Shift+Tab** walk the open tabs in most-recently-used order while Ctrl is held. **Ctrl+Shift+T** reopens the last closed tab.
- **Ctrl+K Ctrl+W** closes all tabs (the File menu already listed it; now it works, in and out of the editor, without breaking Monaco's own Ctrl+K chords).
- **Back / Forward** (Alt+Left / Alt+Right, and arrows in the title bar) through file switches and long jumps: search results, Problems, go to definition.
- **File > Open Recent:** the last 10 folders and workspace files, newest first, with Clear Recently Opened (also in the palette).
- **Session restore:** the last folder (or workspace) reopens at launch with its tabs back in their dock groups; tabs whose files are gone become Welcome placeholders. Off switch in Settings.
- **Explorer:** Refresh, New Folder, Collapse Folders, and drag and drop to move files and folders (open tabs follow, like a rename; a folder cannot go into itself). New Rust commands `create_dir`, `move_path` (never overwrites) and `reveal_path`, with tests.
- **Settings** (View > Settings, Ctrl+, or the gear): editor font family and size, word wrap, minimap, line numbers, tab size, insert spaces, auto save, fahh volume, lifetime fahh count, terminal font size, restore session. Changes apply to every open editor at once and are saved.
- A **failed terminal command** (non-zero exit) fahhs, like a crashed run; the fahh respects mute and the new volume. The **lifetime fahh count** is kept and shown in the status bar tooltip and Settings.
- **Help > About** is a real dialog: version, release notes link, and **Check for updates** against the latest GitHub release, with a download link for your platform.

### Changed

- The old three-card welcome (Next, Next, Next; it still called Fahh Local "the AI panel") is replaced by the interactive tour above. Help > Welcome Tour is now Help > Welcome.
- `window.prompt` / `confirm` / `alert` are gone: every question is an app dialog (focus stays inside, Esc cancels).
- Narrow side bars show view tabs as icons, with the active one named and the full name as a tooltip (no more "Sear…").
- Clicking a file that is already open switches to its tab instead of re-reading it from disk (which replaced unsaved changes).

### Fixed

- **Fahh Light:** the title bar was fixed near-black, hiding the folder name and the Canvas label; Fahh Local's Ask / Done buttons were white on white. Tailwind dropped every `bg-fahh-*/NN` opacity class (a plain `var()` cannot take an alpha), so those buttons had no background in any theme; theme colours now support opacity. Muted text in Fahh Light is darker (5.6:1).
- Ctrl+W no longer logs "Illegal value for lineNumber" (a closing editor emptied its model under its markers) or "Canceled" (Monaco cancelling a pending word highlight).

### Added (Fahh Local)

- **Sessions**, saved after every step per workspace with their checkpoints: new (**+**, `/clear`), list and switch (clock button, `/ls`, `/resume`, `/continue`), rename (`/title`), delete (**Delete** in the list, `/rm-session`), plus `/steps`, `/fork`, `/revert <step>`, `/undo`, `/export`, `/compact`, `/context`, `/usage`.
- **Modes**: Normal (Ask), Accept Edits, Smart (a judge model screens commands), Plan, Bypass (red badge; deny rules still apply), and one-shot `/ask`.
- **Slash commands**: a `/` menu in the panel and the same commands in the `fahh-agent` REPL, from one table (`src/lib/slash-commands.json`).
- **`/loop <prompt>`**: run, then a reviewer subagent checks the diff and asks for fixes until it approves (3 rounds by default); one step, one `/revert`.
- **Subagents**: `.fahh/agents/*.md` and `~/.fahh/agents/*.md` definitions plus built-in `explore`, `reviewer`, `planner`; a `delegate` tool, `/agents`, `/agent <name> <task>`, per-child Stop, never more permission than the parent.
- `fahh-agent` CLI: `-c`, `-r <id>`, `-p`, `--prompt-file`, `--config`, `--export`, `--fast-model`, `--judge-model`, `models list`, `sessions ls`; bundled next to the editor (`scripts/prepare-sidecar.mjs`).
- `Ctrl+Shift+A` toggles the panel everywhere; `Ctrl+L` too, except in the editor (select line) and terminal (clear).
- A run-status line built from the turn's events (running subagent or tool, or waiting for the model).

### Fixed

- The agent's `get_diagnostics`, the "fahh when the agent adds errors" check and the selection context were always empty: `window.monaco` was never set. `monaco-setup.ts` sets it now.
- Steer (`Ctrl+Enter` while running) waited a fixed 150 ms after Stop and could hit "the agent is already working on a turn"; it now sends once the turn has really ended.
- `core::debugger::tests::free_port_is_actually_free` was flaky: a parallel test could take the released port before the rebind. It now retries.

### Removed (simulated)

- **Alt+V / paste image in the agent panel**: it only typed `[Image: name attached]` into the prompt. No provider path here sends images, so the model never saw one.
- The fixed **"Devin Task Execution Loop / analyzing AST"** banner shown while the agent ran (replaced by the real run-status line).

---

## [0.7.4] — 2026-11-05

### Added

- **Generate code in notebooks:** ✨ Generate in the notebook toolbar, or "Generate code below" between cells. Describe the cell (Enter to generate, Esc to cancel) and Fahh Local's provider and model types the code into a new cell below, live, with Stop. It sees the cells above (trimmed to fit) with their short text outputs and, when the kernel is running, its live state: variables with their types, DataFrame shapes, columns, dtypes and `head(3)`, array shapes and dtypes, and the imports in use. So it uses your names and does not re-import or reload data. Only code comes back (fences and `<think>` blocks are stripped). Nothing runs on its own: the new cell is selected with Run, Regenerate and Discard, and is saved into the `.ipynb`. No model set up yet? It says so and opens Fahh Local's settings. New Rust commands `agent_generate` / `agent_generate_stop` (one plain streamed completion, no tools) and a silent `inspect` op in the kernel runner (no execution count, no history, not saved).
- **Notebook code cells are editable in place:** click a code cell to edit it; it saves into the `.ipynb` when you click away, Ctrl+Enter saves and runs, Esc cancels. While cells run, an edit stays open until they finish; it is written on top of the outputs the runner saved, so outputs are never clobbered.
- **Roundtable pictures:** notes show their pictures as thumbnails, loaded from the table's server; click one for a full-size lightbox (Esc or Close, plus Open in browser). A picture whose table emptied reads "picture removed", not a broken image. Share pictures by pasting into the message box (Ctrl+V), the picture button (file picker), or dropping files on the composer (the desktop's own drop event, read with the fs plugin, as the terminal does). Preview chips with a remove button; checked before upload (PNG, JPEG, WebP or GIF, 5 MB each, 4 at a time) with the reason for each refusal. While uploading: "Sharing picture 1 of 2…" and Send is locked; a failure shows the server's own message and keeps pictures and text attached; success says "Shared". Pictures go as a note (text optional); Ask with pictures shares them first, then asks. New tested helpers in `src/lib/roundtable.ts`: `checkPictures`, `pictureType`, `mediaUrl`, `sayBody`, `uploadPicture`.

### Fixed

- **Notebook Run all ran cells out of order** (cell 17 first, then 1, 7, 3…; or a later cell hit `NameError` and "stop at first error" dropped the rest). Each cell was its own concurrent `run_stdin` invoke, so lines reached the kernel in any order. Run all now sends every cell in one write, and every kernel write goes through one ordered queue; commands queued while the kernel starts are no longer lost when its "ready" arrives before the process id. Tested with random write delays.
- **Fahh Local wrote cut-off files and marked them done.** When a model hit its output-token limit in the middle of a `write_file` (OpenAI-compatible `finish_reason: "length"`, Anthropic `stop_reason: "max_tokens"`), the stream ending was ignored; some servers close the cut-off call into valid JSON themselves, so a 497-byte half notebook was written with a ✓. A call that was still open when the output was cut off, or whose arguments are not a complete JSON object, is now never run: it shows as a failed step and the model is told to write the file in smaller parts. Nothing repairs truncated arguments.
- `write_file` / `edit_file` check `.json` and `.ipynb` before writing: the result must be valid JSON, and a notebook needs a `cells` array and `nbformat`. On failure nothing is written and the parse error goes back to the model. (An edit to a file that is already broken is allowed, so it can be fixed step by step.)
- The notebook preview's "Not valid notebook JSON" error now says why that happens and has **Open source at line N**, which opens the source at the line where parsing failed.

## [0.7.3] — 2026-11-05

### Added

- **Run Jupyter notebooks in the preview.** A live kernel per open notebook, like VS Code: ▶ Run cell on each code cell, Run all, Interrupt and Restart; `[*]` while a cell runs, then its count, with outputs (text, pandas HTML tables, matplotlib plots, tracebacks) appearing as they stream. Variables persist between runs. Outputs and counts are saved into the `.ipynb`. Only `ipykernel` is needed in the environment: Fahh ships a small runner (`src-tauri/assets/fahh_kernel.py`) that drives it with `jupyter_client`. A **kernel picker** lists the workspace `.venv` / `venv`, conda envs, `py -0p` and PATH Pythons (`Python 3.11 · .venv (workspace)`), marks those without ipykernel, and remembers the choice per notebook. Without ipykernel the notebook shows the exact `<python> -m pip install ipykernel` with Run in terminal and Copy; nothing is installed silently. New Rust commands `python_kernels` and `run_stdin`.

### Changed

- **Python uses the project's venv.** Run (Ctrl+F5) used the system Python even with a `.venv` in the folder. Run, Debug (debugpy) and notebooks now pick, as VS Code does: Settings > Python > Interpreter path, then `<folder>/.venv` or `venv` (`Scripts\python.exe` on Windows, `bin/python` elsewhere), then `python` / `python3` on PATH. The Run header shows it: `Running which.py [python · .venv]`. New Rust command `python_interpreter` (pure `pick_python`, tested for both layouts and the order).
- Fahh Local provider settings: models load live from the provider's `/models` list (through the backend, so no CORS), filtered to chat models, with loading, error (e.g. "Key rejected (401)") and retry states. Hardcoded model lists are gone. Built-in providers no longer show their base URL (an "Edit endpoint" disclosure covers proxies); "Custom (OpenAI-compatible)" asks for a validated base URL and an optional key. Key placeholders say what each provider's key looks like.

### Fixed

- **One model picker everywhere in Fahh Local.** Settings Model, Fast model, the panel-header model dropdown and the Welcome tour's Fahh Local step now all render the same `ModelPicker` (`src/components/ModelPicker.tsx`) over the same live `agent_list_models` list: one skeleton while loading, one error line with Retry, one empty-list hint, and "Type a model name…" on every one (Fast model adds "Same as main model"). The header dropdown used to have no escape hatch and no error state; the Welcome step could not choose a model at all. A test fails if a picker binds the model with its own `<select>` again.
- **Accept all / Reject all in the agent's review.** "Review: N files changed" gets **Accept all** (keeps every file still under review) and **Reject all** (restores them: the whole-turn revert when nothing was accepted yet, otherwise only the pending files, so accepted ones stay). Shown when two or more files are pending (one file has its own ✓ ✗), keyboard reachable, and confirmed with a toast ("Accepted 2 files"). New reducer action `turn_accepted` and store action `rejectAll`, both tested.
- **Spatial Canvas terminal: selection landed on the wrong row/column.** The canvas zooms nodes with CSS `transform: scale()`, and xterm.js measured the scaled terminal but divided by unscaled cell sizes, so at any zoom but 100% a drag selected the line above (zoom < 100%) or below (zoom > 100%). Selection, double-click word select, link clicks, right-click (word select and the Copy/Paste textarea), middle-click paste, drag-to-scroll and app mouse reporting (vim, htop) now map the pointer back through the zoom. The docked terminal was never affected.
- **PowerShell terminals load your profile and `.venv\Scripts\Activate.ps1`.** On a machine left at Windows' default execution policy (Restricted) every new Fahh PowerShell printed "running scripts is disabled on this system" and venvs could not be activated. Fahh now starts PowerShell / pwsh terminals with `-ExecutionPolicy RemoteSigned` for that process only; machine and user policy are untouched, Group Policy still wins, never Bypass. Settings > Terminal > **PowerShell script policy for Fahh terminals** (RemoteSigned / System default) switches it off. The Run panel runner is unaffected (it does not go through PowerShell).

## [0.7.2] — 2026-11-04

### Fixed
- Roundtable panel crashed when a turn started streaming output (#109).

## [0.7.1] — 2026-11-03

### Added
- Roundtable panel: start or join a shared coding table, live transcript, typing status, ask/note, own keys, undo, files, invite, connect your AI agent (#107).

## [0.7.0] — 2026-10-29

### Added
- Format on save, trim trailing whitespace, final newline (#105).
- Git change bars in the gutter (#105).
- Clickable file:line locations in the terminal; drop files to type their paths (#105).
- Explorer shows dotfiles and deep folders (#105).
- Sticky scroll, bracket pair colours, ligatures, relative line numbers, multi-cursor modifier, window zoom (#105).
- Breadcrumb folder menus; Fahh Local prompt history (#105).
- Release emails to newsletter subscribers (release workflow) (#105).

### Fixed
- Debug Console output split across lines (#105).

---

## [0.6.9] — 2026-10-29

### Added
- Your own AI endpoints in Fahh Local, with model fetching (#103).

### Fixed
- Title-bar Minimize / Maximize / Close (#102).
- Groq model presets; rate-limit waits and retries; free-tier output caps; empty final answers; empty search path (#102).

---

## [0.6.8] — 2026-10-28

### Changed
- Installers: publisher Stealth Keqing (Add/Remove Programs, MSI, exe details), setup-wizard artwork, installer icon, license page, Start Menu folder (#100).
- One-line installs for every OS in the docs (#99).

---

## [0.6.7] — 2026-10-28

### Changed
- Accounts use Fahh's own backend (a separate Neon project), with email verification by code from StealthAI. Old test accounts do not carry over.

---

## [0.6.6] — 2026-10-28

### Added
- **Git in the status bar:** branch, Sync Changes with pull/push counts, Publish Branch (#95).
- **Outline view** for any language and Markdown (#95).
- **Timeline view:** commits that changed the active file, with their diffs (#95).
- **Settings search** and section navigation (#96).
- **Account menu** in the activity bar (#96).
- Terminal **+** names the profile it starts (#96).

### Fixed
- Real installer sizes and measured memory figures in the docs and site (#94).

---

## [0.6.5] — 2026-10-28

### Added
- **Run and Debug:** DAP debugging (Python/debugpy, Go/Delve, C/C++/Rust/lldb-dap), gutter breakpoints, F5/F9/F10/F11, Variables, Call Stack, Debug Console, `.vscode/launch.json` (#92).
- **Terminal:** real shells on a pseudo-terminal (PowerShell, Command Prompt, Git Bash, WSL; bash/zsh), profiles, split, default profile, Run Task from `.vscode/tasks.json` (#92).
- **Agent mode:** Agent | Editor switch, sessions sidebar, Ctrl+Shift+A session search (#92).
- **Remote Explorer:** WSL distros, SSH hosts, Docker containers (#92).
- **DeepWiki:** See Wiki on any symbol: definition, docs, usages, AI explanation (#92).
- **Open VSX colour themes** install for real; other extensions explain why they cannot run (#92).
- **Accounts and settings sync** on Fahh Cloud (Neon): sign up, sign in, email codes, forgot password, upload/download settings and theme, newsletter opt-in, What's new popup (#93).
- **Dockable layout** with split editors and a saved layout per folder (#85).
- **Fahh Local** sessions, modes, slash commands, `/loop`, subagents (#86).
- **Onboarding** tour, custom error sound, Check Setup, daily update check (#89).
- **QoL:** MRU tabs, back/forward, Open Recent and session restore, explorer drag-and-drop, Settings page, app dialogs (#87).

### Fixed
- The Explorer refreshes on changes made outside it (file watcher) (#92).
- View shortcuts (Ctrl+Shift+E/F/G/X/D) work (#92).
- `fahh <file>` opens a tab in the running window (#90).
- Windows MSI build (fahh-agent packaged twice); UTF-8 BOM files and notebooks open correctly (#88).
- Blank window after restoring a WSL session (#88).

---

## [0.6.4] — 2026-10-22

### Added

- **Jupyter notebooks (.ipynb)** open in a read-only viewer: markdown, highlighted code, outputs, images, errors (#78).
- **Real file icons** (Material Icon Theme subset, MIT) in the explorer, tabs, breadcrumbs, Quick Open and search, with light-theme variants. Installing an extension no longer switches the icon theme (#79).
- **VS Code workspaces:** `.code-workspace` loads with JSONC, relative folders, `vscode-remote://wsl+` / `file://` URIs and `files.autoSave`; `fahh x.code-workspace` works (#77).
- `test-build.yml`: push `testbuild/*` to get installers for every platform without a release (#77).

### Fixed (Windows / WSL, #77)

- Terminal in a `\\wsl.localhost\...` folder runs in WSL in that folder (it used to run in `C:\Windows`); `cd` keeps working in every shell.
- Run on files in WSL runs inside the distro instead of failing with `os error 267`.
- **+ Shell** (PowerShell / Command Prompt / Bash-WSL) really switches shell.
- New windows (`fahh-win-*`) get the same permissions as the main window.
- Open Folder opens one dialog and reports failures.

### Removed (simulated features)

These looked like features but had nothing behind them, so they are gone rather than kept as demos:

- **Composer (Ctrl+I)**: a timer that wrote canned keyword templates into files. Removed with its store, menu item, palette command and the agent-panel button.
- **Inline Edit (Ctrl+K)**: same canned output. Ctrl+K is no longer captured, so Monaco's Ctrl+K chords work again.
- **Ghost text**: a fixed list of snippets offered as "predictions".
- **REA Code Analysis**: the activity-bar panel, View menu entry, palette command and canvas node. Saved canvas layouts drop the old REA node on load.
- **Ports and Output panels**: hard-coded sample ports and seeded log lines.
- **Terminal "Fix with AI"**: it opened the fake Composer. The agent panel has no way to take a prefilled prompt, so the button is gone; paste the error into Fahh Local instead.
- **Terminal image paste (Alt+V)**: it typed `[Image: name]` into the command line.

### Fixed

- Close Tab, Close All Tabs and the palette's Close Active Tab now ask before discarding unsaved changes, like the tab's own close button. The store's unguarded `closeTab` is removed, so every close goes through `requestClose`.
- Ctrl+W closes the active tab (guarded) and Ctrl+N opens a new untitled file; both were shown in menus but did nothing. The Ctrl+B label is removed (there is no sidebar-hide state).

### Fixed earlier (v0.5.1 "stop losing work", shipped in v0.6.x, recorded late)

- No console window flashes on Windows: every child process is started through `core::proc::cmd`, and CI rejects a bare `Command::new(`.
- Themes paint their own editor background (Fahh Light is readable again).
- Unsaved work is guarded: closing a dirty tab or the window asks first, and the dirty dot clears when undo returns to the saved text.
- Ctrl+S saves from anywhere (explorer, terminal, panels) and shows a toast; a failed save says so.
- Renaming or deleting a file in the explorer keeps its open tab in step (a dirty file asks before it is deleted).
- Focus: the terminal no longer traps Tab (Esc returns to the editor), dialogs trap focus and give it back, Esc closes Optional Tools.
- The sidebar and bottom panel can be dragged (or resized with the arrow keys) and remember their size.
- Terminal: header shows the shell, Up/Down history, Clear (button, Ctrl+L, `clear`).
- Title screen scrolls instead of clipping; the status bar drops low-priority items on narrow windows.

### Added

- **`fahh` command.** `fahh .`, `fahh <folder>`, `fahh <file>[:line]` from any shell, relative to that shell's folder. See docs/FAHH_COMMAND.md.

---

## [0.6.3] — 2026-10-20

### Fixed

- Python and Rust errors are no longer silent without a language server: syntax errors underline, show in Error Lens and play the fahh (Rust via `syn`, Python via your installed interpreter, compiled but never run). The check steps aside once pylsp or rust-analyzer is ready.
- A run that exits with an error now plays the fahh; stopping a run does not.
- Ctrl+L inside the editor selects the line again; Ctrl+Shift+A still toggles Fahh Local everywhere.
- CI on main is green again (clippy).
- Release notes come from `release-notes/<tag>.md` (or are generated from merged PRs) instead of repeating the v0.5.0 text.

### Changed

- The version shown in the app (status bar, menu bar, canvas, About) comes from `package.json`, so it can no longer drift.

---

## [0.5.0] — 2026-10-08

### Also in this release (added 8 Oct)

- **Built-in browser.** Open any address as an editor tab: Command Palette → "Open Browser…" (type a port like `5173` or a URL), or click the dev-server address that appears in the status bar when the terminal or a run prints one ("Local: http://localhost:5173"). Address bar, reload, **Window** (its own Fahh window, for sites that refuse to be framed) and open-in-your-browser. The page keeps its own origin and cannot reach the editor.
- **Preview button labelled.** The tab-bar action now reads "Preview" / "Source" for Markdown, HTML, SVG and CSV files.
- **First-run welcome.** Three steps on first launch: errors make a sound, AI is optional, open a project; reopen with "Show Welcome".
- **AI Composer.** Code blocks in AI replies have Copy and "Apply to file" (asks first, replaces only that file's open tab, unsaved until Ctrl+S); context chips; an error auto-fix prompt; an LSP request/response correlator (not wired in yet).
- **Contributor setup.** Issue and PR templates, CONTRIBUTING with pnpm and cargo, a welcome message on new PRs.

### Earlier 0.5.0 work (2 Oct)

Tested end to end as the real desktop app in WSL. The tools were tauri-driver and WebKitWebDriver, against the real Rust backend, real files and real processes. That run found the bugs fixed below. Then a programmer's session, done entirely in the Fahh window, pushed a project to GitHub: [Arnav1771/fahh-hello](https://github.com/Arnav1771/fahh-hello).

### Added

**Previews, modelled on VS Code** (`markdown-language-features`, `media-preview`)
- **Shortcuts:** Ctrl+K V opens the preview beside the editor; Ctrl+Shift+V swaps the editor for the preview. The same actions sit at the right of the tab bar.
- **Markdown:**
  - Live as you type, and scroll sync follows the editor's top line.
  - Double-click a block to jump to its source line.
  - Relative images load from disk.
  - Links open in the browser, or in the editor for local files.
  - Rendered with markdown-it with raw HTML off, sanitised with DOMPurify, in a shadow root.
- **HTML:**
  - Rendered in a sandboxed frame that can never reach the editor (no `allow-same-origin`).
  - Scripts are off until you allow them for that file.
  - The page's own CSS and images load.
- **Images** (PNG, JPEG, GIF, WebP, …):
  - Open straight into the viewer instead of as garbled text.
  - Fit or 100%; click to zoom in, Ctrl+click to zoom out, Ctrl+wheel to zoom.
  - Pixelated from 3×.
  - Dimensions and file size are shown.
- **SVG:** previews beside its source, live.
- **CSV/TSV:** shown as a table, with quoted fields handled.
- **Local files and the asset protocol:** previews load local files through Tauri's asset protocol. It starts with an empty scope, and only the folder you opened (or the opened file's folder) is allowed, like VS Code's `localResourceRoots`.

**Editor**
- **Quick Open (Ctrl+P):** fuzzy-find any file in the opened folder. Build output folders are skipped. Ctrl+P no longer opens the print dialog.

**Terminal**
- **`cd` sticks:** `mkdir hello && cd hello`, then `git init`, now initialises `hello`. Every command used to run in the folder the terminal started in. The prompt shows where you are.
- **`fahh .` / `fahh <folder>`:** opens a folder in the explorer from the terminal, like VS Code's `code .`.

**Status bar**
- **Language-server status item:** shows "rust ✓", or "rust ✕" with the reason on hover.

### Fixed
- **Debugging connected to the wrong program.** Adapters had fixed ports (debugpy 5678, node 9229, dlv 2345, lldb-dap 4711), and 5678 is n8n's default. With n8n running, Start Debug connected to n8n's web server and reported a session that did not exist. Each session now gets a free port.
- **A missing debug adapter now fails fast, with how to install it** (for example `python3 -m pip install debugpy`). It used to wait 10 s, or worse. The Debug panel now says why; before, the reason only went to the developer console. An adapter that never answers is killed instead of left running.
- **The Run panel hung on fast programs.** A script that printed and exited before `run_file` returned its pid lost its output and stayed on "● Running" forever. Events are now buffered until the pid is known and then replayed (`lib/runEvents.ts`).
- **A language server that died at start was reported as running.** Every keystroke then logged "Broken pipe". For example, `rust-analyzer` is a rustup shim until the component is installed. The start is now checked, and the server's own error is shown. The opened folder is now the language server's workspace, not the file's parent folder.
- **Drop-downs were unreadable on Linux.** WebKitGTK drew `<select>` as a white GTK box with the theme's light text on it.

### Tests
- 184 unit tests (28 new) and 17 Rust tests (7 new).
- A native end-to-end suite of 108 checks on the real app:
  - every backend command;
  - every panel;
  - rust-analyzer diagnostics turning into a fahh;
  - the AI chat against a local Ollama;
  - restart persistence.
- A native preview and Quick Open suite (24 checks).
- Two recorded programmer sessions, 19 and 25 checks, pushing to GitHub entirely from the Fahh window.

---

## [0.4.0] — 2026-10-02

The fahh you can see. Researched against Cursor, Windsurf, Zed, VS Code and
JetBrains (2025–26): every one of them treats sound as a quiet accessibility
signal. Fahh makes the error moment the identity, and borrows their rules for
keeping it bearable: react to transitions, never cover the code, one-click mute.

### Added
- **The fahh moment.** When the error count in the file you are editing goes up:
  - the editor region shakes for 280 ms;
  - a red edge glow fades in and out;
  - the first error line pulses;
  - a **FAHH** chip slams in the corner, clear of the minimap and never over the code.
- **Combos.** Repeat errors within 12 s count up (**FAHH ×2, ×3…**), and each one sounds a little louder and lower.
- **Clean.** Fixing the last error plays a soft two-note chime, shows a **CLEAN** chip and runs a gold sweep along the status bar.
- **Intensity: Epic / Subtle / Off,** and a mute button.
  - Both are in the status bar and the command palette, and both are remembered.
  - Under `prefers-reduced-motion`, Epic steps down to Subtle.
- **Status-bar HUD.**
  - Live error and warning counts for the file on screen; click them to jump to the next problem.
  - A clean-streak timer, the live combo and the session fahh count.
  - It replaces the old "● Fahh Editor" dot, which was always green.
- **Command palette** (Ctrl+Shift+P or F1).
  - Every panel, all six themes, next/previous problem, the fahh settings and optional tools.
  - Fuzzy search, keycap hints, recently used first.
- **Title screen** in place of "Open a file to start editing":
  - the FAHH wordmark;
  - a bell that rings the fahh on purpose;
  - the main actions with their shortcuts.

### Fixed
- **Monaco's own checkers never triggered the fahh.** TypeScript, JavaScript, JSON, CSS and HTML errors showed squiggles but made no sound; only language-server diagnostics did. All markers now feed one engine, which applies one cooldown, so a single burst of errors is still one fahh.
- **Every JSX tag and import in a .tsx file was flagged as an error.** Each file now gets its own Monaco model with its real extension, and JSX parses. The import and typing errors that come from not seeing `node_modules` are ignored. A side benefit: each tab keeps its own undo history.
- **Opening a broken file no longer fahhs.** Only errors you introduce by typing count.
- **The browser preview could not play the sound.** The bundled `fahh.mp3` is now the fallback when the Tauri resource is unavailable.

### Tests
- 156 unit tests (15 new: the fahh engine, palette search, model paths, editor actions).
- 27-check browser run of the new flows; theme suite 21/21; smoke test 24/24.

---

## [Unreleased]

### Added
- Initial Rust backend foundation (editor, workspace, terminal, LSP, plugin, state, runtime, quality)
- `fahhhh.mp3` asset — the core Fahh SFX sound file
- Architecture SVG diagram

---

## [0.1.0] — upcoming

### Planned
- Tauri 2 app shell with React 18 + TypeScript frontend
- Monaco Editor integration with tab management
- xterm.js integrated terminal
- Fahh SFX system: LSP error detection + audio playback
- File tree sidebar with live file watching
- First-run optional tools installer wizard (n8n, browser-use, Flowise, CLIs)
- Basic LSP client wired to diagnostics panel
- Git sidebar (status, stage, commit, branch switcher)
- Settings panel with Fahh SFX toggle and cooldown config
- MCP-based AI panel

---

[Unreleased]: https://github.com/Arnav1771/fahh-ide/compare/HEAD...HEAD
