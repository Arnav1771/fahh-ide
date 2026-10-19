# CATE Spatial Canvas Architecture

The **CATE (Code Architecture Topology Explorer) Spatial Canvas** transforms Fahh Editor from a traditional tabbed editor into an infinite two-dimensional whiteboard for codebase architecture.

---

## Features & Capabilities

### 1. Spatial Nodes
On the canvas, different facets of your workspace become interactive, floating nodes:
- **Editor Nodes**: Full-fledged Monaco code editor instances showing files in your repository.
- **REA AI Chat Nodes**: Embedded autonomous agent conversations with prompt inputs and context chips.
- **Terminal Nodes**: Interactive shell terminals running commands.
- **Browser Nodes**: Web viewports for testing dev servers (e.g. `localhost:5173`) live on the canvas.

### 2. High-Readability Engine
When canvas zooming scales elements down, text readability can degrade. Fahh Editor incorporates a dedicated Canvas Readability Engine:
- **Dynamic Font Stepper**: Adjustable in-node font size (`[- 17px +]`, range 12px to 28px).
- **Word Wrap Toggle**: One-click soft word wrapping on canvas nodes.
- **Minimap Toggle**: Minimize clutter and maximize readable code area by toggling off the 100px minimap on canvas editors.
- **1:1 Crisp Focus**: Instantly resets camera zoom to 1.0x and recenters smoothly onto the active editor node.
- **Subpixel Antialiasing**: Enforces `-webkit-font-smoothing: antialiased` and `text-rendering: optimizeLegibility`.
- **CATE Obsidian Monaco Theme**: Custom dark theme with boosted contrast (`#f8fafc` text, `#60a5fa` keywords, `#f6c177` strings).

---

## Keyboard & Mouse Controls

| Action | Control |
|---|---|
| **Pan Canvas** | Middle-click + drag, or Space + left-click drag |
| **Zoom In / Out** | Mouse wheel scroll, or `Ctrl +` / `Ctrl -` |
| **Focus 1:1 Crisp View** | Click `1:1 Focus` on editor, click `Focus Editor` in HUD, or press `Alt+1` / `Alt+F` |
| **Toggle Canvas Mode** | `Ctrl+Shift+C` or click the Spatial Canvas icon in the left Activity Bar |
