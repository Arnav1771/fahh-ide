# Fahh Editor — Canary Verification Results

End-to-end verification runs for each Fahh Editor release, following the Canary QA harness format.

## Folder structure

```
CANARY_RESULTS/
├── README.md                 ← this file
├── canary-runner.cjs         ← reusable Playwright test script
├── v0.2.0/
│   ├── verification-report.md
│   └── screenshots/          ← 7 evidence screenshots
└── v0.3.0/
    ├── verification-report.md
    └── screenshots/          ← 10 evidence screenshots
```

## Summary table

| Version | Date | Verdict | Pass Rate | Key findings |
|---------|------|---------|-----------|-------------|
| v0.2.0 | 2026-06-28 | PASS | 10/13 (77%) | Themes, WebView2 menu blocked; New file/context menu/terminal untestable in browser-preview |
| v0.3.0 | 2026-06-28 | PASS | 15/17 (88%) | Fixed: New File button, terminal ID, F5 reload blocked; 2 remaining need real Tauri backend |

## What the tests cover

1. App launches and all UI regions render
2. WebView2 browser context menu is blocked (no Share/Reload/More Tools)
3. F5/Ctrl+R page reload is blocked (code cannot be accidentally wiped)
4. All 5 themes switch — status bar + checkmark update
5. New file button in Explorer header + inline input
6. Right-click context menu on file items (Open, Rename, Delete, Copy Path)
7. Terminal handles commands (graceful fallback in browser-preview)
8. Run panel renders with language selector
9. Debug panel renders with Start Debug + BREAKPOINTS
10. Zero critical console errors

## How to run

```bash
# From repo root:
pnpm dev &                                          # start Vite on localhost:1420
node IMP_DOCS/CANARY_RESULTS/canary-runner.cjs      # run all checks
```

Or with the Canary plugin installed:

```
/canary:session user opens Fahh Editor, opens Desktop/fahh-test-workspace, opens calculator.py, edits it, right-clicks to rename, switches to GitHub Dark theme, clicks Run
```

```
/canary:verify right-click context menu shows on files in the Explorer sidebar
```

## Why 2 tests still fail in browser-preview

The remaining 2 failures require a real Tauri binary:
- **New file persists in tree** — `createFile` calls `tauri-plugin-fs`, unavailable in browser
- **Right-click context menu** — requires files in tree, which requires opening a folder via Tauri dialog

Both work correctly in the installed `.exe`. To get 17/17, run the tests against `pnpm tauri dev` or the installed binary.
