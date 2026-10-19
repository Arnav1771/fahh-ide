# Global Workspace Search & Replace (`Ctrl+Shift+F`)

Fahh Editor includes a fast, native **Search & Replace Sidebar** that allows searching across every file in your open project, filtering by globs, reviewing match previews, and performing global replacements with full undo capability.

---

## Features

### 1. Primary Sidebar Search Tab
- Accessible directly from the Activity Bar via the **Search (`Search`) icon**.
- Quick shortcuts:
  - <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd>: Open Search and focus the search box.
  - <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>H</kbd>: Open Search with the Replace field expanded.
- Full desktop integration via **Edit** &rarr; **Find in Files** / **Replace in Files** and **View** &rarr; **Search across Files**.

---

### 2. Search Modifiers & RegEx Support
Three toggle buttons are built directly into the search bar:
- **`Aa` (Match Case)**: Case-sensitive search.
- **`\b` (Match Whole Word)**: Matches whole words only.
- **`.*` (Use Regular Expression)**: Full Rust-compatible regular expressions (e.g. `const\s+\w+\s*=`).

---

### 3. Scoped File Filtering (Include / Exclude Globs)
Click **Files to include/exclude** to filter searches to specific areas of the codebase:
- **`files to include`**: `src/**/*.tsx, *.rs`
- **`files to exclude`**: `*.test.ts, dist/**, *.lock`
- Automatically ignores standard build and metadata folders (`.git`, `node_modules`, `target`, `dist`, `.next`).

---

### 4. Interactive Match Tree & Instant Navigation
- Results are grouped by file with the active **File Icon Theme** (Material, Seti, Catppuccin, Minimal).
- Each file header displays a badge with the exact match count in that file.
- Match rows display the line number and the code snippet with the search term highlighted.
- **1-Click Navigation**: Clicking any match immediately opens the file in Monaco editor and smoothly reveals and centers that exact line.
- Collapse/expand individual files or click **Toggle Collapse All** (`ChevronsUpDown`) in the header.

---

### 5. Multi-File & Single-File Replace
- Type a replacement string into the **Replace** input.
- Click **Replace in File** (`Replace` icon on file row) to replace matches in that specific file.
- Click **Replace All** (`CheckCheck` icon) to execute atomic replacements across all matched files in the workspace.

---

### 6. Status Bar Cursor Tracking & Go To Line
- The bottom status bar now features an interactive **Cursor Position Pill**:
  `Ln 42, Col 15 (260 lines)`
- Click the pill at any time to open **Go to Line/Column** (<kbd>Ctrl</kbd> + <kbd>G</kbd>).
- Displays active document encoding (`UTF-8`) and language mode.

---

## Keyboard Shortcuts Summary

| Action | Shortcut |
|---|---|
| **Find in Files (Search)** | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd> |
| **Replace in Files** | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>H</kbd> |
| **Find in Active Editor** | <kbd>Ctrl</kbd> + <kbd>F</kbd> |
| **Replace in Active Editor** | <kbd>Ctrl</kbd> + <kbd>H</kbd> |
| **Go to Line / Column** | <kbd>Ctrl</kbd> + <kbd>G</kbd> (or click status bar Ln/Col) |
| **Toggle Primary Sidebar** | <kbd>Ctrl</kbd> + <kbd>B</kbd> |
