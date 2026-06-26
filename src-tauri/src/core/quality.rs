use anyhow::Result;
use tracing::warn;

pub struct QualityGate {
    pub name: String,
    pub passed: bool,
    pub message: String,
}

pub fn run_startup_checks() -> Vec<QualityGate> {
    let mut gates = Vec::new();

    gates.push(check_home_dir());
    gates.push(check_config_writable());

    for gate in &gates {
        if !gate.passed {
            warn!("startup check failed: {} — {}", gate.name, gate.message);
        }
    }

    gates
}

fn check_home_dir() -> QualityGate {
    let passed = dirs::home_dir().is_some();
    QualityGate {
        name: "home_dir".to_string(),
        passed,
        message: if passed {
            "ok".to_string()
        } else {
            "cannot determine home directory".to_string()
        },
    }
}

fn check_config_writable() -> QualityGate {
    let result = (|| -> Result<()> {
        let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("no home"))?;
        let dir = home.join(".fahh");
        std::fs::create_dir_all(&dir)?;
        let test = dir.join(".write_test");
        std::fs::write(&test, b"ok")?;
        std::fs::remove_file(&test)?;
        Ok(())
    })();

    QualityGate {
        name: "config_writable".to_string(),
        passed: result.is_ok(),
        message: result.err().map(|e| e.to_string()).unwrap_or("ok".to_string()),
    }
}
