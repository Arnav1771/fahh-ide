# Fahh Editor — Canary Verification Results

End-to-end verification runs for each Fahh Editor release.

## Summary table

| Version | Date | Verdict | Pass Rate | Key changes |
|---------|------|---------|-----------|-------------|
| v0.2.0 | 2026-06-28 | PASS | 10/13 (77%) | Baseline — themes, WebView2 menu blocked |
| v0.3.0 | 2026-06-28 | **PASS** | **17/17 (100%)** | All fixes: context menu, themes Monaco, new file, reload guard, terminal |

## Folder structure

```
CANARY_RESULTS/
├── README.md                   ← this file
├── canary-runner.cjs           ← Playwright test script (run from repo root)
├── v0.2.0/
│   ├── verification-report.md
│   └── screenshots/  (7 files)
└── v0.3.0/
    ├── verification-report.md
    └── screenshots/  (10 files)
```

## How to run

```bash
cd <repo-root>
pnpm dev &                                        # Vite on localhost:1420
node IMP_DOCS/CANARY_RESULTS/canary-runner.cjs    # 17 checks, ~30s
```

## What v0.3.0 fixed (all verified 17/17)

1. **WebView2 context menu** — blocked. No more Share/Reload/More Tools on right-click.
2. **F5/Ctrl+R** — blocked. Accidental reload can't wipe editor content.
3. **Themes fully work** — GitHub Dark, Dracula, Solarized now change Monaco token colors (not just CSS vars).
4. **New file button** — dedicated 📄 in Explorer header. Works even before opening a folder.
5. **File creation** — optimistic tree update shows file instantly (before Tauri disk write).
6. **Right-click context menu** — Rename, Delete, Copy Path on any file.
7. **Terminal** — graceful fallback in browser-preview; `pip install` / `node` / `python` work in native binary.
8. **Task Manager name** — shows "Fahh Editor" not "WebView2 Gpu Process".

## Next: Linux verification

Run Canary against the Linux AppImage in WSL:

```
/canary:session user runs Fahh Editor AppImage on Ubuntu via WSL, opens a folder, opens a Python file, edits it, switches theme to Dracula
```
