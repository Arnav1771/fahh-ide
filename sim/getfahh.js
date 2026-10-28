// Download buttons: start the download for this system, then offer an optional free account
// (Fahh Cloud, Neon Auth). The download never waits on the account. Bump VER with each release.
const VER = "0.6.8";
const REL = `https://github.com/Arnav1771/fahh-ide/releases/download/v${VER}/`;
const AUTH = "https://ep-late-salad-b7hg67j3.neonauth.c-13.us-east-1.aws.neon.tech/neondb/auth";
const FILES = {
  windows: { file: `Fahh.Editor_${VER}_x64-setup.exe`, hint: "Windows may say “Windows protected your PC”: choose More info, then Run anyway. The installer is not code-signed yet." },
  mac: { file: `Fahh.Editor_${VER}_aarch64.dmg`, hint: `Apple silicon build. On an Intel Mac use <a href="${REL}Fahh.Editor_${VER}_x64.dmg">the Intel .dmg</a>. Open the .dmg and drag Fahh Editor to Applications.` },
  linux: { file: `Fahh.Editor_${VER}_amd64.AppImage`, hint: "Make it executable (chmod +x) and run it. Ubuntu needs libfuse2. Prefer a .deb or .rpm? See <a href='download.html#platforms'>all downloads</a>." },
};
const ua = navigator.userAgent;
const OS = /Windows/i.test(ua) ? "windows" : /Mac OS X|Macintosh/i.test(ua) && !/iPhone|iPad/i.test(ua) ? "mac" : /Linux/i.test(ua) && !/Android/i.test(ua) ? "linux" : null;

const dlg = document.createElement("dialog");
dlg.className = "getfahh";
dlg.setAttribute("aria-labelledby", "gf-title");
dlg.innerHTML = `
  <button type="button" class="gf-close" aria-label="Close" data-close>×</button>
  <h2 id="gf-title">Your download has started</h2>
  <p class="gf-file"></p>
  <p class="gf-hint"></p>
  <hr>
  <section class="gf-account" aria-labelledby="gf-acc-h">
    <h3 id="gf-acc-h">Create a free Fahh account <span>optional</span></h3>
    <p class="gf-lede">Sync your settings and theme between machines. Your code never leaves your computer, and Fahh works fully without an account.</p>
    <form class="gf-step" data-step="signup" novalidate>
      <label>Name<input name="name" autocomplete="name" required maxlength="80"></label>
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
      <label>Password<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <div class="gf-row"><button class="btn btn-primary btn-sm" type="submit">Create account</button><button class="btn btn-secondary btn-sm" type="button" data-close>No thanks</button></div>
    </form>
    <form class="gf-step" data-step="code" hidden novalidate>
      <p class="gf-lede">We emailed a 6-digit code to <strong class="gf-email"></strong>. It comes from StealthAI; check spam if you do not see it.</p>
      <label>Code<input name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
      <div class="gf-row"><button class="btn btn-primary btn-sm" type="submit">Confirm email</button><button class="btn btn-secondary btn-sm" type="button" data-resend>Send a new code</button><button class="btn btn-secondary btn-sm" type="button" data-close>Do it later</button></div>
    </form>
    <div class="gf-step" data-step="done" hidden>
      <p class="gf-done">Your account is ready.</p>
      <p class="gf-lede">In Fahh Editor open <strong>Settings › Account</strong> (Ctrl+,) and sign in. Upload settings there to sync them.</p>
      <div class="gf-row"><button class="btn btn-primary btn-sm" type="button" data-close>Done</button></div>
    </div>
    <p class="gf-msg" role="status" aria-live="polite"></p>
  </section>`;
document.body.append(dlg);

const $ = (s) => dlg.querySelector(s);
const msg = (text, bad = false) => { const m = $(".gf-msg"); m.textContent = text; m.classList.toggle("bad", bad); };
const step = (name) => dlg.querySelectorAll(".gf-step").forEach((el) => (el.hidden = el.dataset.step !== name));
let email = "";

async function auth(path, body) {
  const res = await fetch(AUTH + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Something went wrong (${res.status}). Try again.`);
  return data;
}
async function busy(form, work) {
  const btns = form.querySelectorAll("button");
  btns.forEach((b) => (b.disabled = true));
  try { await work(); } catch (e) { msg(e.message, true); } finally { btns.forEach((b) => (b.disabled = false)); }
}

$('[data-step="signup"]').addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  if (!f.reportValidity()) return;
  const d = Object.fromEntries(new FormData(f));
  busy(f, async () => {
    msg("Creating your account…");
    await auth("/sign-up/email", { name: d.name.trim(), email: d.email.trim(), password: d.password });
    email = d.email.trim();
    $(".gf-email").textContent = email;
    step("code"); msg("");
    $('[name="otp"]').focus();
  });
});
$('[data-step="code"]').addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  if (!f.reportValidity()) return;
  busy(f, async () => {
    await auth("/email-otp/verify-email", { email, otp: f.otp.value.trim() });
    step("done"); msg("");
  });
});
$("[data-resend]").addEventListener("click", (e) => busy(e.currentTarget.form, async () => {
  await auth("/email-otp/send-verification-otp", { email, type: "email-verification" });
  msg("A new code is on its way.");
}));
dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close]")) dlg.close(); });

function open(file, hint) {
  $(".gf-file").innerHTML = `<code>${file}</code> · Didn’t start? <a href="${REL}${file}">Download again</a>`;
  $(".gf-hint").innerHTML = hint;
  if ($('[data-step="done"]').hidden && $('[data-step="code"]').hidden) step("signup");
  msg("");
  dlg.showModal();
}

// "Download vX" buttons: download this system's installer and open the dialog; unknown systems keep the normal link.
document.querySelectorAll('a[href="#download"], #primary-dl').forEach((a) => a.addEventListener("click", (e) => {
  if (!OS) return;
  e.preventDefault();
  location.href = REL + FILES[OS].file;
  open(FILES[OS].file, FILES[OS].hint);
}));
// A specific installer link: let it download, then show the dialog.
document.querySelectorAll("a.dl-main, .dl a[href*='/releases/download/']").forEach((a) => a.addEventListener("click", () => {
  const file = a.href.split("/").pop();
  const os = /\.exe|\.msi/.test(file) ? "windows" : /\.dmg/.test(file) ? "mac" : "linux";
  setTimeout(() => open(file, FILES[os].hint), 300);
}));
