# Accounts and Settings Sync

Accounts are **optional**. Fahh Editor works fully without one. An account lets you move your settings and theme between machines.

Open **Settings** (`Ctrl+,`) > **Account**.

---

## Create an account

1. Choose **Create an account**, enter a name, email and password.
2. Tick the newsletter box only if you want occasional release emails (it is off by default).
3. If the server asks for a code, check your email and enter it.

## Sync

| Button | What it does |
|---|---|
| **Upload settings** | Saves your current settings and colour theme to your account |
| **Download settings** | Replaces this machine's settings with the uploaded ones |

Sync is manual: nothing is uploaded unless you press Upload.

## Forgot password

On the sign-in form choose **Forgot password?**, enter your email, then the emailed code and a new password.

## What's new

A few seconds after launch, Fahh shows the newest announcement once (new releases, important notes). Close it with `Esc`; it does not come back.

## Privacy

- The sign-in session is stored in `account.json` in Fahh's data folder: `%APPDATA%\fahh` (Windows), `~/.local/share/fahh` (Linux), `~/Library/Application Support/fahh` (macOS).
- Only what you upload (settings and theme) is stored. Code and files never leave your machine.
- **Sign out** removes the local session. You can unsubscribe from the newsletter in Settings or from the link in any email.
