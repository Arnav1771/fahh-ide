# File Icon Themes & Open VSX Marketplace

Fahh Editor incorporates a native SVG file and folder icon theme engine alongside deep integration with the **Open VSX Registry**, the open-source extension and theme registry for modern editors.

---

## Built-in Icon Themes

Fahh Editor ships with 4 polished file icon themes out-of-the-box:

| Icon Theme | Style | Description |
|---|---|---|
| **Material Icon Theme** *(Default)* | Vibrant & Colorful | Modern Google Material design glyphs with tailored folder and language icons. |
| **Seti UI Icons** | Dark Technical | Classic dark developer aesthetic with high contrast language marks. |
| **Catppuccin Pastel** | Low Contrast Pastel | Calming, muted color palette designed to reduce visual strain during long coding sessions. |
| **Modern Minimal** | Monochrome Outlines | Sleek, clean stroke-based icon set for distraction-free code navigation. |

### Dynamic Folder & File Recognition
The icon engine automatically recognizes and styles special folders and config files:
- **Special Folders**: `src`, `components`, `node_modules`, `tests`, `docs`, `public`, `assets`, `dist`, `.git`, `.github`.
- **Special Config Files**: `package.json`, `Cargo.toml`, `tsconfig.json`, `Dockerfile`, `docker-compose.yml`, `.gitignore`, `.env`, `README.md`.

---

## Open VSX Extension Auto-Activation

When browsing the **Extensions panel** (Open VSX Store):
1. **Automatic Detection**: When you install any icon theme (such as *Material Icon Theme*, *vscode-icons*, or *Catppuccin Icons*), Fahh Editor immediately detects the pack.
2. **Instant Activation**: Fahh Editor applies the theme to your File Tree in real-time and displays a confirmation toast notification.
3. **Manual Theme Switching**: You can switch active icon themes at any time from the Themes panel (`File Icon Theme` dropdown).

---

## Extension Architecture Note

Open VSX packages (`.vsix`) are designed for Microsoft VS Code's proprietary Node.js extension host daemon. Fahh Editor is a lean Tauri 2 + Rust + Monaco desktop application (~15MB memory footprint vs. VS Code's 200MB+ Electron runtime). 

- **Fully Supported**: File icon themes, editor color themes (Monaco themes), and native previews.
- **Built-in Equivalents**: Capabilities like PDF viewing, Markdown preview, HTML preview, and CSV viewing are built directly into the core editor without requiring third-party extension runtimes.
