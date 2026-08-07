# TECHSPEC

**Document version:** v1
**Date:** 2026-08-04
**Applies to:** `fahh-editor` 0.3.0, branch `fix/mod-2026-07-24`

**This file does not replace `TECH_SPEC.md`.** That document (written for v0.2.0) still
holds the full Tauri command inventory, the event list, the capability grants, the
colour tokens and the CI layout, and it is the right place to look for any of those.
This file covers the parts of the system that the current branch changed, and states
what was verified while writing it.

---

## 1. Shape, in one picture

```
  React 18 / TS strict / Vite / Tailwind / zustand / Monaco / xterm
  ┌───────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐
  │ FileTree  │ │ EditorPane │ │ GitSidebar │ │ AI panel │ │ Terminal │
  └───────────┘ └────────────┘ └────────────┘ └──────────┘ └──────────┘
        │              │              │             │            │
        │      monaco-setup.ts   git.ts/gitStore  ai.ts     xterm addons
        │       (local bundle)        │             │
        └──────────── invoke() / emit()  (Tauri IPC) ─────────────┘
                                   │
  Rust (Tauri 2): src-tauri/src/core/
    workspace · editor · terminal · runner · lsp_client · debugger
    formatter · git (git2) · error_detector · plugin · installer · state
                                   │
                        OS: files, processes, LSP servers, git
```

The signature behaviour: an LSP diagnostic of severity error, or a failed build, plays
`src-tauri/assets/fahh.mp3`, throttled to at most one play per cooldown window.

---

## 2. Frontend modules with tests

Eight test files, 136 tests, all under `src/`. The modules exist in the shape they do
*so that* they can be tested without a WebView, a Rust process or a network:

| Module | Tests | What it owns |
| --- | --- | --- |
| `src/lib/ai.ts` | 27 | Provider settings validation, URL joining, OpenAI-compatible request shape, SSE parsing, error messages |
| `src/lib/git.ts` | 24 | Typed wrappers and shape handling over the six git commands |
| `src/lib/diagnostics.ts` | 20 | LSP diagnostic → Monaco marker translation, severity mapping |
| `src/lib/tauri.ts` | 16 | Typed `invoke` wrappers |
| `src/store/gitStore.ts` | 15 | Source-control view state |
| `src/lib/cooldown.ts` | 13 | The SFX throttle |
| `src/lib/monacoBridge.ts` | 11 | Marker application against an injected Monaco-like object |
| `src/store/editorStore.ts` | 10 | Open documents, dirty state, active tab |

### The cooldown rule

`DEFAULT_COOLDOWN_MS = 3000`. `consume()` returns `true` and opens a new window, or
`false` while cooling. A `cooldownMs <= 0` disables throttling entirely — which is what
a user gets by setting `sfx_cooldown_secs: 0` in `~/.fahh/config.json`.

### Monaco is bundled, not fetched

`src/lib/monaco-setup.ts`, imported once from `main.tsx` before render, points
`@monaco-editor/react`'s loader at the local `monaco-editor` package and registers the
five language workers (`editor`, `json`, `css`, `html`, `ts`) as Vite worker chunks.

The default is a jsdelivr fetch at runtime. That resolves in `vite dev` and **never**
resolves in the packaged app, where the WebView runs on the `tauri://` custom-protocol
origin — the editor pane rendered blank and no file ever appeared. Bundling is the fix;
the 3.4 MiB main chunk (§5) is what it costs.

### The AI panel holds nothing

`src/lib/ai.ts` defines `{ baseUrl: "", model: "", apiKey: "" }` as the default settings
and refuses to send until a base URL and a model are configured. The request is the
OpenAI-compatible `POST {baseUrl}/chat/completions` with an SSE stream; `joinUrl()`
normalises slashes so `http://localhost:11434/v1` and `http://localhost:11434/v1/` both
resolve. No provider, key or endpoint is compiled in.

---

## 3. Source control (`src-tauri/src/core/git.rs`)

Built on the **git2** crate (`git2 = { version = "0.19", default-features = false }`) —
no shelling out to a `git` binary, so there is nothing to find on `PATH` and nothing to
parse out of human-readable output.

Six Tauri commands, and that is the whole surface:

| Command | Signature |
| --- | --- |
| `git_status` | `(path: String) -> Result<GitStatus, String>` |
| `git_current_branch` | `(path: String) -> Result<Option<String>, String>` |
| `git_stage` | `(path: String, file: String) -> Result<(), String>` |
| `git_unstage` | `(path: String, file: String) -> Result<(), String>` |
| `git_commit` | `(path: String, message: String) -> Result<String, String>` |
| `git_diff` | `(path: String, file: String, staged: bool) -> Result<String, String>` |

The UI side is `src/components/GitSidebar.tsx`, imported at `src/App.tsx:7` and rendered
at `src/App.tsx:214` under `sidebarTab === "git"`. Before this branch the import existed
and the render did not — the sidebar slot inlined a second placeholder `div`, so the
component was dead code.

---

## 4. Diagnostics → markers → sound

`lsp_client.rs` emits inbound LSP traffic to the frontend; `src/lib/diagnostics.ts`
converts `textDocument/publishDiagnostics` payloads into Monaco marker objects
(severity mapped, 1-based LSP positions to Monaco's ranges), and `monacoBridge.ts`
applies them via `setModelMarkers`. An error-severity marker is what triggers
`trigger_error_sound`, through the cooldown.

`monacoBridge.ts` takes the Monaco namespace as a parameter rather than importing it,
which is the only reason those 11 tests can run in Node.

**Only diagnostics are wired.** Completion, hover and go-to-definition responses are
parsed by the client and dropped — there is no consumer for them anywhere in `src/`
(`TODOS.md` §1).

---

## 5. Build, test, run

```
pnpm install
pnpm dev            # vite
pnpm build          # tsc && vite build
pnpm test           # vitest run
pnpm tauri dev      # full desktop app (needs Rust + platform webkit)
```

Observed on this branch:

```
$ pnpm test
 ✓ src/lib/cooldown.test.ts (13 tests)      ✓ src/lib/git.test.ts (24 tests)
 ✓ src/lib/diagnostics.test.ts (20 tests)   ✓ src/store/gitStore.test.ts (15 tests)
 ✓ src/lib/tauri.test.ts (16 tests)         ✓ src/lib/monacoBridge.test.ts (11 tests)
 ✓ src/lib/ai.test.ts (27 tests)            ✓ src/store/editorStore.test.ts (10 tests)

 Test Files  8 passed (8)
      Tests  136 passed (136)
   Duration  1.11s
```

Build output already present in `dist/` (from the prior build, not re-run in the
documentation pass): `dist/assets/index-CNTxpeFr.js` is **3,562,287 bytes** (3.4 MiB);
`dist/` totals 13 MB, most of it Monaco's per-language chunks. Monaco is not
code-split — see `TODOS.md` §4.

### Rust side

`src-tauri/src/core/` carries **10 `#[test]` functions** in three modules — `runner.rs`
(3), `debugger.rs` (3), `plugin.rs` (4) — locking the serde contracts and the plugin
registry shape. They were **not executed in this documentation pass** (`cargo test` was
not run here); the last recorded run, in the 2026-07-24 pass, reported 10/10.

### Audio, measured

```
$ ffprobe -v error -show_entries format=duration -of default=nw=1 src-tauri/assets/fahh.mp3
duration=0.470204
$ ffmpeg -i src-tauri/assets/fahh.mp3 -af volumedetect -f null -
mean_volume: -6.3 dB
max_volume:  -1.2 dB
```

---

## 6. Not verified here

- **No GUI run.** WSL has no display in this environment; the app was never launched
  while writing these docs. Nothing about how the IDE looks or behaves at runtime is
  claimed.
- **`cargo build` / `cargo test` / `cargo clippy` were not run** in this pass.
- **Packaged-app behaviour** (the `tauri://` origin, the installer, the bundled Monaco
  actually rendering) is reasoned from the source, not observed.
