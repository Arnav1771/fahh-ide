import { useEffect, useState } from "react";
import { CloudDownload, CloudUpload, LogOut, UserRound } from "lucide-react";
import {
  accountStatus,
  pullSettings,
  pushSettings,
  resetPassword,
  sendCode,
  setNewsletter,
  signIn,
  signOut,
  signUp,
  verifyEmail,
  type AccountUser,
  type AuthOutcome,
} from "../../lib/account";

const input =
  "rounded border border-fahh-surface bg-fahh-sidebar px-2 py-1 text-xs text-fahh-text outline-none focus:border-fahh-accent";
const button = "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs disabled:opacity-50";
const link = "text-[11px] text-fahh-accent hover:underline";

/** in: sign in · up: create account · code: confirm email · forgot: ask for a reset code · reset: new password */
type Mode = "in" | "up" | "code" | "forgot" | "reset";

/** Settings > Account: a Fahh account (Neon Auth) and settings sync across machines. */
export function AccountSection() {
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [newsletter, setNewsletterChoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    void accountStatus()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  const go = (m: Mode, text?: string) => {
    setMode(m);
    setCode("");
    setNote(text ? { text } : null);
  };

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

  /** Signed in: apply the newsletter choice made at sign-up (best effort). */
  const signedIn = async (u: AccountUser, fresh: boolean) => {
    setUser(u);
    setPassword("");
    setCode("");
    if (fresh && newsletter) await setNewsletter(true).catch(() => {});
    return fresh ? "Account ready. Upload your settings to sync them." : undefined;
  };

  const after = async (out: AuthOutcome, fresh: boolean) => {
    if (out.status === "signedIn") return signedIn(out.user, fresh);
    go("code");
    return `We emailed a 6-digit code to ${out.email}. Enter it to finish.`;
  };

  if (user === undefined) return <p className="py-2 text-xs text-fahh-muted">Checking your account…</p>;

  const status = note && (
    <p role={note.error ? "alert" : "status"} className={`text-[11px] ${note.error ? "text-fahh-error" : "text-fahh-muted"}`}>
      {note.text}
    </p>
  );

  if (user) {
    return (
      <div className="flex flex-col gap-3 border-b border-fahh-surface py-3" data-testid="account-signed-in">
        <div className="flex items-center gap-2 text-xs">
          <UserRound size={14} className="text-fahh-accent" />
          <span className="text-fahh-text">{user.name || user.email}</span>
          {user.name && <span className="text-fahh-muted">{user.email}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} className={`${button} bg-fahh-accent text-white`} onClick={() => void run(async () => { await pushSettings(); return "Uploaded this machine's settings and theme."; })}>
            <CloudUpload size={13} /> Upload settings
          </button>
          <button
            disabled={busy}
            className={`${button} bg-fahh-surface text-fahh-text`}
            onClick={() => void run(async () => ((await pullSettings()) ? "Applied your synced settings." : "Nothing synced yet: upload from a machine first."))}
          >
            <CloudDownload size={13} /> Download settings
          </button>
          <button disabled={busy} className={`${button} text-fahh-muted hover:text-fahh-text`} onClick={() => void run(async () => { await signOut(); setUser(null); go("in"); return "Signed out."; })}>
            <LogOut size={13} /> Sign out
          </button>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-fahh-muted">
          <input type="checkbox" className="accent-[var(--fahh-accent)]" onChange={(e) => void run(async () => { await setNewsletter(e.target.checked); return e.target.checked ? "Subscribed to the newsletter." : "Unsubscribed."; })} />
          Fahh newsletter: new releases and tips, now and then
        </label>
        {status}
        <p className="text-[11px] text-fahh-muted">Synced: View &gt; Settings and the colour theme. API keys, folders and files never leave this machine.</p>
      </div>
    );
  }

  const submit = () =>
    void run(async () => {
      switch (mode) {
        case "up":
          return after(await signUp(email, password, name), true);
        case "in":
          return after(await signIn(email, password), false);
        case "code":
          return signedIn(await verifyEmail(email, code), true);
        case "forgot":
          await sendCode(email, "forget-password");
          go("reset");
          return `If ${email} has an account, a 6-digit code is on its way.`;
        case "reset":
          await resetPassword(email, code, password);
          setPassword("");
          go("in", "Password changed. Sign in with the new one.");
          return "Password changed. Sign in with the new one.";
      }
    });

  const title = { in: "Sign in", up: "Create account", code: "Confirm email", forgot: "Send reset code", reset: "Set new password" }[mode];

  return (
    <form
      className="flex flex-col gap-2 border-b border-fahh-surface py-3"
      data-testid="account-signed-out"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {(mode === "in" || mode === "up") && (
        <p className="text-[11px] text-fahh-muted">Sign in to sync your settings and theme between machines. Optional: Fahh works fully without an account.</p>
      )}
      {mode === "up" && <input aria-label="Name" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} className={input} />}
      <input
        aria-label="Email"
        type="email"
        required
        autoComplete="email"
        placeholder="Email"
        value={email}
        readOnly={mode === "code" || mode === "reset"}
        onChange={(e) => setEmail(e.target.value)}
        className={input}
      />
      {(mode === "code" || mode === "reset") && (
        <input
          aria-label="Code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          pattern="\d{6}"
          maxLength={6}
          placeholder="6-digit code from the email"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className={`${input} tracking-[0.3em]`}
        />
      )}
      {(mode === "in" || mode === "up" || mode === "reset") && (
        <input
          aria-label={mode === "reset" ? "New password" : "Password"}
          type="password"
          required
          minLength={8}
          autoComplete={mode === "in" ? "current-password" : "new-password"}
          placeholder={mode === "reset" ? "New password (8+ characters)" : "Password (8+ characters)"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={input}
        />
      )}
      {mode === "up" && (
        <label className="flex items-center gap-2 text-[11px] text-fahh-muted">
          <input type="checkbox" checked={newsletter} onChange={(e) => setNewsletterChoice(e.target.checked)} className="accent-[var(--fahh-accent)]" />
          Send me the Fahh newsletter (new releases and tips; unsubscribe any time)
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={`${button} bg-fahh-accent text-white`}>
          {busy ? "…" : title}
        </button>
        {mode === "in" && (
          <>
            <button type="button" className={link} onClick={() => go("up")}>New here? Create an account</button>
            <button type="button" className={link} onClick={() => go("forgot")}>Forgot password?</button>
          </>
        )}
        {mode === "up" && <button type="button" className={link} onClick={() => go("in")}>Have an account? Sign in</button>}
        {mode === "code" && (
          <button type="button" className={link} onClick={() => void run(async () => { await sendCode(email, "email-verification"); return "Sent a new code."; })}>
            Resend code
          </button>
        )}
        {(mode === "code" || mode === "forgot" || mode === "reset") && <button type="button" className={link} onClick={() => go("in")}>Back to sign in</button>}
      </div>
      {status}
    </form>
  );
}
