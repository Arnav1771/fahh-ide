#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QualityBar {
    pub startup_target_ms: u128,
    pub max_memory_mb: u64,
    pub max_crashes_per_1000_sessions: u32,
    pub require_tests_green: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeStats {
    pub startup_ms: u128,
    pub peak_memory_mb: u64,
    pub crashes_per_1000_sessions: u32,
    pub tests_green: bool,
}

impl QualityBar {
    pub fn mvp_default() -> Self {
        Self {
            startup_target_ms: 350,
            max_memory_mb: 256,
            max_crashes_per_1000_sessions: 1,
            require_tests_green: true,
        }
    }

    pub fn evaluate(&self, stats: &RuntimeStats) -> bool {
        stats.startup_ms <= self.startup_target_ms
            && stats.peak_memory_mb <= self.max_memory_mb
            && stats.crashes_per_1000_sessions <= self.max_crashes_per_1000_sessions
            && (!self.require_tests_green || stats.tests_green)
    }
}

#[cfg(test)]
mod tests {
    use super::{QualityBar, RuntimeStats};

    #[test]
    fn quality_gate_rejects_slow_startup() {
        let bar = QualityBar::mvp_default();
        let stats = RuntimeStats {
            startup_ms: 500,
            peak_memory_mb: 120,
            crashes_per_1000_sessions: 0,
            tests_green: true,
        };

        assert!(!bar.evaluate(&stats));
    }
}
