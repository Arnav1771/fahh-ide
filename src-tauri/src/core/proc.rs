//! Single entry point for spawning child processes.
//! On Windows every child gets CREATE_NO_WINDOW so no console flashes.
use std::process::Command;

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn cmd<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;

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
