// Download page: highlight this visitor's system and show terminal installs.
const REL = "https://github.com/Arnav1771/fahh-ide/releases/download/v0.3.0";
const CLI = {
  win: [
    "# PowerShell: download the installer and run it silently",
    `Invoke-WebRequest -Uri "${REL}/Fahh.Editor_0.3.0_x64-setup.exe" -OutFile fahh-setup.exe`,
    ".\\fahh-setup.exe /S",
  ],
  mac: [
    "# Apple silicon. For an Intel Mac use Fahh.Editor_0.3.0_x64.dmg",
    `curl -LO "${REL}/Fahh.Editor_0.3.0_aarch64.dmg"`,
    "hdiutil attach -nobrowse -mountpoint /tmp/fahh Fahh.Editor_0.3.0_aarch64.dmg",
    "cp -R /tmp/fahh/*.app /Applications/",
    "hdiutil detach /tmp/fahh",
  ],
  deb: [
    `curl -LO "${REL}/Fahh.Editor_0.3.0_amd64.deb"`,
    "sudo apt install ./Fahh.Editor_0.3.0_amd64.deb",
  ],
  rpm: [
    `curl -LO "${REL}/Fahh.Editor-0.3.0-1.x86_64.rpm"`,
    "sudo dnf install ./Fahh.Editor-0.3.0-1.x86_64.rpm",
  ],
  appimage: [
    `curl -LO "${REL}/Fahh.Editor_0.3.0_amd64.AppImage"`,
    "chmod +x Fahh.Editor_0.3.0_amd64.AppImage",
    "./Fahh.Editor_0.3.0_amd64.AppImage",
  ],
};

const code = document.getElementById("cli-code");
const tabs = [...document.querySelectorAll(".cli [role=tab]")];
function show(key) {
  tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.cli === key)));
  code.replaceChildren(...CLI[key].map((line, i) => {
    const span = document.createElement("span");
    if (line.startsWith("#")) span.className = "c";
    span.textContent = line + (i < CLI[key].length - 1 ? "\n" : "");
    return span;
  }));
}
tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.cli)));

document.getElementById("copy-cli").addEventListener("click", async () => {
  let msg = "Copied";
  try {
    await navigator.clipboard.writeText(code.textContent);
  } catch {
    msg = "Copy failed - select the text and copy it by hand";
  }
  const t = document.createElement("div");
  t.className = "toast";
  t.setAttribute("role", "status");
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 1800);
});

const ua = navigator.userAgent;
const os = /Windows/i.test(ua) ? "windows" : /Mac OS X|Macintosh/i.test(ua) && !/iPhone|iPad/.test(ua) ? "mac" : /Linux/i.test(ua) && !/Android/i.test(ua) ? "linux" : null;
const card = os && document.querySelector(`.dl[data-os="${os}"]`);
const primary = document.getElementById("primary-dl");
if (card) {
  card.classList.add("featured");
  const main = card.querySelector(".dl-main");
  primary.href = main.href;
  primary.textContent = `Download for ${card.querySelector("h3").textContent}`;
}
show(os === "mac" ? "mac" : os === "linux" ? "deb" : "win");
