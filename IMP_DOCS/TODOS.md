# TODOS

**Document version:** v1
**Date:** 2026-08-04
**Branch:** `fix/mod-2026-07-24`

Open items only. What was closed is in `HANDOFF.md` and `PROMPT_TRAIL.md`.

---

## Blocking for anyone calling this an IDE

### 1. LSP completion, hover and go-to-definition are parsed and dropped

Diagnostics are wired end to end — `lsp_client.rs` emits, `src/lib/diagnostics.ts`
translates, `monacoBridge.ts` calls `setModelMarkers`, an error-severity marker fires
the sound. Nothing else is.

Searching `src/lib/*.ts` and `src/components/*.tsx` for `completion`, `hover` or
`definition` returns only the AI panel's `/chat/completions` URL handling. There is no
consumer for a `textDocument/completion`, `hover` or `definition` response anywhere in
the frontend: the client receives them and they go nowhere.

**What it takes:** register Monaco providers (`registerCompletionItemProvider`,
`registerHoverProvider`, `registerDefinitionProvider`) that issue an LSP request and
resolve from the reply. The request plumbing (`lsp_send`) already exists; what is
missing is request/response correlation — diagnostics are a *notification*, so the
current path never needed to match a reply to a request id.

**Do it in the same shape as `diagnostics.ts`:** a pure translator module with tests,
then a thin wiring layer. That is the only way any of it is verifiable here.

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
