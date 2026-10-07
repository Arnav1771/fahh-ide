// First-run welcome: shown once, reopenable from the command palette ("Show Welcome").
export const WELCOME_KEY = "fahh-onboarded";
export const UPDATES_URL = "https://arnav1771.github.io/stealth-keqing/?app=fahh";

type KV = Pick<Storage, "getItem" | "setItem">;

export function shouldShowWelcome(store: KV | undefined): boolean {
  try {
    return store?.getItem(WELCOME_KEY) !== "1";
  } catch {
    return false; // storage blocked: never trap the user in a welcome they can't dismiss for good
  }
}

export function markWelcomeSeen(store: KV | undefined): void {
  try {
    store?.setItem(WELCOME_KEY, "1");
  } catch {
    /* storage blocked: nothing to remember */
  }
}
