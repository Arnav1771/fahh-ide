#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // On Windows, set the process description visible in Task Manager.
    // std::env::set_var is not a reliable way to do this; instead we call
    // SetConsoleTitleW via a raw extern block. This only affects the
    // console-subsystem title; the GUI window title is set by Tauri via
    // tauri.conf.json → app.windows[].title.
    #[cfg(target_os = "windows")]
    set_process_title();

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
