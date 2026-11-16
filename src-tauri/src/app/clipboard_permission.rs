//! WebView2 asks "tauri.localhost wants to see text and images copied to the clipboard" the
//! first time the page reads the clipboard (terminal paste, the editor's Paste menu item). A
//! desktop editor reading its own clipboard should never ask, so every Fahh webview answers
//! that permission itself: allowed for the app's own pages, left to WebView2 for anything else
//! (a previewed web page keeps the normal prompt).

use tauri::{plugin::TauriPlugin, Runtime};

/// The app's own origins: the bundled page and `vite dev`.
pub fn is_app_origin(uri: &str) -> bool {
    let u = uri.to_ascii_lowercase();
    ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost", "http://localhost:1420"]
        .iter()
        .any(|o| u == *o || u.starts_with(&format!("{o}/")))
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("fahh-clipboard-permission")
        .on_webview_ready(|webview| {
            #[cfg(windows)]
            let _ = webview.with_webview(|pw| unsafe {
                if let Err(e) = windows_impl::allow_clipboard_read(&pw.controller()) {
                    tracing::warn!("clipboard permission handler not installed: {e}");
                }
            });
            #[cfg(not(windows))]
            let _ = webview;
        })
        .build()
}

#[cfg(windows)]
mod windows_impl {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2Controller, ICoreWebView2PermissionRequestedEventArgs, COREWEBVIEW2_PERMISSION_KIND,
        COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;

    pub unsafe fn allow_clipboard_read(controller: &ICoreWebView2Controller) -> windows_core::Result<()> {
        let core = controller.CoreWebView2()?;
        let handler = PermissionRequestedEventHandler::create(Box::new(
            |_: Option<ICoreWebView2>, args: Option<ICoreWebView2PermissionRequestedEventArgs>| -> windows_core::Result<()> {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                if kind != COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ {
                    return Ok(());
                }
                let mut uri = windows_core::PWSTR::null();
                args.Uri(&mut uri)?;
                if super::is_app_origin(&webview2_com::take_pwstr(uri)) {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                }
                Ok(())
            },
        ));
        let mut token = Default::default();
        core.add_PermissionRequested(&handler, &mut token)
    }
}

#[cfg(test)]
mod tests {
    use super::is_app_origin;

    #[test]
    fn only_the_apps_own_pages_get_the_clipboard() {
        assert!(is_app_origin("http://tauri.localhost/"));
        assert!(is_app_origin("http://tauri.localhost"));
        assert!(is_app_origin("HTTP://TAURI.LOCALHOST/index.html"));
        assert!(is_app_origin("http://localhost:1420/"));
        assert!(!is_app_origin("https://tauri.localhost.evil.com/"));
        assert!(!is_app_origin("https://example.com/"));
        assert!(!is_app_origin("http://localhost:3000/"));
    }
}
