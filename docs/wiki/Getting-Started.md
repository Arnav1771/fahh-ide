# Getting Started

No account, no signup. Everything stays on your machine.

## The first-run tour

The first time Fahh Editor opens, a short tour sits over the real editor. It has five steps. Each one asks you to do one thing, and a tick appears on the step once you have. Every step has **Skip step**, and **Skip tour** closes the whole thing. Esc closes it too, Tab stays inside it, and Left / Right move between steps.

| Step | What you do | What happens |
|---|---|---|
| 1. Sound | **Ring the bell**, set the volume, mute. Keep the default fahh or **Change sound…** | The bell plays at the volume you set. A picked file (mp3, wav, ogg or m4a, up to 5 MB) is checked, copied into Fahh's data folder and previewed; from then on every fahh plays it. Files that are too big or not audio are refused with the reason. |
| 2. Code | **Open Folder…**, a folder from **Open Recent**, or **Open a .code-workspace…** | The folder opens behind the tour. On Windows, `\\wsl.localhost\<distro>\...` folders work: the terminal, git and Run go through WSL. Or break the one-line try-it box: a real JavaScript parser checks it, and the first break rings the fahh. |
| 3. Look | Pick **Fahh Gold**, **Fahh Dark** or **Fahh Light**; **Move Explorer to the right** | The app restyles behind the card as you click. Explorer really moves, and the same button puts it back. Drag any tab or view anywhere; **View > Reset Layout** restores the default. |
| 4. Fahh Local (optional) | Pick a provider, paste a key, **Test connection** | Fahh asks the provider for its model list and shows how many it found, or the provider's error. Ollama needs no key. The key stays in this machine's storage. |
| 5. Check Setup | Nothing: it runs as the step opens | Fahh looks for git, Python, Node, cargo, WSL (Windows) and the language servers it uses (rust-analyzer, typescript-language-server, pylsp or pyright). Found tools show their version; missing ones show a one-line install command. The step also has the **update check** switch. |

The tour shows once per user (the `fahh-onboarded` flag in the app's storage). **Help > Welcome**, or "Show Welcome" in the palette, opens it again.

## Check Setup

**Help > Check Setup…** or "Fahh: Check Setup" in the command palette (Ctrl+Shift+P). Every tool is optional: a missing one only switches off the feature that needs it (Run for that language, the language server's diagnostics, the git view). **Check again** reruns it after you install something.

## Updates

With **Settings > Updates > Check for updates at launch** on (the default), Fahh asks GitHub for the latest release at most once a day. When a newer one is out you get one small toast for that version, never a popup. **Help > About Fahh Editor > Check for updates** checks on demand and links the installer for your system. The tour's footer link, **Get update emails**, goes to the Stealth Keqing hub.

## Your own error sound

Settings > Fahh > **Error sound**, or step 1 of the tour:

- **Change sound…** opens the file picker (mp3, wav, ogg, m4a; up to 5 MB).
- **Default** and **Yours** preview each sound.
- **Reset to default** brings the fahh back.

It plays everywhere the fahh does: diagnostics, a failed Run, a terminal command that exits non-zero, and the bell. It follows the volume, the mute button and the effects setting. Fahh keeps its own copy (in `FAHH_DATA_DIR`, or the OS data folder under `fahh/sounds`), so moving or deleting the original changes nothing.
