import React from "react";
import {
  FolderOpen,
  Folder as FolderIcon,
  File,
  FileCode2,
  FileJson,
  FileText,
  Globe,
  Palette,
  Terminal,
  Database,
  Image,
  Music,
  Video,
  Archive,
  Lock,
  Settings,
  Shield,
  Layers,
  Cpu,
  GitBranch,
  Box,
  TestTube2,
  BookOpen,
  Atom,
  Flame,
} from "lucide-react";
import type { IconThemeId } from "../store/iconThemeStore";

export interface IconStyle {
  color: string;
  badge?: string;
}

// ─── Theme Color Palettes ───────────────────────────────────────────────────

function getThemeColors(theme: IconThemeId) {
  switch (theme) {
    case "catppuccin":
      return {
        ts: "#89b4fa",
        tsx: "#89dceb",
        js: "#f9e2af",
        rs: "#fab387",
        py: "#f38ba8",
        go: "#74c7ec",
        html: "#fab387",
        css: "#f5c2e7",
        json: "#f9e2af",
        md: "#cba6f7",
        yaml: "#a6adc8",
        docker: "#89b4fa",
        git: "#fab387",
        db: "#89b4fa",
        image: "#a6e3a1",
        pdf: "#f38ba8",
        shell: "#a6e3a1",
        archive: "#f9e2af",
        folder: "#fab387",
        folderOpen: "#f9e2af",
        default: "#bac2de",
      };
    case "seti":
      return {
        ts: "#519aba",
        tsx: "#519aba",
        js: "#cbcb41",
        rs: "#dea584",
        py: "#3572a5",
        go: "#519aba",
        html: "#e34c26",
        css: "#563d7c",
        json: "#cbcb41",
        md: "#dddddd",
        yaml: "#6d8086",
        docker: "#384d54",
        git: "#41535b",
        db: "#dad8d8",
        image: "#a074c4",
        pdf: "#cc3e44",
        shell: "#4d5a5e",
        archive: "#cc3e44",
        folder: "#d4a03c",
        folderOpen: "#e8b84e",
        default: "#8a8070",
      };
    case "minimal":
      return {
        ts: "#94a3b8",
        tsx: "#94a3b8",
        js: "#94a3b8",
        rs: "#94a3b8",
        py: "#94a3b8",
        go: "#94a3b8",
        html: "#94a3b8",
        css: "#94a3b8",
        json: "#94a3b8",
        md: "#94a3b8",
        yaml: "#94a3b8",
        docker: "#94a3b8",
        git: "#94a3b8",
        db: "#94a3b8",
        image: "#94a3b8",
        pdf: "#94a3b8",
        shell: "#94a3b8",
        archive: "#94a3b8",
        folder: "#94a3b8",
        folderOpen: "#cbd5e1",
        default: "#64748b",
      };
    case "material":
    default:
      return {
        ts: "#3178c6",
        tsx: "#00d8ff",
        js: "#f7df1e",
        rs: "#f74c00",
        py: "#3776ab",
        go: "#00add8",
        html: "#e34f26",
        css: "#264de4",
        json: "#facc15",
        md: "#a855f7",
        yaml: "#cbd5e1",
        docker: "#2496ed",
        git: "#f05032",
        db: "#38bdf8",
        image: "#4ade80",
        pdf: "#ef4444",
        shell: "#22c55e",
        archive: "#eab308",
        folder: "#eab308",
        folderOpen: "#facc15",
        default: "#a1a1aa",
      };
  }
}

// ─── Folder Icon Resolver ───────────────────────────────────────────────────

export function renderFolderIcon(
  name: string,
  expanded: boolean,
  theme: IconThemeId = "material"
): React.ReactNode {
  const colors = getThemeColors(theme);
  const lower = name.toLowerCase();

  // Special named folders
  if (lower === "src" || lower === "source") {
    return expanded ? (
      <FolderOpen size={14} style={{ color: colors.ts }} />
    ) : (
      <FolderIcon size={14} style={{ color: colors.ts }} />
    );
  }
  if (lower === "components" || lower === "views") {
    return (
      <Layers size={14} style={{ color: colors.tsx }} />
    );
  }
  if (lower === "node_modules") {
    return (
      <FolderIcon size={14} style={{ color: colors.default, opacity: 0.7 }} />
    );
  }
  if (lower === "tests" || lower === "__tests__" || lower === "test" || lower === "spec") {
    return (
      <TestTube2 size={14} style={{ color: colors.shell }} />
    );
  }
  if (lower === "docs" || lower === "documentation" || lower === "imp_docs" || lower === "wiki") {
    return (
      <BookOpen size={14} style={{ color: colors.md }} />
    );
  }
  if (lower === ".github" || lower === ".git") {
    return (
      <GitBranch size={14} style={{ color: colors.git }} />
    );
  }
  if (lower === "dist" || lower === "build" || lower === "out" || lower === "release") {
    return (
      <Box size={14} style={{ color: colors.archive }} />
    );
  }

  // Standard folder
  return expanded ? (
    <FolderOpen size={14} style={{ color: colors.folderOpen }} />
  ) : (
    <FolderIcon size={14} style={{ color: colors.folder }} />
  );
}

// ─── File Icon Resolver ─────────────────────────────────────────────────────

export function renderFileIcon(
  fileName: string,
  theme: IconThemeId = "material"
): React.ReactNode {
  const colors = getThemeColors(theme);
  const lower = fileName.toLowerCase();

  // 1. Exact Filename Matches
  switch (lower) {
    case "package.json":
      return <FileJson size={14} style={{ color: colors.js }} />;
    case "package-lock.json":
    case "pnpm-lock.yaml":
    case "yarn.lock":
    case "cargo.lock":
      return <Lock size={14} style={{ color: colors.archive }} />;
    case "cargo.toml":
      return <Flame size={14} style={{ color: colors.rs }} />;
    case "dockerfile":
    case "docker-compose.yml":
    case "docker-compose.yaml":
    case ".dockerignore":
      return <Box size={14} style={{ color: colors.docker }} />;
    case ".gitignore":
    case ".gitattributes":
    case ".gitmodules":
      return <GitBranch size={14} style={{ color: colors.git }} />;
    case "readme.md":
      return <BookOpen size={14} style={{ color: colors.md }} />;
    case "license":
    case "license.md":
      return <Shield size={14} style={{ color: colors.archive }} />;
    case "tsconfig.json":
    case "jsconfig.json":
      return <Settings size={14} style={{ color: colors.ts }} />;
    case "vite.config.ts":
    case "vite.config.js":
    case "tailwind.config.js":
    case "tailwind.config.ts":
    case "tauri.conf.json":
      return <Settings size={14} style={{ color: colors.tsx }} />;
  }

  // Dotfiles (.env, etc.)
  if (lower.startsWith(".env")) {
    return <Lock size={14} style={{ color: colors.js }} />;
  }

  // 2. Extension Matches
  const ext = lower.split(".").pop() ?? "";

  switch (ext) {
    // TypeScript & React
    case "ts":
      return <FileCode2 size={14} style={{ color: colors.ts }} />;
    case "tsx":
      return <Atom size={14} style={{ color: colors.tsx }} />;
    case "js":
    case "mjs":
    case "cjs":
      return <FileCode2 size={14} style={{ color: colors.js }} />;
    case "jsx":
      return <Atom size={14} style={{ color: colors.tsx }} />;

    // Rust
    case "rs":
      return <Flame size={14} style={{ color: colors.rs }} />;

    // Python
    case "py":
    case "pyw":
    case "ipynb":
      return <FileCode2 size={14} style={{ color: colors.py }} />;

    // Go
    case "go":
      return <FileCode2 size={14} style={{ color: colors.go }} />;

    // C / C++
    case "c":
    case "h":
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
      return <FileCode2 size={14} style={{ color: colors.ts }} />;

    // Web & Styles
    case "html":
    case "htm":
      return <Globe size={14} style={{ color: colors.html }} />;
    case "css":
    case "scss":
    case "sass":
    case "less":
      return <Palette size={14} style={{ color: colors.css }} />;

    // Data & Config
    case "json":
    case "json5":
      return <FileJson size={14} style={{ color: colors.json }} />;
    case "yaml":
    case "yml":
    case "toml":
    case "ini":
    case "conf":
      return <Settings size={14} style={{ color: colors.yaml }} />;

    // Documentation
    case "md":
    case "markdown":
    case "mdx":
      return <FileText size={14} style={{ color: colors.md }} />;
    case "pdf":
      return <FileText size={14} style={{ color: colors.pdf }} />;
    case "txt":
    case "log":
      return <FileText size={14} style={{ color: colors.default }} />;

    // Shell & Scripts
    case "sh":
    case "bash":
    case "zsh":
    case "ps1":
    case "cmd":
    case "bat":
      return <Terminal size={14} style={{ color: colors.shell }} />;

    // Databases
    case "sql":
    case "prisma":
    case "db":
    case "sqlite":
      return <Database size={14} style={{ color: colors.db }} />;

    // Media & Assets
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "ico":
    case "svg":
      return <Image size={14} style={{ color: colors.image }} />;
    case "mp3":
    case "wav":
    case "ogg":
    case "flac":
      return <Music size={14} style={{ color: colors.pdf }} />;
    case "mp4":
    case "webm":
    case "mov":
    case "mkv":
      return <Video size={14} style={{ color: colors.md }} />;

    // Archives
    case "zip":
    case "tar":
    case "gz":
    case "7z":
    case "rar":
    case "vsix":
      return <Archive size={14} style={{ color: colors.archive }} />;

    // Binaries & Systems
    case "exe":
    case "dll":
    case "so":
    case "dylib":
    case "wasm":
      return <Cpu size={14} style={{ color: colors.rs }} />;

    default:
      return <File size={14} style={{ color: colors.default }} />;
  }
}
