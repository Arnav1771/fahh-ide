# Settings

Open Settings with **View > Settings**, **File > Settings**, **Ctrl+,** or the gear at the foot of the activity bar. It opens as a tab in the editor area, so you can drag it anywhere like any other view.

Every change applies at once (all open editors update without reopening) and is saved in the app's local storage, so it is there after a restart.

| Section | Setting | What it does |
|---|---|---|
| Editor | Font family | A CSS font list; the first font installed is used. |
| Editor | Font size | 8 to 40 px. |
| Editor | Word wrap | Wrap long lines. Alt+Z still toggles it for the editor on screen. |
| Editor | Minimap | The code overview at the right edge. |
| Editor | Line numbers | The gutter numbers. |
| Editor | Tab size | 1 to 8. |
| Editor | Insert spaces | Off: Tab inserts a tab character. |
| Editor | Auto save | Saves a second after you stop typing, and when the window loses focus (the same switch as File > Auto Save). |
| Fahh | Volume | 0 to 100. 0 is silent; the mute button in the status bar still works on top of it. The bell button plays a test fahh. |
| Fahh | Error sound | The default fahh or your own mp3, wav, ogg or m4a (up to 5 MB): Change sound…, preview either one, Reset to default. Fahh keeps a copy in its data folder (`FAHH_DATA_DIR`, or the OS data dir + `fahh/sounds`), so the original can move. It plays everywhere the fahh does, at the volume above, and mute silences it. |
| Fahh | Lifetime fahhs | How many fahhs this editor has ever let out (also in the status bar tooltip). |
| Terminal | Font size | 8 to 32 px. |
| Session | Restore session on launch | Reopen the last folder or workspace with its tabs back in their dock groups. A tab whose file is gone comes back as a Welcome placeholder. |
| Updates | Check for updates at launch | On by default. At most once a day; when a newer release is out you get one toast per version, never a popup. Help > About checks on demand. |

**Reset to defaults** puts everything back.

## Open Recent and session restore

**File > Open Recent** lists the last 10 folders and workspace files, newest first; **Clear Recently Opened** empties it. The palette has an "Open Recent: …" entry for each one.

At launch, a path passed on the command line (`fahh <folder>`) wins; otherwise, with Restore session on, the most recent entry reopens.

## Keyboard shortcuts added with Settings

| Shortcut | Does |
|---|---|
| `Ctrl+,` | Settings |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab in most-recently-used order (hold Ctrl and press Tab again to go further) |
| `Ctrl+Shift+T` | Reopen the last closed tab |
| `Ctrl+K Ctrl+W` | Close all tabs |
| `Alt+Left` / `Alt+Right` | Go back / forward (file switches, search and Problems jumps, go to definition) |
| Middle-click a tab | Close it (asks first when unsaved) |
| Right-click a tab | Close, Close Others, Close to the Right, Close All, Copy Path, Copy Relative Path, Reveal in File Explorer |

## Editor options (v0.7.0)

Settings > Editor also has:

| Setting | What it does |
|---|---|
| Relative line numbers | Numbers count from the cursor line |
| Sticky scroll | The enclosing function or class header stays at the top while you scroll (on by default) |
| Bracket pair colours and guides | Matching brackets share a colour and a guide line (on by default) |
| Font ligatures | `=>` `!=` `===` as one glyph when the font has them (on by default) |
| Add a cursor with | Alt or Ctrl + click adds another cursor |
| Format on save | Monaco's formatter for TS/JS/JSON/CSS/HTML; `black`, `rustfmt`, `gofmt` or `prettier` for others when installed. It formats what is in the editor, unsaved edits included |
| Trim trailing whitespace on save | Removes spaces and tabs at line ends |
| Insert final newline on save | Ends every saved file with exactly one newline (keeps CRLF files CRLF) |
| Zoom | The whole window, 50 to 200 %. **Ctrl+=** / **Ctrl+-** step by 10 %, **Ctrl+0** resets |

Each save action is one undo step.
