/**
 * Fahh account (Neon Auth) and settings sync (the fahh-cloud API). The network and the session
 * live in Rust (core/account.rs); this is the app side: what is synced and how it is applied.
 */
import { invoke } from "@tauri-apps/api/core";
import { parseSettings, useSettingsStore, type Settings } from "../store/settingsStore";
import { isThemeId, useThemeStore } from "../store/themeStore";
import { confirmDialog } from "../store/dialogStore";

export interface AccountUser {
  id: string;
  email: string;
  name: string;
}

/** Signed in, or the email must be confirmed with the code that was just sent. */
export type AuthOutcome = { status: "signedIn"; user: AccountUser } | { status: "needsCode"; email: string };

export const accountStatus = () => invoke<AccountUser | null>("account_status");
export const signUp = (email: string, password: string, name: string) => invoke<AuthOutcome>("account_sign_up", { email, password, name });
export const signIn = (email: string, password: string) => invoke<AuthOutcome>("account_sign_in", { email, password });
export const signOut = () => invoke<void>("account_sign_out");
export const sendCode = (email: string, purpose: "email-verification" | "forget-password") => invoke<void>("account_send_code", { email, purpose });
export const verifyEmail = (email: string, code: string) => invoke<AccountUser>("account_verify_email", { email, code });
export const resetPassword = (email: string, code: string, password: string) => invoke<void>("account_reset_password", { email, code, password });
export const setNewsletter = (subscribe: boolean) => invoke<void>("account_set_newsletter", { subscribe });

/** What a sync carries: View > Settings and the colour theme. Never keys or paths. */
export interface SyncedSettings {
  v: 1;
  settings: Settings;
  theme: string;
}

export function snapshot(): SyncedSettings {
  return {
    v: 1,
    // Through parseSettings: only known keys, already clamped.
    settings: parseSettings(JSON.stringify(useSettingsStore.getState())),
    theme: useThemeStore.getState().activeTheme,
  };
}

/** Apply downloaded settings, validated exactly like the app's own saved settings. */
export function applySynced(data: unknown): void {
  const d = (data ?? {}) as Partial<SyncedSettings>;
  const clean = parseSettings(JSON.stringify(d.settings ?? {}));
  const store = useSettingsStore.getState();
  for (const key of Object.keys(clean) as (keyof Settings)[]) {
    if (store[key] !== clean[key]) store.set(key, clean[key]);
  }
  if (isThemeId(d.theme)) useThemeStore.getState().setTheme(d.theme);
}

/** Upload this machine's settings; resolves to the server time of the save. */
export const pushSettings = () => invoke<string | null>("account_push_settings", { settings: snapshot() });

/** Download and apply the account's settings; false when the account has none yet. */
export async function pullSettings(): Promise<boolean> {
  const cloud = await invoke<{ settings: unknown; updatedAt: string | null } | null>("account_pull_settings");
  if (!cloud) return false;
  applySynced(cloud.settings);
  return true;
}

// ─── What's new ───────────────────────────────────────────────────────────────

export interface Announcement {
  id: number;
  title: string;
  body: string;
  url: string | null;
}

const SEEN_KEY = "fahh-announcement-seen";

/** The newest announcement this machine has not shown yet, if any. */
export function nextAnnouncement(list: Announcement[], seen: number): Announcement | null {
  const newest = list.reduce<Announcement | null>((a, b) => (!a || b.id > a.id ? b : a), null);
  return newest && newest.id > seen ? newest : null;
}

/** At launch: show the newest unseen announcement once. Silent when offline. */
export async function showWhatsNew(openUrl: (url: string) => void): Promise<void> {
  let seen = 0;
  try {
    seen = Number(localStorage.getItem(SEEN_KEY) ?? 0) || 0;
  } catch {
    // storage blocked: may show again next launch
  }
  const list = await invoke<Announcement[]>("cloud_announcements").catch(() => []);
  const a = nextAnnouncement(list, seen);
  if (!a) return;
  try {
    localStorage.setItem(SEEN_KEY, String(a.id));
  } catch {
    // ignore
  }
  const open = await confirmDialog({ title: a.title, message: a.body, ok: a.url ? "Open" : "Got it" });
  if (open && a.url) openUrl(a.url);
}
