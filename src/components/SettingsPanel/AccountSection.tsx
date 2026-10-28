import { useEffect, useState } from "react";
import { CloudDownload, CloudUpload, LogOut, UserRound } from "lucide-react";
import { accountStatus, pullSettings, pushSettings, signIn, signOut, signUp, type AccountUser } from "../../lib/account";

const input =
  "rounded border border-fahh-surface bg-fahh-sidebar px-2 py-1 text-xs text-fahh-text outline-none focus:border-fahh-accent";
const button = "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs disabled:opacity-50";

/** Settings > Account: a Fahh account (Neon Auth) and settings sync across machines. */
export function AccountSection() {
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    void accountStatus()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setNote(null);
    try {
      const msg = await work();
      if (msg) setNote({ text: msg });
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setNote({ text, error: true });
      if (/sign in again/i.test(text)) setUser(null);
    } finally {
      setBusy(false);
    }
  };

  if (user === undefined) return <p className="py-2 text-xs text-fahh-muted">Checking your account…</p>;

  if (user) {
    return (
      <div className="flex flex-col gap-3 border-b border-fahh-surface py-3" data-testid="account-signed-in">
        <div className="flex items-center gap-2 text-xs">
          <UserRound size={14} className="text-fahh-accent" />
          <span className="text-fahh-text">{user.name || user.email}</span>
          {user.name && <span className="text-fahh-muted">{user.email}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={busy}
            className={`${button} bg-fahh-accent text-white`}
            onClick={() => void run(async () => { await pushSettings(); return "Uploaded this machine's settings and theme."; })}
          >
            <CloudUpload size={13} /> Upload settings
          </button>
          <button
            disabled={busy}
            className={`${button} bg-fahh-surface text-fahh-text`}
            onClick={() => void run(async () => ((await pullSettings()) ? "Applied your synced settings." : "Nothing synced yet: upload from a machine first."))}
          >
            <CloudDownload size={13} /> Download settings
          </button>
          <button
            disabled={busy}
            className={`${button} text-fahh-muted hover:text-fahh-text`}
            onClick={() => void run(async () => { await signOut(); setUser(null); return "Signed out."; })}
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
        {note && <p role={note.error ? "alert" : "status"} className={`text-[11px] ${note.error ? "text-fahh-error" : "text-fahh-muted"}`}>{note.text}</p>}
        <p className="text-[11px] text-fahh-muted">Synced: View &gt; Settings and the colour theme. API keys, folders and files never leave this machine.</p>
      </div>
    );
  }

  const submit = () =>
    void run(async () => {
      const u = mode === "up" ? await signUp(email, password, name) : await signIn(email, password);
      setUser(u);
      setPassword("");
      return mode === "up" ? "Account created. Upload your settings to sync them." : undefined;
    });

  return (
    <form
      className="flex flex-col gap-2 border-b border-fahh-surface py-3"
      data-testid="account-signed-out"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="text-[11px] text-fahh-muted">Sign in to sync your settings and theme between machines. Optional: Fahh works fully without an account.</p>
      {mode === "up" && <input aria-label="Name" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} className={input} />}
      <input aria-label="Email" type="email" required autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
      <input
        aria-label="Password"
        type="password"
        required
        minLength={8}
        autoComplete={mode === "up" ? "new-password" : "current-password"}
        placeholder="Password (8+ characters)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={input}
      />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={`${button} bg-fahh-accent text-white`}>
          {busy ? "…" : mode === "up" ? "Create account" : "Sign in"}
        </button>
        <button type="button" className="text-[11px] text-fahh-accent hover:underline" onClick={() => { setMode(mode === "in" ? "up" : "in"); setNote(null); }}>
          {mode === "in" ? "New here? Create an account" : "Have an account? Sign in"}
        </button>
      </div>
      {note && <p role={note.error ? "alert" : "status"} className={`text-[11px] ${note.error ? "text-fahh-error" : "text-fahh-muted"}`}>{note.text}</p>}
    </form>
  );
}
