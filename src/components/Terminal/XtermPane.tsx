import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { attach, clearBuffer, resize, write } from "../../lib/ptySessions";
import { noteLocalUrls, openBrowser } from "../../lib/browser";
import { useSettingsStore } from "../../store/settingsStore";
import { useTerminalStore, type TerminalSession } from "../../store/terminalStore";

const ANSI = new RegExp("\\u001b\\[[0-9;?]*[ -/]*[@-~]|\\u001b\\][^\\u0007]*\\u0007", "g");

/** Live xterm instances, for Clear and focus from the toolbar. */
const terms = new Map<string, Terminal>();

export function clearTerminal(sessionId: string): void {
  terms.get(sessionId)?.clear();
  clearBuffer(sessionId);
}

function themeFromCss() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: v("--fahh-bg", "#1e1e2e"),
    foreground: v("--fahh-text", "#cdd6f4"),
    cursor: v("--fahh-accent", "#89b4fa"),
    cursorAccent: v("--fahh-bg", "#1e1e2e"),
    selectionBackground: "rgba(137, 180, 250, 0.35)",
  };
}

/** One terminal tab: xterm.js drawing a real shell (see lib/ptySessions). */
export function XtermPane({ session, active, onFocus }: { session: TerminalSession; active: boolean; onFocus: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const fontSize = useSettingsStore((s) => s.terminalFontSize);
  const fontFamily = useSettingsStore((s) => s.fontFamily);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const settings = useSettingsStore.getState();
    const term = new Terminal({
      fontSize: settings.terminalFontSize,
      fontFamily: settings.fontFamily,
      cursorBlink: true,
      scrollback: 5000,
      theme: themeFromCss(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, uri) => openBrowser(uri)));
    term.open(el);
    try {
      fit.fit();
    } catch {
      // hidden panel: fitted when it is shown
    }
    termRef.current = term;
    fitRef.current = fit;
    terms.set(session.id, term);

    // Ctrl+C copies when text is selected (otherwise it interrupts, as in any shell);
    // Ctrl+Shift+C / Ctrl+Shift+V copy and paste, as in VS Code.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown" || !(e.ctrlKey || e.metaKey)) return true;
      const k = e.key.toLowerCase();
      if (k === "c" && (e.shiftKey || term.hasSelection())) {
        if (term.hasSelection()) void navigator.clipboard?.writeText(term.getSelection());
        e.preventDefault();
        return false;
      }
      if (k === "v" && e.shiftKey) {
        void navigator.clipboard?.readText().then((t) => term.paste(t));
        e.preventDefault();
        return false;
      }
      return true;
    });

    let alive = true;
    let detach = () => {};
    const profile = session.profile || settings.terminalDefaultProfile;
    void attach(
      session.id,
      { profile, cwd: session.cwd ?? useTerminalStore.getState().cwd, cols: term.cols, rows: term.rows },
      (data) => {
        term.write(data);
        noteLocalUrls(data.replace(ANSI, "")); // offer "localhost:5173" in the status bar
      },
      (code) => term.write(`\r\n\x1b[2m[process exited${code === null ? "" : ` with code ${code}`}]\x1b[0m\r\n`)
    ).then((fn) => {
      if (alive) detach = fn;
      else fn();
    });
    const input = term.onData((d) => void write(session.id, d));

    const ro = new ResizeObserver(() => {
      if (!el.offsetWidth || !el.offsetHeight) return;
      try {
        fit.fit();
        resize(session.id, term.cols, term.rows);
      } catch {
        // disposed mid-resize
      }
    });
    ro.observe(el);
    const retheme = () => window.setTimeout(() => (term.options.theme = themeFromCss()), 0);
    window.addEventListener("fahh-theme-change", retheme);

    return () => {
      alive = false;
      detach();
      input.dispose();
      ro.disconnect();
      window.removeEventListener("fahh-theme-change", retheme);
      terms.delete(session.id);
      term.dispose();
    };
    // One xterm per session for the pane's lifetime; settings changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    term.options.fontFamily = fontFamily;
    try {
      fitRef.current?.fit();
      resize(session.id, term.cols, term.rows);
    } catch {
      // hidden
    }
  }, [fontSize, fontFamily, session.id]);

  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active]);

  return <div ref={ref} onMouseDown={onFocus} className="fahh-xterm h-full w-full min-h-0 min-w-0 pl-2 pt-1" data-session={session.id} />;
}
