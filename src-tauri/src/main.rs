#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    appimage_use_system_wayland();

    // On Windows, set the process description visible in Task Manager.
    // std::env::set_var is not a reliable way to do this; instead we call
    // SetConsoleTitleW via a raw extern block. This only affects the
    // console-subsystem title; the GUI window title is set by Tauri via
    // tauri.conf.json → app.windows[].title.
    #[cfg(target_os = "windows")]
    {
        set_process_title();

        // Optimize WebView2 memory usage:
        // - Limit V8 old space size to 256MB per process to trigger timely garbage collection.
        // - Restrict renderer process limit and disable cross-origin site-per-process isolation for local canvas iframes.
        // - Cap disk and media caches to prevent uncontrolled memory and disk growth.
        if std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_none() {
            std::env::set_var(
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                "--js-flags=\"--max-old-space-size=256\" --renderer-process-limit=3 --disk-cache-size=33554432 --media-cache-size=33554432 --disable-features=IsolateOrigins,site-per-process",
            );
        }
    }

    fahh_editor_lib::run();
}

#[cfg(target_os = "windows")]
fn set_process_title() {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    extern "system" {
        fn SetConsoleTitleW(lp_console_title: *const u16) -> i32;
    }

    let title: Vec<u16> = OsStr::new("Fahh Editor")
        .encode_wide()
        .chain(std::iter::once(0u16))
        .collect();

    // SAFETY: title is a valid null-terminated UTF-16 string and lives for
    // the duration of this call.
    unsafe {
        SetConsoleTitleW(title.as_ptr());
    }
}

/// #153: the AppImage bundles libwayland-client from its old build host. A newer host Mesa
/// (built against wayland >= 1.24, e.g. Ubuntu 26.04) fails to load against it (undefined
/// `wl_fixes_interface`), so EGL has no driver and WebKit aborts with "Could not create default
/// EGL display: EGL_BAD_PARAMETER", leaving a blank window. Re-exec once with the system copy
/// preloaded; libwayland is backward compatible, so the newer system one is safe.
#[cfg(target_os = "linux")]
fn appimage_use_system_wayland() {
    use std::os::unix::process::CommandExt;
    use std::path::Path;
    let system = [
        "/usr/lib/x86_64-linux-gnu/libwayland-client.so.0",
        "/usr/lib64/libwayland-client.so.0",
        "/usr/lib/libwayland-client.so.0",
    ]
    .into_iter()
    .find(|p| Path::new(p).exists());
    let bundled = std::env::var_os("APPDIR").is_some_and(|d| {
        Path::new(&d)
            .join("usr/lib/libwayland-client.so.0")
            .exists()
    });
    let Some(preload) =
        wayland_preload(bundled, std::env::var("LD_PRELOAD").ok().as_deref(), system)
    else {
        return;
    };
    eprintln!(
        "fahh: AppImage: preloading {} over the bundled libwayland-client (#153)",
        system.unwrap_or_default()
    );
    let err = std::process::Command::new("/proc/self/exe")
        .args(std::env::args_os().skip(1))
        .env("LD_PRELOAD", preload)
        .exec();
    eprintln!("fahh: re-exec failed ({err}); continuing with the bundled libwayland-client");
}

/// The LD_PRELOAD value to re-exec with, or None when nothing needs overriding.
#[cfg(target_os = "linux")]
fn wayland_preload(
    bundled: bool,
    ld_preload: Option<&str>,
    system: Option<&str>,
) -> Option<String> {
    let system = system.filter(|_| bundled)?;
    match ld_preload.filter(|p| !p.is_empty()) {
        Some(p) if p.split([':', ' ']).any(|e| e == system) => None,
        Some(p) => Some(format!("{system}:{p}")),
        None => Some(system.to_string()),
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::wayland_preload;
    const SYS: &str = "/usr/lib/libwayland-client.so.0";

    #[test]
    fn preloads_system_wayland_only_inside_an_appimage_once() {
        assert_eq!(wayland_preload(true, None, Some(SYS)).as_deref(), Some(SYS));
        assert_eq!(
            wayland_preload(true, Some(""), Some(SYS)).as_deref(),
            Some(SYS)
        );
        assert_eq!(
            wayland_preload(true, Some("/x.so"), Some(SYS)).as_deref(),
            Some("/usr/lib/libwayland-client.so.0:/x.so")
        );
        assert_eq!(wayland_preload(true, Some(SYS), Some(SYS)), None); // already re-exec'd: no loop
        assert_eq!(wayland_preload(false, None, Some(SYS)), None); // deb/rpm: system libs already
        assert_eq!(wayland_preload(true, None, None), None); // no system copy: keep the bundled one
    }
}
