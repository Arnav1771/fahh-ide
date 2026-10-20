//! Folders that live inside WSL, as Windows sees them: `\\wsl.localhost\<distro>\home\...`
//! (or the older `\\wsl$\<distro>\...`).
//!
//! Windows cannot use such a UNC path as a process's working directory: `cmd`
//! falls back to C:\Windows and most programs refuse to start ("The directory
//! name is invalid", os error 267). Commands for these folders therefore run
//! inside the distro itself, via `wsl.exe -d <distro> --cd <linux dir>`.

/// A path inside a WSL distro.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslPath {
    pub distro: String,
    /// Absolute Linux path, e.g. `/home/dell/proj`.
    pub linux: String,
}

/// Parses `\\wsl.localhost\Ubuntu\home\x`, `\\wsl$\Ubuntu\home\x`, their forward-slash
/// spellings and the `\\?\UNC\wsl.localhost\...` long form. Anything else is None.
pub fn parse(path: &str) -> Option<WslPath> {
    let p = path.replace('/', "\\");
    let p = p
        .strip_prefix(r"\\?\UNC\")
        .map(|rest| format!(r"\\{rest}"))
        .unwrap_or(p);
    let rest = p.strip_prefix(r"\\")?;
    let mut parts = rest.split('\\');
    let host = parts.next()?;
    if !host.eq_ignore_ascii_case("wsl.localhost") && !host.eq_ignore_ascii_case("wsl$") {
        return None;
    }
    let distro = parts.next().filter(|d| !d.is_empty())?.to_string();
    let segs: Vec<&str> = parts.filter(|s| !s.is_empty()).collect();
    Some(WslPath { distro, linux: format!("/{}", segs.join("/")) })
}

/// The Windows spelling of a Linux path inside `distro`.
pub fn to_unc(distro: &str, linux: &str) -> String {
    let tail = linux.trim_start_matches('/').replace('/', "\\");
    if tail.is_empty() {
        format!(r"\\wsl.localhost\{distro}")
    } else {
        format!(r"\\wsl.localhost\{distro}\{tail}")
    }
}

/// `C:\Users\x` -> `/mnt/c/Users/x`, for running a WSL shell in a Windows folder.
pub fn windows_to_mnt(path: &str) -> Option<String> {
    let b = path.as_bytes();
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        let rest = path[2..].replace('\\', "/");
        let rest = rest.trim_start_matches('/');
        let drive = (b[0] as char).to_ascii_lowercase();
        return Some(if rest.is_empty() { format!("/mnt/{drive}") } else { format!("/mnt/{drive}/{rest}") });
    }
    None
}

/// POSIX single-quoting, safe for `bash -lc`.
pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// `wsl.exe [-d distro] --cd <dir> -- bash -lc <script>`, started from the user's home
/// so Windows never sees a UNC working directory.
pub fn command(distro: Option<&str>, linux_cwd: &str, script: &str) -> std::process::Command {
    let mut c = crate::core::proc::cmd("wsl.exe");
    if let Some(d) = distro {
        c.args(["-d", d]);
    }
    c.args(["--cd", linux_cwd, "--", "bash", "-lc", script]);
    if let Some(home) = dirs::home_dir() {
        c.current_dir(home);
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_spelling() {
        let want = Some(WslPath { distro: "Ubuntu".into(), linux: "/home/dell/proj".into() });
        assert_eq!(parse(r"\\wsl.localhost\Ubuntu\home\dell\proj"), want);
        assert_eq!(parse(r"\\wsl$\Ubuntu\home\dell\proj\"), want);
        assert_eq!(parse("//wsl.localhost/Ubuntu/home/dell/proj"), want);
        assert_eq!(parse(r"\\?\UNC\wsl.localhost\Ubuntu\home\dell\proj"), want);
        assert_eq!(parse(r"\\WSL.LOCALHOST\Ubuntu"), Some(WslPath { distro: "Ubuntu".into(), linux: "/".into() }));
    }

    #[test]
    fn ignores_other_paths() {
        assert_eq!(parse(r"C:\Users\x"), None);
        assert_eq!(parse(r"\\server\share\x"), None);
        assert_eq!(parse("/home/dell"), None);
        assert_eq!(parse(r"\\wsl.localhost\"), None);
    }

    #[test]
    fn round_trips_to_unc() {
        assert_eq!(to_unc("Ubuntu", "/home/dell/proj"), r"\\wsl.localhost\Ubuntu\home\dell\proj");
        assert_eq!(to_unc("Ubuntu", "/"), r"\\wsl.localhost\Ubuntu");
        let p = parse(&to_unc("Debian", "/srv/a b")).unwrap();
        assert_eq!((p.distro.as_str(), p.linux.as_str()), ("Debian", "/srv/a b"));
    }

    #[test]
    fn maps_windows_drives_into_mnt() {
        assert_eq!(windows_to_mnt(r"C:\Users\x y"), Some("/mnt/c/Users/x y".into()));
        assert_eq!(windows_to_mnt(r"D:\"), Some("/mnt/d".into()));
        assert_eq!(windows_to_mnt(r"\\server\x"), None);
    }

    #[test]
    fn quotes_for_bash() {
        assert_eq!(sh_quote("it's"), r"'it'\''s'");
        assert_eq!(sh_quote("/a b/c.py"), "'/a b/c.py'");
    }

    #[test]
    fn command_runs_bash_in_the_distro_folder() {
        let c = command(Some("Ubuntu"), "/home/dell", "ls");
        let args: Vec<_> = c.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(c.get_program(), "wsl.exe");
        assert_eq!(args, ["-d", "Ubuntu", "--cd", "/home/dell", "--", "bash", "-lc", "ls"]);
    }
}
