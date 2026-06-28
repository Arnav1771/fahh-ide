# Fahh SFX — Specification

The Fahh SFX is the defining feature of Fahh Editor. When a user's code has
an error, the IDE plays `fahh.mp3`. This document defines exactly how it works.

---

## The sound file

**Location:** `src-tauri/assets/fahh.mp3`

**Important:** The filename has 4 h's: `fahh.mp3`. Do not rename it.
The asset is bundled into the Tauri app at build time via `tauri.conf.json`.

---

## Trigger conditions

The SFX plays when any of the following happen:

| Event | Source | Notes |
|-------|--------|-------|
| LSP error diagnostic appears | `lsp.rs` → `error_detector.rs` | Severity = Error only, not Warning |
| Build task exits with non-zero code | `terminal.rs` → `error_detector.rs` | Any task configured as a build task |
| Debug session terminates with exception | Future: DAP client | Not in v0.1.0 |

Warnings do NOT trigger the SFX. Only errors.

---

## Cooldown

To prevent audio spam when many errors appear at once (e.g. a bad import that
cascades), there is a mandatory cooldown between plays.

- Default cooldown: **3 seconds**
- Configurable range: 0–30 seconds
- Stored in: `~/.fahh/config.json` under `"fahh_sfx_cooldown_ms"`
- During cooldown, new error events are silently ignored (not queued)

---

## Data flow

```
LSP diagnostic event (severity=Error)
         │
         ▼
error_detector.rs
  checks cooldown timer
         │
    cooldown clear?
    ┌────┴────┐
   yes        no
    │          │
    ▼          └──→ drop event
  emit Tauri event:
  "fahh://error"
  with payload:
  { file: String, line: u32, message: String }
         │
         ▼ (WebView receives event)
src/lib/fahh.ts
  listen("fahh://error", handler)
         │
         ▼
  Web Audio API:
  new Audio("/assets/fahh.mp3").play()
         │
         ▼
  optional: show meme toast overlay (2s, auto-dismiss)
```

---

## Backend implementation

File: `src-tauri/src/core/error_detector.rs`

```rust
use std::time::{Duration, Instant};
use std::sync::Mutex;
use tauri::AppHandle;

pub struct ErrorDetector {
    last_triggered: Mutex<Option<Instant>>,
    cooldown: Duration,
    enabled: bool,
}

impl ErrorDetector {
    pub fn new(cooldown_ms: u64, enabled: bool) -> Self {
        Self {
            last_triggered: Mutex::new(None),
            cooldown: Duration::from_millis(cooldown_ms),
            enabled,
        }
    }

    pub fn on_error(&self, app: &AppHandle, file: &str, line: u32, message: &str) {
        if !self.enabled {
            return;
        }
        let mut last = self.last_triggered.lock().unwrap();
        let now = Instant::now();
        if let Some(t) = *last {
            if now.duration_since(t) < self.cooldown {
                return; // still in cooldown, drop event
            }
        }
        *last = Some(now);
        let _ = app.emit("fahh://error", serde_json::json!({
            "file": file,
            "line": line,
            "message": message,
        }));
    }
}
```

Wire this into the LSP diagnostics callback in `lsp.rs` and the build task
exit handler in `terminal.rs`.

---

## Frontend implementation

File: `src/lib/fahh.ts`

```typescript
import { listen } from "@tauri-apps/api/event";

interface FahhErrorPayload {
  file: string;
  line: number;
  message: string;
}

let audio: HTMLAudioElement | null = null;

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio("/assets/fahh.mp3");
  }
  return audio;
}

export async function initFahhSfx() {
  await listen<FahhErrorPayload>("fahh://error", (event) => {
    const a = getAudio();
    a.currentTime = 0;
    a.play().catch(() => {
      // Autoplay blocked — silently ignore. User will hear it next time.
    });
    showFahhToast(event.payload);
  });
}

function showFahhToast(payload: FahhErrorPayload) {
  // Optional: 2-second meme overlay showing file + line + message
  // Implement in src/components/FahhToast/
}
```

Call `initFahhSfx()` once in `src/App.tsx` on mount.

---

## Settings

The following settings are exposed in the IDE Settings panel:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `fahh_sfx_enabled` | boolean | `true` | Master on/off toggle |
| `fahh_sfx_cooldown_ms` | number | `3000` | Milliseconds between plays |
| `fahh_sfx_show_toast` | boolean | `true` | Show meme overlay on error |

All settings are stored in `~/.fahh/config.json` and read by the backend at
startup. Changes apply immediately without restart.

---

## Testing the SFX

In development, trigger the SFX manually from the command palette:
`Fahh: Test Error Sound` — this calls a Tauri command that emits the event
directly, bypassing the cooldown.

There is also a unit test in `error_detector.rs` that verifies the cooldown
logic without actually playing audio.
