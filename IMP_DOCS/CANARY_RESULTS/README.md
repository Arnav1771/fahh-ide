# Fahh Editor — Canary Verification Results

This folder contains end-to-end verification runs for each Fahh Editor release.

## Structure

```
CANARY_RESULTS/
├── README.md              ← this file
├── v0.2.0/
│   ├── verification-report.md   ← full Canary-style report
│   └── screenshots/             ← evidence screenshots
│       ├── 01-initial-launch.png
│       ├── 02-github-dark.png
│       ├── 03-dracula.png
│       ├── 04-fahh-light.png
│       ├── 08-run-panel.png
│       └── 09-debug-panel.png
└── v0.3.0/                      ← (pending — build in progress)
    └── ...
```

## How Canary tests are run

1. **Install fresh** — uninstall any existing version, download and install the latest `.exe`
2. **Native process check** — verify the binary starts and stays running
3. **UI verification** — Playwright headless against Vite dev server tests all UI features
4. **Screenshot each step** — evidence saved to `screenshots/`
5. **Document findings** — `verification-report.md` follows the Canary report format

## Summary table

| Version | Date | Verdict | Pass Rate | Key findings |
|---------|------|---------|-----------|-------------|
| v0.2.0 | 2026-06-28 | PASS | 10/13 (77%) | Theme switching ✓, WebView2 menu blocked ✓, terminal/new-file tested browser-only |
| v0.3.0 | TBD | Pending | — | Build in progress (fixes: context menu, Run wiring, themes Monaco, NSIS shortcuts) |

## Running a new Canary session

With Canary installed (`/plugin marketplace add wizenheimer/canary`):

```
/canary:session user installs Fahh Editor, opens Desktop\fahh-test-workspace, opens calculator.py, edits line 3, presses Ctrl+S, clicks Run in Run panel, observes output
```

Or for a quick verify after a code change:

```
/canary:verify the Run button now executes Python code and shows output in the Run panel
```
