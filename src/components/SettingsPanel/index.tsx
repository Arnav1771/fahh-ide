import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Bell, Search } from "lucide-react";
import { DEFAULT_SETTINGS, useSettingsStore, type Settings } from "../../store/settingsStore";
import { useEditorStore } from "../../store/editorStore";
import { useFahhStore } from "../../store/fahhStore";
import { SoundPicker } from "../Fahh/SoundPicker";
import { AccountSection } from "./AccountSection";
import { getProfiles } from "../../lib/ptySessions";
import type { TerminalProfile } from "../../lib/tauri";

function ProfileSelect() {
  const value = useSettingsStore((s) => s.terminalDefaultProfile);
  const set = useSettingsStore((s) => s.set);
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
  useEffect(() => {
    void getProfiles().then(setProfiles);
  }, []);
  return (
    <select
      id="set-term-profile"
      value={value}
      onChange={(e) => set("terminalDefaultProfile", e.target.value)}
      className="bg-fahh-surface rounded px-2 py-1 text-xs outline-none"
    >
      <option value="">{profiles[0] ? `Automatic (${profiles[0].name})` : "Automatic"}</option>
      {profiles.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

const input =
  "rounded border border-fahh-surface bg-fahh-sidebar px-2 py-1 text-xs text-fahh-text outline-none focus:border-fahh-accent";

/** The search query, and whether the enclosing section's title already matches it. */
const Filter = createContext({ q: "", sectionHit: true });
const matches = (q: string, ...text: (string | undefined)[]) => !q || text.join(" ").toLowerCase().includes(q);

function Row({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  const { q, sectionHit } = useContext(Filter);
  if (!sectionHit && !matches(q, label, hint)) return null;
  return (
    <div data-row className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-fahh-surface py-2.5">
      <label htmlFor={htmlFor} className="min-w-[10rem] flex-1">
        <div className="text-xs text-fahh-text">{label}</div>
        {hint && <div className="text-[11px] text-fahh-muted">{hint}</div>}
      </label>
      <div className="max-w-full">{children}</div>
    </div>
  );
}

function Toggle({ id, value, onChange }: { id: string; value: boolean; onChange: (v: boolean) => void }) {
  return <input id={id} type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--fahh-accent)]" />;
}

function NumberField<K extends keyof Settings>({ id, k, min, max }: { id: string; k: K; min: number; max: number }) {
  const value = useSettingsStore((s) => s[k]) as number;
  const set = useSettingsStore((s) => s.set);
  return (
    <input
      id={id}
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => e.target.value !== "" && set(k, Number(e.target.value) as Settings[K])}
      className={`${input} w-20`}
    />
  );
}

const SECTIONS = ["Account", "Editor", "Fahh", "Terminal", "Session", "Updates"] as const;
const sectionId = (title: string) => `settings-${title.toLowerCase()}`;

/** A group of rows. Hidden while searching when none of its rows match; `keywords` match the whole section. */
function Section({ title, keywords, children }: { title: string; keywords?: string; children: ReactNode }) {
  const { q } = useContext(Filter);
  const sectionHit = matches(q, title, keywords);
  // Rows filter themselves; a section that is not made of rows (Account) shows only on a title match.
  const plain = title === "Account";
  if (plain && !sectionHit) return null;
  return (
    <Filter.Provider value={{ q, sectionHit }}>
      <section id={sectionId(title)} className="mb-6 scroll-mt-4 [&:not(:has([data-row]))]:hidden">
        <h3 className="fahh-label mb-1 text-[10px] font-semibold uppercase tracking-widest text-fahh-muted">{title}</h3>
        {plain ? <div data-row>{children}</div> : children}
      </section>
    </Filter.Provider>
  );
}

/** Settings > Account from anywhere (the avatar menu, the palette). */
export function showAccountSettings(): void {
  window.setTimeout(() => document.getElementById(sectionId("Account"))?.scrollIntoView({ block: "start" }), 150);
}

/** View > Settings (Ctrl+,): every change applies at once and is saved. */
export function SettingsPanel() {
  const s = useSettingsStore();
  const autoSave = useEditorStore((st) => st.autoSave);
  const setAutoSave = useEditorStore((st) => st.setAutoSave);
  const lifetime = useFahhStore((st) => st.lifetime);
  const session = useFahhStore((st) => st.fahhCount);
  const ring = useFahhStore((st) => st.ringBell);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  return (
    <div className="h-full flex bg-fahh-bg select-text" data-testid="settings-panel">
      <nav aria-label="Settings sections" className="w-40 shrink-0 border-r border-fahh-surface px-2 py-5 max-[640px]:hidden">
        {SECTIONS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setQuery(""); window.setTimeout(() => document.getElementById(sectionId(t))?.scrollIntoView({ block: "start", behavior: "smooth" }), 0); }}
            className="block w-full rounded px-2 py-1 text-left text-xs text-fahh-muted hover:bg-fahh-surface hover:text-fahh-text"
          >
            {t}
          </button>
        ))}
      </nav>
      <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="settings-body mx-auto max-w-2xl px-6 py-5">
        <div className="mb-4 flex items-center gap-3">
          <h2 className="text-base font-semibold text-fahh-text">Settings</h2>
          <label className="ml-auto flex w-64 max-w-full items-center gap-1.5 rounded border border-fahh-surface bg-fahh-sidebar px-2 py-1 focus-within:border-fahh-accent">
            <Search size={12} className="shrink-0 text-fahh-muted" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder="Search settings"
              aria-label="Search settings"
              className="w-full bg-transparent text-xs text-fahh-text outline-none"
            />
          </label>
        </div>
        <p className="settings-empty hidden py-6 text-center text-xs text-fahh-muted">No settings match “{query}”.</p>

        <Filter.Provider value={{ q, sectionHit: false }}>
        <Section title="Account" keywords="sign in sign up login email password sync upload download newsletter profile">
          <AccountSection />
        </Section>

        <Section title="Editor" keywords="font code monaco">
          <Row label="Font family" hint="A CSS font list; the first one installed is used." htmlFor="set-font">
            <input id="set-font" value={s.fontFamily} onChange={(e) => s.set("fontFamily", e.target.value)} spellCheck={false} className={`${input} w-72 max-w-full font-mono`} />
          </Row>
          <Row label="Font size" htmlFor="set-size">
            <NumberField id="set-size" k="fontSize" min={8} max={40} />
          </Row>
          <Row label="Word wrap" hint="Alt+Z toggles it for the editor on screen." htmlFor="set-wrap">
            <Toggle id="set-wrap" value={s.wordWrap} onChange={(v) => s.set("wordWrap", v)} />
          </Row>
          <Row label="Minimap" htmlFor="set-minimap">
            <Toggle id="set-minimap" value={s.minimap} onChange={(v) => s.set("minimap", v)} />
          </Row>
          <Row label="Line numbers" htmlFor="set-lines">
            <Toggle id="set-lines" value={s.lineNumbers} onChange={(v) => s.set("lineNumbers", v)} />
          </Row>
          <Row label="Tab size" htmlFor="set-tab">
            <NumberField id="set-tab" k="tabSize" min={1} max={8} />
          </Row>
          <Row label="Insert spaces" hint="Off: Tab inserts a tab character." htmlFor="set-spaces">
            <Toggle id="set-spaces" value={s.insertSpaces} onChange={(v) => s.set("insertSpaces", v)} />
          </Row>
          <Row label="Auto save" hint="Saves a second after you stop typing, and when the window loses focus." htmlFor="set-autosave">
            <Toggle id="set-autosave" value={autoSave} onChange={setAutoSave} />
          </Row>
        </Section>

        <Section title="Fahh" keywords="sound audio volume bell error">
          <Row label="Volume" hint={s.fahhVolume === 0 ? "Silent." : undefined} htmlFor="set-volume">
            <div className="flex items-center gap-2">
              <input id="set-volume" type="range" min={0} max={100} value={s.fahhVolume} onChange={(e) => s.set("fahhVolume", Number(e.target.value))} className="w-40 accent-[var(--fahh-accent)]" />
              <span className="w-8 text-right text-xs tabular-nums text-fahh-text">{s.fahhVolume}</span>
              <button type="button" onClick={ring} title="Ring the bell" aria-label="Ring the bell to test the volume" className="rounded p-1 text-fahh-muted hover:bg-fahh-surface hover:text-fahh-text">
                <Bell size={13} aria-hidden="true" />
              </button>
            </div>
          </Row>
          <Row label="Error sound" hint="Plays for diagnostics, failed runs, failed terminal commands and the bell.">
            <SoundPicker />
          </Row>
          <Row label="Lifetime fahhs" hint="Every fahh this editor has ever let out.">
            <span className="text-xs tabular-nums text-fahh-text" data-testid="lifetime-fahhs">
              {lifetime} <span className="text-fahh-muted">({session} this session)</span>
            </span>
          </Row>
        </Section>

        <Section title="Terminal" keywords="shell powershell bash cmd wsl console">
          <Row label="Font size" htmlFor="set-term">
            <NumberField id="set-term" k="terminalFontSize" min={8} max={32} />
          </Row>
          <Row label="Default profile" hint="The shell a new terminal starts." htmlFor="set-term-profile">
            <ProfileSelect />
          </Row>
        </Section>

        <Section title="Session" keywords="restore reopen tabs startup">
          <Row label="Restore session on launch" hint="Reopen the last folder and its tabs, in their groups." htmlFor="set-restore">
            <Toggle id="set-restore" value={s.restoreSession} onChange={(v) => s.set("restoreSession", v)} />
          </Row>
        </Section>

        <Section title="Updates" keywords="version release">
          <Row label="Check for updates at launch" hint="Once a day; a small note when a new version is out, never a popup. Help > About checks now." htmlFor="set-updates">
            <Toggle id="set-updates" value={s.checkUpdatesOnLaunch} onChange={(v) => s.set("checkUpdatesOnLaunch", v)} />
          </Row>
        </Section>
        </Filter.Provider>

        <button
          type="button"
          onClick={() => s.reset()}
          disabled={(Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).every((k) => s[k] === DEFAULT_SETTINGS[k])}
          className="rounded bg-fahh-surface px-3 py-1 text-xs text-fahh-text hover:bg-fahh-surface/70 disabled:opacity-40"
        >
          Reset to defaults
        </button>
      </div>
      </div>
    </div>
  );
}
