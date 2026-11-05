# TODOS

**Document version:** v0.6.0  
**Date:** October 2026  
**Status:** Major Landmark Milestones Delivered in v0.6.0  

---

## Shipped in v0.6.0 (Milestone Resolution)

1. **CATE Spatial Canvas Mode (`Ctrl+Shift+C`)**: Infinite 2D zoom/pan workspace with traffic-light floating Monaco, Terminal, AI companion, and Browser nodes, plus radar Minimap and viewport teleportation.
2. ~~Cursor Composer (`Ctrl+I`) & Inline Edit (`Ctrl+K`)~~: **removed after v0.6.3**, it was simulated (canned templates behind a timer).
3. **`@` Mention Context Engine**: Popover resolving `@problems`, `@terminal`, `@git`, `@codebase`, and workspace files.
4. **Monaco Error Lens**: Inline diagnostics rendered at line tails without mouse hover.
5. ~~Predictive Ghost Text~~: **removed after v0.6.3**, it offered a fixed snippet list, not predictions.
6. **Git Commits**: AI Conventional Commit generator. (The terminal "Fix with AI" button was removed after v0.6.3; it opened the simulated Composer.)
7. ~~REA Code Analysis~~: **removed after v0.6.3**, it showed sample data. The Ports and Output panels went with it (hard-coded ports, seeded logs).
8. **Automated Testing & Build**: 238 unit tests passing across 25 test suites (`pnpm test`); Vite production bundle compiling cleanly.
9. **Release Distribution**: Full set of native binaries published to GitHub Releases `v0.6.0` (`.exe`, `.msi`, `.dmg`, `.AppImage`, `.deb`, `.rpm`).

---

## Remaining Backlog & Future Enhancements

### 1. LSP language features — DONE on `feat/lsp-language-features` (v0.8.0), GUI check pending

Completion (+resolve), hover, definition (cross-file opens a tab), references (peek),
rename (WorkspaceEdit across open and unopened files), signature help, code actions,
inlay hints and document highlights are wired, in the shape this item asked for:

- `src/lib/lsp/protocol.ts` — pure LSP→Monaco mappers (kinds, ranges, markdown hover,
  locations, WorkspaceEdit flattening, `applyTextEdits`, URI→path). `protocol.test.ts`.
- `src/lib/lsp/client.ts` — `LspClient`: the correlator, one send queue per server,
  awaited `initialize`, answers to server requests, 3 s timeouts, `$/cancelRequest`,
  document sync. `client.test.ts` drives it with a fake transport.
- `src/lib/lsp/monacoLsp.ts` — `LspService`: model-driven didOpen/didChange/didClose,
  providers registered per running server, Monaco built-in workers switched off for a
  language while its server is up, the WorkspaceEdit applier and the editor opener.
- `src/lib/lsp/integration.test.ts` — real pyright / typescript-language-server over
  stdio (`FAHH_LSP_IT=1`, servers on PATH). Passed against pyright 1.1.x and
  typescript-language-server with TypeScript 5 in WSL.

**Still open:**
- Nothing here has been clicked through in the packaged Windows app (no GUI in this
  environment): the editor opener for cross-file definition, the peek widget for
  unopened files, the lightbulb, and Windows URI round-trips (`file:///c%3A/...`)
  are covered by unit tests only.
- typescript-language-server refuses TypeScript 7 (no `tsserver.js`): a project on
  TS 7 falls back to Monaco's built-in worker. Check Setup asks for `typescript@5`.
- Deletes in a WorkspaceEdit are not applied (no server Fahh starts sends them for a
  rename or quick fix). `codeAction/resolve` and `workspace/executeCommand` are sent
  but no server-side command has been exercised.
- Semantic tokens, code lens, document symbols from the server (the Outline uses its
  own parser), formatting through the server, and `workspace/didChangeWatchedFiles`
  for edits made outside Fahh are not wired.

### 2. The debugger UI is a stub

`src-tauri/src/core/debugger.rs` exposes six commands — `debug_start`,
`debug_continue`, `debug_step_over`, `debug_step_in`, `debug_stop`,
`debug_set_breakpoints` — and the panel does not drive them. The prior pass also
recorded that DAP event translation is incomplete (the backend emits raw
`{session_id, message}`; the UI expects `{event, body}`) and that the Node adapter's
CDP↔DAP bridge is unimplemented, so a session starts but will not step.

**Order of work:** event translation first (nothing else can be observed without it),
then breakpoints, then stepping, then variables.

---

## Verification gaps

### 3. Nothing has been run in a GUI

**No runtime verification of the desktop app was possible in this environment — WSL has
no display.** Everything about how the IDE behaves on screen is inference from source
plus 136 unit tests.

Specifically unproven, ranked by how much breaks if it is wrong:

| Path | If it is broken |
| --- | --- |
| Monaco renders in the packaged app from the local bundle | No editor. The entire product. |
| `fahh.mp3` reaches an output device on each platform | The signature feature is silent again |
| `GitSidebar` renders and its six commands round-trip | Source control is decorative |
| AI panel streams SSE into the transcript | Panel accepts input, shows nothing |
| Terminal/xterm attaches to the Rust process | Terminal is a text box |

**Action:** run `pnpm tauri dev` on a machine with a display, work down that table, and
record what you see.

### 4. Rust tests were not run in this pass

There are **10 `#[test]` functions** in `src-tauri/src/core/` — `runner.rs` (3),
`debugger.rs` (3), `plugin.rs` (4) — covering serde contracts and the plugin registry
shape. `cargo test` was **not executed while writing these docs**; the last recorded
run (2026-07-24) was 10/10.

*(An earlier note for this pass claimed `cargo test` runs zero Rust tests. That is not
what the source shows — the ten tests above exist. What is true is that they are thin:
serde shapes and registry contents, no git2 behaviour, no LSP, no process handling.)*

**Action:** re-run `cargo test` on a machine with the toolchain, then extend coverage to
`git.rs` against a temporary repository — it is the newest Rust in the tree and has
none.

---

## Size and packaging

### 5. The main bundle is 3.4 MiB because Monaco is not split

`dist/assets/index-CNTxpeFr.js` is **3,562,287 bytes**; `dist/` totals 13 MB. Monaco
and its language contributions land in the single entry chunk.

For a desktop app loading from disk this is a cold-start cost rather than a download
cost, so it is a real but low-severity item. Bundling Monaco locally is *not* the thing
to reconsider — see `DESIGN_CHOICES.md` §1.

**Action:** `build.rollupOptions.output.manualChunks` to split `monaco-editor` out of
the entry chunk, or lazy-load the editor pane behind a dynamic import. Measure before
and after; do not do it blind.

---

## Repository state

### 6. The merge of PR #36 could not be verified from this clone

The record for this pass states that PR #36 merged to `main` as merge commit `e95ac2e`
with both CI checks (frontend, rust) green.

**That was not confirmable here.** `git cat-file -t e95ac2e` reports
`fatal: Not a valid object name` — the object is not in this clone, and local `main`
sits at `7f5dcb0`, well behind the branch. The clone has not fetched since. No network
call and no CI query was made while writing these docs.

**Action:** `git fetch origin && git log --oneline origin/main` to confirm, before
citing that merge anywhere it matters.

### 7. `IMP_DOCS/_probe2.sh` is untracked scratch

A leftover probe script sitting in the docs folder, untracked. It is not part of the
documentation set. Delete it or move it out of `IMP_DOCS/`.

---

## Documentation

### 8. `HANDOFF.md`, `TECH_SPEC.md` and `INSTALLATION.md` describe v0.2.0 / v0.3.0

They carry earlier dates and version stamps, and the download links in `INSTALLATION.md`
point at the v0.3.0 release assets. They were preserved rather than rewritten in this
pass; `HANDOFF.md` and `PROMPT_TRAIL.md` each carry an appended 2026-08-04 section, and
`TECHSPEC.md` covers the current branch and defers to `TECH_SPEC.md` for the full
command and capability inventory.

**Action at the next release:** reconcile the three older documents against the shipped
version rather than accumulating another appendix.
