//! Safe file writes: never leave a half-written file behind.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

const BOM: &[u8] = b"\xEF\xBB\xBF";

/// Write `bytes` to `path`, atomically where that is safe: a temp file next to it, flushed to
/// disk, then renamed over the target, so a crash or a full disk mid-save leaves the old file
/// intact (a plain `fs::write` truncates first). The file's permissions (exec bit included) are
/// kept and a symlink is written through to its target.
///
/// It writes in place instead (keeping the file's identity: owner, ACLs, hard links) when a
/// rename would change more than the bytes or cannot work:
/// - UNC paths, WSL included (`\\wsl.localhost\...`): a rename through the 9P/SMB share drops
///   the Linux mode and owner;
/// - a file with more than one hard link (a rename would split it from the others);
/// - a folder you can write files in but not create files in (temp creation fails);
/// - a rename Windows keeps refusing (antivirus or OneDrive holding the file without
///   share-delete), after a few short retries.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    static N: AtomicU32 = AtomicU32::new(0);
    let target: PathBuf = match std::fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() => std::fs::canonicalize(path)?,
        _ => path.to_path_buf(),
    };
    let meta = std::fs::metadata(&target).ok();
    if is_unc(&target) || meta.as_ref().is_some_and(|m| hard_links(m) > 1) {
        return write_in_place(&target, bytes);
    }
    let dir = target.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = dir.join(format!(".{name}.fahh-{}-{}.tmp", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
    let mut f = match std::fs::File::create(&tmp) {
        Ok(f) => f,
        Err(_) if meta.is_some() => return write_in_place(&target, bytes),
        Err(e) => return Err(e),
    };
    let result = (|| {
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        if let Some(m) = &meta {
            std::fs::set_permissions(&tmp, m.permissions())?;
        }
        rename_with_retry(&tmp, &target)
    })();
    match result {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            if e.kind() == std::io::ErrorKind::PermissionDenied && meta.is_some() {
                write_in_place(&target, bytes)
            } else {
                Err(e)
            }
        }
    }
}

fn is_unc(p: &Path) -> bool {
    let s = p.to_string_lossy();
    s.starts_with(r"\\") || s.starts_with("//")
}

#[cfg(unix)]
fn hard_links(m: &std::fs::Metadata) -> u64 {
    std::os::unix::fs::MetadataExt::nlink(m)
}
#[cfg(not(unix))]
fn hard_links(_m: &std::fs::Metadata) -> u64 {
    1 // ponytail: Windows link count needs GetFileInformationByHandle; NTFS hard links are rare in projects
}

/// Antivirus and sync clients briefly hold a file open without share-delete on Windows.
fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut last = None;
    for attempt in 0..5 {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                last = Some(e);
                std::thread::sleep(std::time::Duration::from_millis(40 * (attempt + 1)));
            }
            Err(e) => return Err(e),
        }
    }
    Err(last.unwrap_or_else(|| std::io::Error::other("rename failed")))
}

fn write_in_place(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut f = std::fs::OpenOptions::new().write(true).truncate(true).create(true).open(path)?;
    f.write_all(bytes)?;
    f.sync_all()
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

    #[cfg(unix)]
    #[test]
    fn hard_links_stay_linked() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.txt");
        let b = dir.path().join("b.txt");
        std::fs::write(&a, "old").unwrap();
        std::fs::hard_link(&a, &b).unwrap();
        write_atomic(&a, b"new").unwrap();
        assert_eq!(std::fs::read(&b).unwrap(), b"new", "the other link sees the save");
    }

    #[cfg(unix)]
    #[test]
    fn saves_into_a_folder_where_no_new_file_can_be_created() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let ro = dir.path().join("ro");
        std::fs::create_dir(&ro).unwrap();
        let f = ro.join("x.sh");
        std::fs::write(&f, "old").unwrap();
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(0o555)).unwrap();
        let r = write_atomic(&f, b"new");
        std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(0o755)).unwrap();
        r.unwrap();
        assert_eq!(std::fs::read(&f).unwrap(), b"new");
        assert_eq!(std::fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o755);
    }

    #[test]
    fn unc_paths_are_detected() {
        assert!(is_unc(Path::new(r"\\wsl.localhost\Ubuntu\home\x.sh")));
        assert!(is_unc(Path::new("//wsl$/Ubuntu/x")));
        assert!(!is_unc(Path::new("/home/x")));
        assert!(!is_unc(Path::new(r"C:\x")));
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
