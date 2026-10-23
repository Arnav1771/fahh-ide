use std::path::PathBuf;

/// Tauri's `externalBin` (the fahh-agent terminal binary, see tauri.conf.json) must exist as
/// `binaries/fahh-agent-<triple>` at build time, and tauri-build copies it to `target/<profile>/fahh-agent`,
/// the very path cargo builds that binary to. So: if a real build of it is there, copy it in (the
/// copy tauri-build makes is then the same file); otherwise leave a stand-in that says so. Release
/// installers get the real one from `scripts/prepare-sidecar.mjs` (beforeBuildCommand).
fn main() {
    sidecar();
    tauri_build::build()
}

fn sidecar() {
    let triple = std::env::var("TARGET").unwrap_or_default();
    let ext = if triple.contains("windows") { ".exe" } else { "" };
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let dest = manifest.join("binaries").join(format!("fahh-agent-{triple}{ext}"));

    // OUT_DIR is <target>/<profile>/build/<pkg>-<hash>/out: the built binary sits three levels up.
    let built = std::env::var("OUT_DIR")
        .ok()
        .map(PathBuf::from)
        .and_then(|o| o.ancestors().nth(3).map(|p| p.join(format!("fahh-agent{ext}"))))
        .filter(|p| p.is_file() && std::fs::metadata(p).map(|m| m.len() > 4096).unwrap_or(false));

    let _ = std::fs::create_dir_all(dest.parent().unwrap());
    match built {
        Some(real) => {
            let _ = std::fs::copy(real, &dest);
        }
        None if !dest.exists() => {
            let _ = std::fs::write(&dest, "#!/bin/sh\necho 'fahh-agent was not built into this bundle' >&2\nexit 1\n");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
            }
        }
        None => {}
    }
    println!("cargo:rerun-if-changed=binaries");
}
