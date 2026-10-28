/**
 * Fahh account (Neon Auth) and settings sync (the fahh-cloud API). The network and the session
 * live in Rust (core/account.rs); this is the app side: what is synced and how it is applied.
 */
import { invoke } from "@tauri-apps/api/core";
import { parseSettings, useSettingsStore, type Settings } from "../store/settingsStore";
import { isThemeId, useThemeStore } from "../store/themeStore";

export interface AccountUser {
  id: string;
  email: string;
  name: string;
}

export const accountStatus = () => invoke<AccountUser | null>("account_status");
export const signUp = (email: string, password: string, name: string) => invoke<AccountUser>("account_sign_up", { email, password, name });
export const signIn = (email: string, password: string) => invoke<AccountUser>("account_sign_in", { email, password });
export const signOut = () => invoke<void>("account_sign_out");

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
