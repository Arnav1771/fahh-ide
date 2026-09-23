# DESIGN_CHOICES

**Document version:** v1
**Date:** 2026-08-04
**Branch:** `fix/mod-2026-07-24`

Why the current branch is built the way it is, and what was turned down. `TECHSPEC.md`
and `TECH_SPEC.md` describe behaviour; this file describes intent.

---

## 1. Monaco ships inside the app

**Decision.** `monaco-editor` is a bundled dependency, wired up once in
`src/lib/monaco-setup.ts` and imported from `main.tsx` before the first render. The
five language workers are Vite worker chunks.

**What it replaced.** `@monaco-editor/react`'s default: fetch the Monaco core from
jsdelivr at runtime.

**Why it had to change.** The default works in `vite dev` — online, ordinary origin, no
CSP — and fails completely in the packaged desktop app, where the WebView runs on the
`tauri://` custom-protocol origin. The remote fetch never resolves, the loader never
calls back, and the editor pane stays blank forever. Not slow: blank. In an IDE, that
is the whole product gone, and it only reproduces in the built artefact, which is the
worst possible place for a bug to live.

**Rejected.** *Ship a CSP that allows jsdelivr* — still needs the network, so the editor
breaks on a plane. *Vendor a Monaco build by hand* — same bytes, no dependency
management, and it drifts. *Swap to CodeMirror* — smaller, but throws away the language
services the SFX feature feeds on.

**Cost accepted.** `dist/assets/index-*.js` is 3,562,287 bytes and `dist/` is 13 MB. For
a desktop app loading from the local filesystem, download size is not the constraint it
would be on the web. Splitting it is still worth doing (`TODOS.md` §4) — it is an
optimisation, not a fix.

---

## 2. Git through the git2 crate, not a `git` subprocess

**Decision.** `src-tauri/src/core/git.rs` uses `git2` (`0.19`,
`default-features = false`) and exposes exactly six commands.

**Why.** Shelling out means a `git` binary must exist on `PATH` on every target
platform, its human-readable output must be parsed, and its exact wording becomes a
compatibility surface. `git2` gives typed results and errors that are already errors.
`default-features = false` keeps the build off OpenSSL and libssh — the crate is only
ever asked about the local working tree, never the network.

**Six commands, deliberately.** Status, current branch, stage, unstage, commit, diff.
That is the loop a source-control sidebar needs: see what changed, stage it, describe
it, commit it. Push, pull, fetch, branch and merge are all *network or history* verbs
with real failure modes (credentials, conflicts, force) that deserve a UI of their own
rather than a button that can silently do something irreversible.

**The bug this replaced was not in the Rust at all.** `GitSidebar` was imported in
`App.tsx` and never rendered — the sidebar slot inlined a second placeholder `div`. The
component and its store existed, were reachable by tests, and were invisible to the
user. That is the argument for the 39 tests across `git.ts` and `gitStore.ts`: they
prove the logic, and only wiring proves the feature.

---

## 3. The AI panel is bring-your-own-provider, with nothing hardcoded

**Decision.** `src/lib/ai.ts` defaults to `{ baseUrl: "", model: "", apiKey: "" }` and
refuses to send until a base URL and a model are set. The wire format is the
OpenAI-compatible `POST {baseUrl}/chat/completions` with SSE streaming.

**Why that format.** It is what Ollama, LM Studio, llama.cpp's server, vLLM and most
hosted providers all speak. One implementation reaches all of them, and a user who wants
a local model does not need a code change or a plugin — just a base URL.

**Why nothing is hardcoded.** No default provider, no bundled key, no telemetry
endpoint. A key typed into settings is the user's; the app cannot leak one it never
had. It also keeps the IDE honest about being a local tool.

**Cost accepted.** The panel is useless until configured, and the failure modes are
other people's servers. That is handled with specific messages rather than a generic
one — a 404 at the base URL, for instance, says *"no /chat/completions at that base URL.
Include the /v1 suffix"*, because that is the actual mistake nine times out of ten.

---

## 4. The error sound is a short, loud, synthesized blip

**Decision.** `src-tauri/assets/fahh.mp3` — measured on this branch at **0.470 s, mean
volume −6.3 dB, max −1.2 dB**.

**What it replaced.** A clip recorded in the earlier pass as **1.824 s, mean −21.0 dB** —
long enough to overlap the next error and quiet enough to miss entirely on laptop
speakers. (Those figures are from that pass's record; the file is gone, so they are not
re-measurable here.)

**Why it matters more than it sounds.** This app has exactly one signature feature: it
makes a noise when your code is wrong. A feedback signal you cannot hear is not a
feature, and the previous file meant the product's whole premise silently did not work.
About 15 dB of mean level and a quarter of the duration is the difference between a
notification and nothing.

**Why a cooldown.** `DEFAULT_COOLDOWN_MS = 3000`. LSP diagnostics arrive in bursts —
one keystroke can publish a dozen errors — and an untamed play-per-diagnostic is
unusable within seconds. Three seconds is short enough to still feel causal.
`sfx_cooldown_secs: 0` in `~/.fahh/config.json` turns throttling off for anyone who
disagrees.

---

## 5. Every testable rule is pulled out of the components

**Decision.** Diagnostic translation, marker application, provider settings, URL
joining, SSE parsing, the cooldown, the git wrappers and both zustand stores live in
plain modules under `src/lib` and `src/store`, with the framework objects injected.
`monacoBridge.ts` takes the Monaco namespace as a *parameter* rather than importing it.

**Why.** The app cannot be launched in this environment — WSL has no display — so
anything only reachable through the UI is unverifiable. Structuring the logic to be
callable from Node is what turned "we believe it works" into 136 assertions that run in
1.11 s.

**Rejected.** *Component tests with a DOM shim* — heavier, slower, and still not the
real WebView, so it buys confidence in a simulation. *A headless E2E harness* — the
right answer eventually, and it needs a display; recorded in `TODOS.md`.

**Cost accepted, stated plainly.** 136 green tests say the *rules* are right. They say
nothing about whether the sidebar is rendered, the sound reaches an output device, or
the editor paints. Exactly that class of bug — a correct component nobody rendered —
is what this branch found.

---

## 6. Build junk was deleted, not gitignored

**Decision.** `386d0f2` removed the committed artefacts from the repo root: an
`fahh.AppImage` (recorded at 82 MB in the pass that removed it), `test.js`, `test.py`,
`test.rs`, a stray `pnpm.yaml`, and a screenshot under a directory named
`linux v.02/`.

**Why deletion and not just an ignore rule.** An ignore rule stops the *next* commit;
it does not stop every clone from paying for the last one. Binaries in history also
make `git log --stat` and every diff review noisier.

**Honest limitation.** They are gone from the working tree, not from history — the
objects still exist in the pack, so a fresh clone still transfers them. Rewriting
history to reclaim that was judged not worth breaking every existing clone and open
branch. The rule going forward is simply that build output does not get committed.


## 7. Fahh Gold is scoped by an attribute, not a stylesheet swap

**Decision.** The gold look is a set of CSS rules under
`html[data-fahh-theme="fahh-gold"]`, switched on by the same `applyThemeCssVars` call
that sets the colour variables.

**Why.** The design direction asks for more than colours - bracketed labels, glowing
bordered buttons instead of filled ones, grain. Doing that with Tailwind classes would
have meant conditional class strings in a dozen components; doing it with an attribute
keeps every component unchanged apart from a class hook (`fahh-label`, `fahh-primary`,
`fahh-danger`, `fahh-statusbar`) that has no styles in any other theme.

**Consequence.** A new theme that wants its own non-colour styling adds a block under its
own `data-fahh-theme` value; nothing else has to change.
