use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tracing::info;

pub struct ErrorDetector {
    last_triggered: Arc<AtomicU64>,
    cooldown_secs: u64,
}

impl ErrorDetector {
    pub fn new(cooldown_secs: u64) -> Self {
        Self {
            last_triggered: Arc::new(AtomicU64::new(0)),
            cooldown_secs,
        }
    }

    pub fn trigger(&self, app: &AppHandle) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let last = self.last_triggered.load(Ordering::Relaxed);
        if now.saturating_sub(last) < self.cooldown_secs {
            return;
        }

        self.last_triggered.store(now, Ordering::Relaxed);
        info!("fahh SFX triggered");
        let _ = app.emit("fahh://error", ());
    }
}
