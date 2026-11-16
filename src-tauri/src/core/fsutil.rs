//! Safe file writes: never leave a half-written file behind.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

const BOM: &[u8] = b"\xEF\xBB\xBF";

/// Write `bytes` to `path` atomically: a temp file next to it, flushed to disk, then renamed
/// over the target. A crash or a full disk mid-save leaves the old file intact (a plain
/// `fs::write` truncates first). The existing file's permissions are kept, and a symlink is
/// written through to its target rather than replaced by a regular file.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    static N: AtomicU32 = AtomicU32::new(0);
    let target: PathBuf = match std::fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() => std::fs::canonicalize(path)?,
        _ => path.to_path_buf(),
    };
    let dir = target.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = dir.join(format!(".{name}.fahh-{}-{}.tmp", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
    let result = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        if let Ok(meta) = std::fs::metadata(&target) {
            std::fs::set_permissions(&tmp, meta.permissions())?;
        }
        std::fs::rename(&tmp, &target)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// What a save writes for `content` over the file now at `path`:
/// - a UTF-8 BOM the file had is kept (Fahh strips it when reading);
/// - a file that is not UTF-8 text (Latin-1, UTF-16, binary) is refused: it was shown with
///   replacement characters, and saving would destroy every byte that did not decode.
pub fn save_bytes(path: &Path, content: &str) -> Result<Vec<u8>, String> {
    let Ok(old) = std::fs::read(path) else {
        return Ok(content.as_bytes().to_vec()); // a new file
    };
    let body = old.strip_prefix(BOM).unwrap_or(&old);
    if std::str::from_utf8(body).is_err() {
        return Err(format!(
            "{} is not UTF-8 text. Fahh did not save it, because saving would replace its non-UTF-8 characters. Convert it to UTF-8 first.",
            path.display()
        ));
    }
    if old.starts_with(BOM) && !content.as_bytes().starts_with(BOM) {
        let mut out = BOM.to_vec();
        out.extend_from_slice(content.as_bytes());
        return Ok(out);
    }
    Ok(content.as_bytes().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_and_leaves_no_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.txt");
        std::fs::write(&p, "old").unwrap();
        write_atomic(&p, b"new\r\nline").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"new\r\nline");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_keeps_mode_and_symlinks() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("run.sh");
        std::fs::write(&real, "#!/bin/sh").unwrap();
        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o755)).unwrap();
        let link = dir.path().join("link.sh");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        write_atomic(&link, b"#!/bin/sh\necho hi\n").unwrap();
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_to_string(&real).unwrap(), "#!/bin/sh\necho hi\n");
        assert_eq!(std::fs::metadata(&real).unwrap().permissions().mode() & 0o777, 0o755);
    }

    #[test]
    fn save_keeps_bom_and_crlf() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("w.ps1");
        std::fs::write(&p, b"\xEF\xBB\xBFa\r\nb\r\n").unwrap();
        assert_eq!(save_bytes(&p, "a\r\nc\r\n").unwrap(), b"\xEF\xBB\xBFa\r\nc\r\n");
        // a new file, or one without a BOM, gets exactly the text
        assert_eq!(save_bytes(&dir.path().join("new.txt"), "x").unwrap(), b"x");
    }

    #[test]
    fn save_refuses_to_mangle_non_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("latin1.txt");
        std::fs::write(&p, b"caf\xE9").unwrap(); // "café" in Latin-1
        assert!(save_bytes(&p, "caf\u{FFFD}").unwrap_err().contains("not UTF-8"));
        assert_eq!(std::fs::read(&p).unwrap(), b"caf\xE9");
    }
}
