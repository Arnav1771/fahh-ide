//! Fahh account: sign up and sign in against Neon Auth (Managed Better Auth, REST), keep the
//! session in the app data dir, and sync settings with the Fahh API (Arnav1771/fahh-cloud).
//!
//! Everything goes through Rust rather than the webview: Neon Auth only trusts http(s)
//! origins (macOS/Linux webviews are `tauri://localhost`), and the session token stays out
//! of page storage. The API only ever sees a short-lived JWT, never the session.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The deployed backend; `FAHH_AUTH_URL` / `FAHH_API_URL` (build or run time) point elsewhere.
const AUTH_URL: &str = match option_env!("FAHH_AUTH_URL") {
    Some(u) => u,
    None => "https://ep-dry-term-ahdd7ccn.neonauth.c-3.us-east-1.aws.neon.tech/neondb/auth",
};
const API_URL: &str = match option_env!("FAHH_API_URL") {
    Some(u) => u,
    None => "https://br-proud-queen-ahotxvvz-fahhapi.compute.c-3.us-east-1.aws.neon.tech",
};
/// A trusted origin on the auth server (Windows' webview origin); Better Auth checks it on POSTs.
const ORIGIN: &str = "https://tauri.localhost";

fn auth_url() -> String {
    std::env::var("FAHH_AUTH_URL").unwrap_or_else(|_| AUTH_URL.into()).trim_end_matches('/').to_string()
}
fn api_url() -> String {
    std::env::var("FAHH_API_URL").unwrap_or_else(|_| API_URL.into()).trim_end_matches('/').to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountUser {
    pub id: String,
    pub email: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Stored {
    /// The signed session cookie(s) (`name=value; ...`): managed Neon Auth reads the session
    /// from the cookie, not from a bearer header.
    session: String,
    user: AccountUser,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CloudSettings {
    pub settings: Value,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<String>,
}

fn account_file() -> PathBuf {
    crate::agent::store::data_dir().join("account.json")
}

fn load(path: &Path) -> Option<Stored> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn save(path: &Path, stored: &Stored) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, serde_json::to_vec(stored).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(Duration::from_secs(20)).build().map_err(|e| e.to_string())
}

/// Better Auth answers errors as `{ "message": ..., "code": ... }`.
fn error_text(status: reqwest::StatusCode, body: &str) -> String {
    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let msg = parsed.as_ref().and_then(|v| v["message"].as_str().or(v["error"].as_str())).map(str::to_string);
    match msg {
        Some(m) if !m.is_empty() => m,
        _ if status == reqwest::StatusCode::UNAUTHORIZED => "Wrong email or password.".into(),
        _ => format!("The account service answered {status}."),
    }
}

/// The session cookies from sign-up / sign-in (`Set-Cookie` headers) plus the user.
fn parse_auth(set_cookies: &[String], body: &Value) -> Result<Stored, String> {
    let session = set_cookies
        .iter()
        .filter_map(|c| c.split(';').next())
        .map(str::trim)
        .filter(|kv| kv.contains("session_token=") && !kv.ends_with('='))
        .collect::<Vec<_>>()
        .join("; ");
    if session.is_empty() {
        return Err("The account service sent no session.".into());
    }
    let user: AccountUser = serde_json::from_value(body["user"].clone()).map_err(|_| "The account service sent no user.".to_string())?;
    Ok(Stored { session, user })
}

async fn post_auth(path: &str, payload: Value) -> Result<AccountUser, String> {
    let res = client()?
        .post(format!("{}{path}", auth_url()))
        .header("origin", ORIGIN)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Could not reach the account service: {e}"))?;
    let status = res.status();
    let cookies: Vec<String> = res.headers().get_all("set-cookie").iter().filter_map(|v| v.to_str().ok()).map(str::to_string).collect();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(error_text(status, &body));
    }
    let stored = parse_auth(&cookies, &serde_json::from_str(&body).map_err(|e| e.to_string())?)?;
    save(&account_file(), &stored)?;
    Ok(stored.user)
}

/// A short-lived JWT for the API, from the stored session. A dead session signs out.
async fn jwt() -> Result<String, String> {
    let stored = load(&account_file()).ok_or("Sign in to sync settings.")?;
    let res = client()?
        .get(format!("{}/token", auth_url()))
        .header("origin", ORIGIN)
        .header("cookie", &stored.session)
        .send()
        .await
        .map_err(|e| format!("Could not reach the account service: {e}"))?;
    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        let _ = std::fs::remove_file(account_file());
        return Err("Your session ended. Sign in again.".into());
    }
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    body["token"].as_str().map(str::to_string).ok_or_else(|| "The account service sent no token.".into())
}

#[tauri::command]
pub fn account_status() -> Option<AccountUser> {
    load(&account_file()).map(|s| s.user)
}

#[tauri::command]
pub async fn account_sign_up(email: String, password: String, name: String) -> Result<AccountUser, String> {
    let name = if name.trim().is_empty() { email.split('@').next().unwrap_or("").to_string() } else { name };
    post_auth("/sign-up/email", serde_json::json!({ "email": email.trim(), "password": password, "name": name.trim() })).await
}

#[tauri::command]
pub async fn account_sign_in(email: String, password: String) -> Result<AccountUser, String> {
    post_auth("/sign-in/email", serde_json::json!({ "email": email.trim(), "password": password })).await
}

#[tauri::command]
pub async fn account_sign_out() -> Result<(), String> {
    if let Some(stored) = load(&account_file()) {
        // Best effort: end the session on the server too.
        if let Ok(c) = client() {
            let _ = c.post(format!("{}/sign-out", auth_url())).header("origin", ORIGIN).header("cookie", &stored.session).send().await;
        }
    }
    match std::fs::remove_file(account_file()) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Upload these settings (replaces what the account had).
#[tauri::command]
pub async fn account_push_settings(settings: Value) -> Result<Option<String>, String> {
    if !settings.is_object() {
        return Err("Settings must be an object.".into());
    }
    let token = jwt().await?;
    let res = client()?
        .put(format!("{}/v1/settings", api_url()))
        .bearer_auth(token)
        .json(&serde_json::json!({ "settings": settings }))
        .send()
        .await
        .map_err(|e| format!("Could not reach the sync service: {e}"))?;
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(error_text(status, &body));
    }
    let v: Value = serde_json::from_str(&body).unwrap_or_default();
    Ok(v["updatedAt"].as_str().map(str::to_string))
}

/// The account's settings, or None when nothing was synced yet.
#[tauri::command]
pub async fn account_pull_settings() -> Result<Option<CloudSettings>, String> {
    let token = jwt().await?;
    let res = client()?
        .get(format!("{}/v1/settings", api_url()))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Could not reach the sync service: {e}"))?;
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(error_text(status, &body));
    }
    let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    Ok(match &v["settings"] {
        Value::Null => None,
        s => Some(CloudSettings { settings: s.clone(), updated_at: v["updatedAt"].as_str().map(str::to_string) }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_session_cookie_and_user_from_sign_in() {
        let body = serde_json::json!({ "token": "s1", "user": { "id": "u1", "email": "a@b.c", "name": "A", "emailVerified": false } });
        let cookies = vec![
            "__Secure-neon-auth.session_token=s1.sig; Path=/; HttpOnly; Secure; SameSite=None".to_string(),
            "__Secure-neon-auth.session_data=; Max-Age=0".to_string(),
            "other=1; Path=/".to_string(),
        ];
        let s = parse_auth(&cookies, &body).unwrap();
        assert_eq!(s.session, "__Secure-neon-auth.session_token=s1.sig");
        assert_eq!(s.user, AccountUser { id: "u1".into(), email: "a@b.c".into(), name: "A".into() });
        assert!(parse_auth(&[], &body).is_err(), "no cookie, no session");
        assert!(parse_auth(&cookies, &serde_json::json!({ "user": {} })).is_err());
    }

    #[test]
    fn shows_the_service_error_message() {
        assert_eq!(error_text(reqwest::StatusCode::BAD_REQUEST, r#"{"message":"User already exists","code":"X"}"#), "User already exists");
        assert_eq!(error_text(reqwest::StatusCode::UNAUTHORIZED, ""), "Wrong email or password.");
        assert!(error_text(reqwest::StatusCode::BAD_GATEWAY, "<html>").contains("502"));
    }

    #[test]
    fn stored_session_round_trips() {
        let dir = std::env::temp_dir().join(format!("fahh-account-{}", std::process::id()));
        let path = dir.join("account.json");
        let s = Stored { session: "tok".into(), user: AccountUser { id: "u".into(), email: "e@x.y".into(), name: "".into() } };
        save(&path, &s).unwrap();
        assert_eq!(load(&path), Some(s));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Talks to the deployed backend and creates a throwaway user
    /// (remove with fahh-cloud/scripts/cleanup-smoke.mjs). `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn signs_up_and_syncs_against_the_live_backend() {
        let dir = std::env::temp_dir().join(format!("fahh-account-live-{}", std::process::id()));
        std::env::set_var("FAHH_DATA_DIR", &dir);
        let email = format!("fahh-e2e-rust-{}@example.com", std::process::id());
        let user = account_sign_up(email.clone(), "Fahh-Rust-test-1!".into(), "".into()).await.unwrap();
        assert_eq!(user.email, email);
        assert_eq!(account_status().map(|u| u.email), Some(email));
        account_push_settings(serde_json::json!({ "fontSize": 18 })).await.unwrap();
        let back = account_pull_settings().await.unwrap().unwrap();
        assert_eq!(back.settings["fontSize"], 18);
        account_sign_out().await.unwrap();
        assert_eq!(account_status(), None);
        assert!(account_pull_settings().await.is_err(), "signed out: no access");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
