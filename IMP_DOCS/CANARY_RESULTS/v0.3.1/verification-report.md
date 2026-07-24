# Fahh Editor — Canary/Playwright Verification, v0.3.1

**Date:** 2026-07-24
**Mode:** Web / Vite dev server (`http://localhost:1420`), headless Chromium via Playwright, run inside WSL.
**Suite:** `fahh-test.mjs` (repo root) → artifacts written here.

> Web mode has no Tauri backend, so every `invoke()` call rejects by design.
> Components must degrade gracefully (never crash). The suite therefore asserts
> the shell renders, every panel is reachable, and there are **no critical
> (non-Tauri) console errors**. Backend command behaviour is covered separately
> by the Rust unit tests (`cargo test`, 10/10).

## Result: 24 / 24 PASS · 0 critical console errors

| # | Check | Result |
|---|-------|--------|
| 1 | App loads at localhost:1420 | ✅ |
| 2 | Page title is "Fahh Editor" | ✅ |
| 3 | Activity bar visible | ✅ |
| 4 | Sidebar panel visible | ✅ |
| 5 | File tree "No folder open" empty state | ✅ |
| 6 | "Open Folder" button visible | ✅ |
| 7 | Editor welcome screen visible | ✅ |
| 8 | Terminal command input visible | ✅ |
| 9 | Status bar "● Fahh Editor" | ✅ |
| 10 | **Version v0.3.0 shown** (was drifted to v0.2.0) | ✅ |
| 11 | "Hide Panel" toggle visible | ✅ |
| 12 | Panel hides when toggled | ✅ |
| 13 | Panel restores when re-toggled | ✅ |
| 14 | Git sidebar reachable | ✅ |
| 15 | AI panel reachable | ✅ |
| 16 | Extensions panel shows Themes tab | ✅ |
| 17 | Extensions panel shows Languages tab | ✅ |
| 18 | Debug panel reachable | ✅ |
| 19 | Files tab restores file tree | ✅ |
| 20 | Installer wizard opens | ✅ |
| 21 | Installer wizard closes without crash | ✅ |
| 22 | Run panel reachable | ✅ |
| 23 | App stays alive after terminal command | ✅ |
| 24 | No critical console errors (16 total, 0 critical) | ✅ |

The 16 total console messages are all Tauri IPC "not available" errors expected
in web mode (filtered as non-critical).

## Screenshots
`screenshots/01-initial-load.png` … `11-final-state.png`

## Raw data
`results.json`

## How to reproduce
```bash
pnpm install
pnpm dev            # terminal 1
node fahh-test.mjs  # terminal 2
```
