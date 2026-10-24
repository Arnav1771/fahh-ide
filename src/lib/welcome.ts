// First-run welcome: shown once, reopenable from Help > Welcome and the palette ("Show Welcome").
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

export type WelcomeStep = "sound" | "code" | "look" | "agent" | "setup";

/** The tour, in order. Each step has one thing to do; every one can be skipped. */
export const WELCOME_STEPS: readonly { id: WelcomeStep; label: string; title: string }[] = [
  { id: "sound", label: "Sound", title: "Errors make a sound" },
  { id: "code", label: "Code", title: "Open your code" },
  { id: "look", label: "Look", title: "Make it yours" },
  { id: "agent", label: "Fahh Local", title: "Set up Fahh Local (optional)" },
  { id: "setup", label: "Check setup", title: "Check your setup" },
];

/** The try-it line in the tour: the parser's complaint, or null when it is valid JavaScript. */
export function syntaxError(code: string): string | null {
  try {
    // Compiles the text without running it: a real parser, no evaluation.
    new Function(code);
    return null;
  } catch (e) {
    return e instanceof SyntaxError ? e.message : null;
  }
}
