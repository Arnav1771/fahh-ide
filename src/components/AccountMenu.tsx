import { useEffect, useRef, useState } from "react";
import { CircleUserRound } from "lucide-react";
import { accountStatus, pullSettings, pushSettings, signOut, type AccountUser } from "../lib/account";
import { revealView } from "../lib/workbench";
import { useToastStore } from "../store/toastStore";
import { showAccountSettings } from "./SettingsPanel";

/** Activity bar avatar: who is signed in, sync, sign out; or a way to sign in. */
export function AccountMenu() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToastStore((s) => s.show);

  useEffect(() => {
    const load = () => void accountStatus().then(setUser).catch(() => setUser(null));
    load();
    window.addEventListener("fahh:account", load);
    return () => window.removeEventListener("fahh:account", load);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const settings = () => { setOpen(false); revealView("settings"); showAccountSettings(); };
  const act = (work: () => Promise<unknown>, done: string) => async () => {
    setOpen(false);
    try { await work(); toast(done); } catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); }
  };
  const initial = (user?.name || user?.email || "?").trim()[0]?.toUpperCase();
  const item = "block w-full px-3 py-1.5 text-left text-xs text-fahh-text hover:bg-fahh-surface";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={user ? `Account: ${user.email}` : "Account: sign in to sync settings"}
        aria-label="Account"
        aria-expanded={open}
        className="w-8 h-8 flex items-center justify-center rounded text-fahh-muted hover:text-fahh-text"
        data-testid="account-menu"
      >
        {user ? (
          <span className="w-5 h-5 rounded-full bg-fahh-accent text-fahh-bg text-[11px] font-semibold flex items-center justify-center">{initial}</span>
        ) : (
          <CircleUserRound size={18} />
        )}
      </button>
      {open && (
        <div role="menu" className="absolute left-full bottom-0 ml-1 z-50 w-56 rounded border border-fahh-surface bg-fahh-sidebar py-1 shadow-lg">
          {user ? (
            <>
              <div className="px-3 py-1.5 text-[11px] text-fahh-muted truncate">{user.name ? `${user.name} · ` : ""}{user.email}</div>
              <div className="my-1 border-t border-fahh-surface" />
              <button role="menuitem" className={item} onClick={act(pushSettings, "Settings uploaded")}>Upload settings</button>
              <button role="menuitem" className={item} onClick={act(async () => { if (!(await pullSettings())) throw new Error("Nothing uploaded yet: Upload settings first."); }, "Settings downloaded")}>Download settings</button>
              <button role="menuitem" className={item} onClick={settings}>Account settings</button>
              <div className="my-1 border-t border-fahh-surface" />
              <button role="menuitem" className={item} onClick={act(async () => { await signOut(); setUser(null); window.dispatchEvent(new Event("fahh:account")); }, "Signed out")}>Sign out</button>
            </>
          ) : (
            <>
              <div className="px-3 py-1.5 text-[11px] text-fahh-muted">Optional: sync your settings and theme between machines.</div>
              <button role="menuitem" className={item} onClick={settings}>Sign in or create an account</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
