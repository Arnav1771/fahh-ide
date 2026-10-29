import { create } from "zustand";

/**
 * View > Settings (Ctrl+,). Saved in localStorage as one JSON object and applied live:
 * every docked editor reads the editor options from here, the terminal its font size,
 * the fahh its volume. Auto Save stays in the editor store (it predates this).
 */
export interface Settings {
  fontFamily: string;
  fontSize: number;
  wordWrap: boolean;
  minimap: boolean;
  tabSize: number;
  insertSpaces: boolean;
  lineNumbers: boolean;
  /** 0 to 100. */
  fahhVolume: number;
  terminalFontSize: number;
  /** Terminal profile "+" starts (PowerShell, cmd, Git Bash, WSL, bash…); "" = the first found. */
  terminalDefaultProfile: string;
  /** Reopen the last folder and its tabs at launch. */
  restoreSession: boolean;
  /** The custom error sound's file name; "" plays the bundled fahh. */
  fahhSound: string;
  /** Look for a new release at launch (at most once a day; a toast, never a popup). */
  checkUpdatesOnLaunch: boolean;
  /** Line numbers relative to the cursor line (Vim-style). */
  relativeLineNumbers: boolean;
  /** Keep the enclosing function/class header pinned at the top while scrolling. */
  stickyScroll: boolean;
  /** Colour matching brackets and draw their guides. */
  bracketPairs: boolean;
  /** Font ligatures (=> != ===) when the font has them. */
  fontLigatures: boolean;
  /** Which key adds a cursor on click: Alt (VS Code default) or Ctrl. */
  multiCursorModifier: "alt" | "ctrlCmd";
  /** Run the formatter when a file is saved. */
  formatOnSave: boolean;
  /** Remove spaces at line ends when saving. */
  trimTrailingWhitespace: boolean;
  /** End every saved file with one newline. */
  insertFinalNewline: boolean;
  /** Whole-window zoom in percent (Ctrl+= / Ctrl+- / Ctrl+0). */
  uiZoom: number;
}

export const SETTINGS_KEY = "fahh-settings";

export const DEFAULT_SETTINGS: Settings = {
  fontFamily: "JetBrains Mono, Fira Code, Menlo, Monaco, Consolas, monospace",
  fontSize: 14,
  wordWrap: false,
  minimap: true,
  tabSize: 2,
  insertSpaces: true,
  lineNumbers: true,
  fahhVolume: 80,
  terminalFontSize: 12,
  terminalDefaultProfile: "",
  restoreSession: true,
  fahhSound: "",
  checkUpdatesOnLaunch: true,
  relativeLineNumbers: false,
  stickyScroll: true,
  bracketPairs: true,
  fontLigatures: true,
  multiCursorModifier: "alt",
  formatOnSave: false,
  trimTrailingWhitespace: false,
  insertFinalNewline: false,
  uiZoom: 100,
};

const clamp = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d;
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

/** Saved JSON to settings: unknown keys dropped, bad values back to their defaults, numbers kept in range. */
export function parseSettings(raw: string | null | undefined): Settings {
  let o: Record<string, unknown> = {};
  try {
    const v = raw ? JSON.parse(raw) : {};
    if (v && typeof v === "object" && !Array.isArray(v)) o = v;
  } catch {
    // damaged: defaults
  }
  const d = DEFAULT_SETTINGS;
  return {
    fontFamily: typeof o.fontFamily === "string" && o.fontFamily.trim() ? o.fontFamily.trim().slice(0, 200) : d.fontFamily,
    fontSize: clamp(o.fontSize, 8, 40, d.fontSize),
    wordWrap: bool(o.wordWrap, d.wordWrap),
    minimap: bool(o.minimap, d.minimap),
    tabSize: clamp(o.tabSize, 1, 8, d.tabSize),
    insertSpaces: bool(o.insertSpaces, d.insertSpaces),
    lineNumbers: bool(o.lineNumbers, d.lineNumbers),
    fahhVolume: clamp(o.fahhVolume, 0, 100, d.fahhVolume),
    terminalFontSize: clamp(o.terminalFontSize, 8, 32, d.terminalFontSize),
    terminalDefaultProfile: typeof o.terminalDefaultProfile === "string" ? o.terminalDefaultProfile.slice(0, 40) : d.terminalDefaultProfile,
    restoreSession: bool(o.restoreSession, d.restoreSession),
    fahhSound: typeof o.fahhSound === "string" ? o.fahhSound.slice(0, 200) : d.fahhSound,
    checkUpdatesOnLaunch: bool(o.checkUpdatesOnLaunch, d.checkUpdatesOnLaunch),
    relativeLineNumbers: bool(o.relativeLineNumbers, d.relativeLineNumbers),
    stickyScroll: bool(o.stickyScroll, d.stickyScroll),
    bracketPairs: bool(o.bracketPairs, d.bracketPairs),
    fontLigatures: bool(o.fontLigatures, d.fontLigatures),
    multiCursorModifier: o.multiCursorModifier === "ctrlCmd" ? "ctrlCmd" : "alt",
    formatOnSave: bool(o.formatOnSave, d.formatOnSave),
    trimTrailingWhitespace: bool(o.trimTrailingWhitespace, d.trimTrailingWhitespace),
    insertFinalNewline: bool(o.insertFinalNewline, d.insertFinalNewline),
    uiZoom: clamp(o.uiZoom, 50, 200, d.uiZoom),
  };
}

const read = (): string | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(SETTINGS_KEY);
  } catch {
    return null;
  }
};

interface SettingsStore extends Settings {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
}

const pick = (s: SettingsStore): Settings => parseSettings(JSON.stringify(s));

export const useSettingsStore = create<SettingsStore>((set, get) => {
  const save = () => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(pick(get())));
    } catch {
      // storage blocked: the change still applies for this session
    }
  };
  return {
    ...parseSettings(read()),
    set: (key, value) => {
      // Through parseSettings, so a typed-in value is clamped exactly like a loaded one.
      set(parseSettings(JSON.stringify({ ...pick(get()), [key]: value })));
      save();
    },
    reset: () => {
      set({ ...DEFAULT_SETTINGS });
      save();
    },
  };
});
