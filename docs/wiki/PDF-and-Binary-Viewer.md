# PDF and Binary Document Viewer

Fahh Editor provides out-of-the-box rendering for non-code assets directly within editor tabs, eliminating the need to leave the editor or install third-party VS Code marketplace extensions.

---

## Supported Formats

- **PDF Documents (`.pdf`)**: Native PDF viewer with pagination, zoom controls, fit-to-width, and text search.
- **Image Assets (`.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.ico`)**: High-resolution image canvas with dimensions and transparent checkerboard background.
- **Audio Files (`.mp3`, `.wav`, `.ogg`)**: Embedded audio player with waveform and playback timeline.
- **Video Files (`.mp4`, `.webm`)**: Direct video playback within editor tabs.

---

## How It Works

1. Clicking any `.pdf` or media asset in the File Explorer opens a new editor tab.
2. Fahh Editor detects the binary MIME type and routes to the appropriate viewer component (`PdfViewer` or `MediaPreviewPane`).
3. For PDFs, the document renders inside an isolated, hardware-accelerated viewport with zoom in/out, page jump, and download capabilities.
