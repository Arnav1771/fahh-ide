# Remote Explorer

Open it from the activity bar or the command palette (**View: Remote Explorer**). It lists three kinds of target, like VS Code's view.

---

| Section | Source | Actions |
|---|---|---|
| **WSL Targets** (Windows) | `wsl --list` | Open the distro's home folder, open a terminal in it |
| **SSH** | hosts in `~/.ssh/config` | Open a terminal running `ssh <host>` |
| **Dev Containers** | `docker ps` | Open a shell in the container (`docker exec -it`, bash if present, else sh) |

Sections whose tool is missing (no WSL, no Docker) say so instead of failing. Refresh re-reads the lists.

WSL folders open through `\wsl.localhost\<distro>\...`, so the Explorer, editor, search and git all work on them.
