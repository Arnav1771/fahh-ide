# Linux Environment TODOs & Fixes (v0.3.0)

Based on the recent Canary testing and native AppImage execution on this Linux (Arch) environment, the following issues have been documented and addressed:

## ~~1. Native AppImage crashes on missing GStreamer dependencies~~
- **Status**: FIXED natively by installing the libraries on the system.
- **Note**: The user must have `webkit2gtk-4.1` and `gst-plugins-good` installed for the editor to run and play audio.

- [x] **New File Bug**
  - **Issue:** Clicking "new file" a second time does not work.
  - **Status:** Fixed. Ensured the state resets and added root directory input logic in `FileTree.tsx`.

- [x] **HTML Viewer Preview**
  - **Issue:** Request for an HTML viewer icon to preview HTML code.
  - **Status:** Implemented an iframe-based preview toggle in the `EditorPane` specifically for HTML files.

- [x] **Website Updates (IMP DOCS and Release pages)**
  - **Issue:** Showcase `fahh.mp3` on the website and docs.
  - **Status:** Copied `fahh.mp3` to `docs/` and integrated it with the Web Audio API in `index.html` and `play.html`. Removed old joke references.

- [x] **Final QA & UI Check**
  - **Issue:** Check overall application surface and icons.
  - **Status:** Verified `lucide-react` is correctly installed, tested the UI running natively via `npx pnpm tauri dev`, and captured a screenshot into the `linux v.02/` directory for verification.

## ~~2. Right-Click Context Menu missing "Open" feature~~
- **Status**: FIXED. Wired up in `FileTree.tsx`.

## ~~3. Terminal PTY Streaming (Phase 2)~~
- **Status**: PARTIALLY FIXED. The terminal now streams output live using standard pipes instead of batch-mode, though full interactive PTY (like for vim/nano) is still pending for v0.4.0.

## ~~4. Audio SFX Placeholder~~
- **Status**: FIXED. The actual `fahh.mp3` has been added, and the Tauri resource config and audio loader have been updated.

## ~~5. Code Runner execution bug~~
- **Status**: FIXED. Renamed `file_path` to `path` in `runner.rs` to correctly match the frontend payload and prevent the missing args error.

## ~~6. UI Icons and Aesthetics~~
- **Status**: FIXED. Replaced ugly string emojis throughout the app (`App.tsx`, `FileTree.tsx`, `RunPanel`) with professional `lucide-react` SVG icons.

## ~~7. Terminal Tab Auto-completion~~
- **Status**: FIXED. Added a Quality of Life shortcut so pressing `Tab` in the terminal auto-completes the file name based on the workspace directory.

## ~~8. Website Download Button~~
- **Status**: FIXED. The `docs.html` navbar now correctly points to the `download.html` page instead of directly to the broken GitHub releases URL.

## Pending items for future releases:
- Real interactive PTY support.
- File System Permissions on Linux (Update `INSTALLATION.md` to recommend `npx pnpm`).
