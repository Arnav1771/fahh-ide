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
    if let Some(v) = host_ld_library_path() {
        match v {
            Some(v) => c.env("LD_LIBRARY_PATH", v),
            None => c.env_remove("LD_LIBRARY_PATH"),
        };
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// Tie a child (and everything it starts afterwards) to Fahh's lifetime: on Windows it joins
/// one kill-on-close job object, so a crash or a kill of Fahh ends runs, language servers,
/// debug adapters, formatters and agent commands too. Elsewhere a no-op: Unix children are
/// stopped on exit (RunEvent::Exit) and by process group.
/// ponytail: PR_SET_PDEATHSIG is not used; it fires when the spawning *thread* exits, and
/// spawns happen on short-lived worker threads.
#[cfg(windows)]
pub fn own(child: &impl std::os::windows::io::AsRawHandle) {
    use std::sync::OnceLock;
    use windows_sys::Win32::System::JobObjects::*;
    static JOB: OnceLock<usize> = OnceLock::new();
    let job = *JOB.get_or_init(|| {
        // SAFETY: plain Win32 calls; the handle lives as long as Fahh (closed by the OS on exit,
        // which is exactly what kills the job's processes).
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return 0;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info as *const _ as *const std::ffi::c_void, std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32);
            job as usize
        }
    });
    if job != 0 {
        // SAFETY: our job handle and the child's own process handle.
        unsafe { AssignProcessToJobObject(job as _, child.as_raw_handle() as _) };
    }
}

/// `own` for a tokio child (its handle comes as a raw handle).
#[cfg(windows)]
pub fn own_raw(handle: std::os::windows::io::RawHandle) {
    struct H(std::os::windows::io::RawHandle);
    impl std::os::windows::io::AsRawHandle for H {
        fn as_raw_handle(&self) -> std::os::windows::io::RawHandle {
            self.0
        }
    }
    own(&H(handle));
}
#[cfg(not(windows))]
pub fn own<T>(_child: &T) {}

/// LD_LIBRARY_PATH for host programs started from inside an AppImage: AppRun points it at the
/// bundled libs, and host tools must not load those (#153: `git push` died on the old bundled
/// libnghttp2). The value without the AppImage's entries (inner None = unset it); outer None =
/// not in an AppImage, leave it alone.
pub fn host_ld_library_path() -> Option<Option<String>> {
    let appdir = std::env::var("APPDIR").ok().filter(|d| !d.is_empty())?;
    Some(strip_dir(&std::env::var("LD_LIBRARY_PATH").ok()?, &appdir))
}

fn strip_dir(paths: &str, dir: &str) -> Option<String> {
    let kept: Vec<&str> = paths.split(':').filter(|p| !p.is_empty() && !p.starts_with(dir)).collect();
    (!kept.is_empty()).then(|| kept.join(":"))
}

/// A bare program name resolved by `lookup` (PATH + PATHEXT); a path, or a name not found,
/// is left alone so the spawn error still names what the user asked for.
#[cfg_attr(not(windows), allow(dead_code))]
fn resolve_program(program: &std::ffi::OsStr, lookup: impl Fn(&std::ffi::OsStr) -> Option<std::path::PathBuf>) -> std::ffi::OsString {
    let bare = !program.to_string_lossy().contains(['/', '\\']);
    bare.then(|| lookup(program)).flatten().map(|p| p.into_os_string()).unwrap_or_else(|| program.to_os_string())
}

/// Run blocking work (disk walks, git, process probes) on Tauri's blocking pool, so async
/// commands never hold the UI thread or an async worker.
pub async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
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
    fn appimage_lib_dirs_are_dropped_for_host_programs() {
        let a = "/tmp/.mount_Fahh1";
        assert_eq!(strip_dir("/tmp/.mount_Fahh1/usr/lib/:/tmp/.mount_Fahh1/lib/:", a), None);
        assert_eq!(strip_dir("/tmp/.mount_Fahh1/usr/lib/:/opt/cuda/lib64", a).as_deref(), Some("/opt/cuda/lib64"));
        assert_eq!(strip_dir("/opt/x:/opt/y", a).as_deref(), Some("/opt/x:/opt/y"));
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
