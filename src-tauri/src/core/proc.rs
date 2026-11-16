//! Single entry point for spawning child processes.
//! On Windows every child gets CREATE_NO_WINDOW so no console flashes.
use std::process::Command;

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn cmd<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    // Windows: `Command::new("npm")` only finds npm.exe, never the npm.cmd / npx.cmd / ts-node.cmd
    // shims npm installs, so TypeScript Run and npm-based tool installs always failed. Resolve
    // a bare name through PATH and PATHEXT first, as a shell would (std quotes .cmd arguments).
    #[cfg(windows)]
    let program = resolve_program(program.as_ref(), |n| which::which(n).ok());
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// A bare program name resolved by `lookup` (PATH + PATHEXT); a path, or a name not found,
/// is left alone so the spawn error still names what the user asked for.
#[cfg_attr(not(windows), allow(dead_code))]
fn resolve_program(program: &std::ffi::OsStr, lookup: impl Fn(&std::ffi::OsStr) -> Option<std::path::PathBuf>) -> std::ffi::OsString {
    let bare = !program.to_string_lossy().contains(['/', '\\']);
    bare.then(|| lookup(program)).flatten().map(|p| p.into_os_string()).unwrap_or_else(|| program.to_os_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_names_resolve_through_path_and_pathext() {
        use std::ffi::OsStr;
        use std::path::PathBuf;
        let lookup = |n: &OsStr| (n == "npm").then(|| PathBuf::from(r"C:\nodejs\npm.cmd"));
        assert_eq!(resolve_program(OsStr::new("npm"), lookup), r"C:\nodejs\npm.cmd");
        assert_eq!(resolve_program(OsStr::new("nope"), lookup), "nope");
        assert_eq!(resolve_program(OsStr::new(r"C:\py\python.exe"), lookup), r"C:\py\python.exe");
        assert_eq!(resolve_program(OsStr::new("/usr/bin/npm"), lookup), "/usr/bin/npm");
    }

    #[test]
    fn builds_command_for_program() {
        assert_eq!(cmd("echo").get_program(), "echo");
    }

    #[cfg(not(windows))]
    #[test]
    fn spawns_and_runs() {
        let out = cmd("sh").args(["-c", "printf hi"]).output().unwrap();
        assert_eq!(out.stdout, b"hi");
    }

    #[cfg(windows)]
    #[test]
    fn spawns_without_console() {
        assert_eq!(CREATE_NO_WINDOW, 0x08000000);
        let out = cmd("cmd").args(["/C", "echo hi"]).output().unwrap();
        assert!(out.status.success());
    }
}
