import { useEffect, useRef } from "react";
import { findFileLinks, resolveLinkPath } from "../../lib/termLinks";
import { openAt } from "../../lib/navigation";
import { useFileStore } from "../../store/fileStore";
import { useToastStore } from "../../store/toastStore";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { attach, clearBuffer, resize, write } from "../../lib/ptySessions";
import { noteLocalUrls, openBrowser } from "../../lib/browser";
import { useSettingsStore } from "../../store/settingsStore";
import { unscaleForElement } from "../../lib/scaledPointer";
import { scrollbackWheelLines } from "../../lib/termWheel";
import {
  useTerminalStore,
  type TerminalSession,
} from "../../store/terminalStore";

const ANSI = new RegExp(
  "\\u001b\\[[0-9;?]*[ -/]*[@-~]|\\u001b\\][^\\u0007]*\\u0007",
  "g",
);

/**
 * The folder a new shell starts in. At launch the terminal panel mounts before the folder
 * passed on the command line (or restored) is open: wait a moment for it rather than
 * starting in the home folder.
 */
function startFolder(own?: string): Promise<string> {
  if (own) return Promise.resolve(own);
  const now = useTerminalStore.getState().cwd;
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      unsub();
      resolve(useTerminalStore.getState().cwd);
    }, 3000);
    const unsub = useTerminalStore.subscribe((s) => {
      if (!s.cwd) return;
      window.clearTimeout(timer);
      unsub();
      resolve(s.cwd);
    });
  });
}

/** Live xterm instances, for Clear and focus from the toolbar. */
const terms = new Map<string, Terminal>();

export function clearTerminal(sessionId: string): void {
  terms.get(sessionId)?.clear();
  clearBuffer(sessionId);
}

function themeFromCss() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;
  return {
    background: v("--fahh-bg", "#1e1e2e"),
    foreground: v("--fahh-text", "#cdd6f4"),
    cursor: v("--fahh-accent", "#89b4fa"),
    cursorAccent: v("--fahh-bg", "#1e1e2e"),
    selectionBackground: "rgba(137, 180, 250, 0.35)",
  };
}

type Point = { clientX: number; clientY: number };
interface MouseService {
  getCoords(ev: Point, el: HTMLElement, ...rest: unknown[]): unknown;
  getMouseReportCoords(ev: MouseEvent, el: HTMLElement): unknown;
}
interface SelectionService {
  _screenElement?: HTMLElement;
  _getMouseEventScrollAmount?(ev: MouseEvent): number;
}

/**
 * The Spatial Canvas draws this terminal inside `transform: scale(zoom)`, which xterm.js does
 * not account for: it measures the scaled rect but divides by unscaled cell sizes, so
 * selection, word select, links and app mouse reporting land rows/columns off at any zoom but
 * 100%. Every one of those goes through the terminal's single MouseService, so map the point
 * back into unscaled space there (see lib/scaledPointer). The right-click textarea (native
 * Copy/Paste menu, middle-click paste) is placed by a separate helper; re-place it after xterm.
 * ponytail: `_core._mouseService` is xterm 5.5 internals; if a later xterm renames it this
 * silently does nothing (docked terminals stay right). Re-check on xterm upgrades.
 */
function followCssScale(term: Terminal, el: HTMLElement): () => void {
  const core = (term as unknown as { _core?: { _mouseService?: MouseService; _selectionService?: SelectionService } })._core;
  const ms = core?._mouseService;
  if (ms?.getCoords && ms.getMouseReportCoords) {
    const getCoords = ms.getCoords.bind(ms);
    const report = ms.getMouseReportCoords.bind(ms);
    ms.getCoords = (ev, target, ...rest) => getCoords(unscaleForElement(ev, target), target, ...rest);
    ms.getMouseReportCoords = (ev, target) => report(unscaleForElement(ev, target) as MouseEvent, target);
  }
  // Drag-selecting past the top/bottom edge scrolls; that check measures the event itself.
  const ss = core?._selectionService;
  if (ss?._getMouseEventScrollAmount && ss._screenElement) {
    const amount = ss._getMouseEventScrollAmount.bind(ss);
    const screen = ss._screenElement;
    ss._getMouseEventScrollAmount = (ev) => amount(unscaleForElement(ev, screen) as MouseEvent);
  }
  const placeTextarea = (ev: MouseEvent) => {
    if (ev.type === "auxclick" && ev.button !== 1) return;
    const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
    const ta = term.textarea;
    if (!screen || !ta) return;
    const r = screen.getBoundingClientRect();
    const p = unscaleForElement(ev, screen);
    ta.style.left = `${p.clientX - r.left - 10}px`;
    ta.style.top = `${p.clientY - r.top - 10}px`;
  };
  el.addEventListener("contextmenu", placeTextarea);
  el.addEventListener("auxclick", placeTextarea);
  return () => {
    el.removeEventListener("contextmenu", placeTextarea);
    el.removeEventListener("auxclick", placeTextarea);
  };
}

/** One terminal tab: xterm.js drawing a real shell (see lib/ptySessions). */
export function XtermPane({
  session,
  active,
  onFocus,
}: {
  session: TerminalSession;
  active: boolean;
  onFocus: () => void;
}) {
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
    // file:line in compiler, test and traceback output opens in the editor
    const fileLinks = term.registerLinkProvider({
      provideLinks(y, done) {
        const text = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
        done(
          findFileLinks(text).map((l) => ({
            range: { start: { x: l.start + 1, y }, end: { x: l.end, y } },
            text: text.slice(l.start, l.end),
            decorations: { underline: true, pointerCursor: true },
            activate: () => {
              const path = resolveLinkPath(l.path, useFileStore.getState().root);
              openAt(path, l.line, l.column ?? 1).catch(() => useToastStore.getState().show(`Could not open ${l.path}`, "error"));
            },
          }))
        );
      },
    });
    term.open(el);
    const offScale = followCssScale(term, el);
    term.attachCustomWheelEventHandler((ev) => {
      const lines = scrollbackWheelLines(ev);
      if (lines === null) return true;
      term.scrollLines(lines);
      ev.preventDefault();
      return false;
    });
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
        if (term.hasSelection())
          void navigator.clipboard?.writeText(term.getSelection());
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
    void startFolder(session.cwd).then((cwd) => {
      if (!alive) return;
      // Fit again now the panel is laid out: a shell started at the mount-time size (a
      // ConPTY of 12x7) drew only into that corner, with no scrollback, until a resize.
      try {
        if (el.offsetWidth && el.offsetHeight) fit.fit();
      } catch {
        // disposed
      }
      void attach(
        session.id,
        { profile, cwd, cols: term.cols, rows: term.rows, psRemoteSigned: settings.terminalPsPolicy !== "system" },
        (data) => {
          term.write(data);
          noteLocalUrls(data.replace(ANSI, "")); // offer "localhost:5173" in the status bar
        },
        (code) =>
          term.write(
            `\r\n\x1b[2m[process exited${code === null ? "" : ` with code ${code}`}]\x1b[0m\r\n`,
          ),
      ).then((fn) => {
        if (alive) detach = fn;
        else fn();
      });
    });
    const input = term.onData((d) => void write(session.id, d));
    // Files dropped from the OS onto this terminal: type their quoted paths, like VS Code.
    let offDrop: (() => void) | undefined;
    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((ev) => {
          if (ev.payload.type !== "drop" || !ev.payload.paths.length) return;
          const r = el.getBoundingClientRect();
          const x = ev.payload.position.x / window.devicePixelRatio;
          const y = ev.payload.position.y / window.devicePixelRatio;
          if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
          void write(session.id, ev.payload.paths.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(" ") + " ");
          term.focus();
        })
      )
      .then((off) => (offDrop = off))
      .catch(() => {});

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
    const retheme = () =>
      window.setTimeout(() => (term.options.theme = themeFromCss()), 0);
    window.addEventListener("fahh-theme-change", retheme);

    return () => {
      alive = false;
      detach();
      input.dispose();
      ro.disconnect();
      window.removeEventListener("fahh-theme-change", retheme);
      terms.delete(session.id);
      fileLinks.dispose();
      offScale();
      offDrop?.();
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
    const term = termRef.current;
    if (!active || !term) return;
    term.focus();
    const el = ref.current;
    if (!el?.offsetWidth || !el.offsetHeight) return;
    try {
      fitRef.current?.fit();
      resize(session.id, term.cols, term.rows);
    } catch {
      // hidden
    }
  }, [active, session.id]);

  return (
    <div
      ref={ref}
      onMouseDown={onFocus}
      className="fahh-xterm h-full w-full min-h-0 min-w-0 pl-2 pt-1"
      data-session={session.id}
    />
  );
}
