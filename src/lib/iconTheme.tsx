import {
  FolderOpen,
  Folder,
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
  type LucideIcon,
} from "lucide-react";
import { useIconThemeStore, type IconThemeId } from "../store/iconThemeStore";
import { useThemeStore } from "../store/themeStore";
import { fileIconId, folderIconId } from "./fileIcons";

// Vendored material-icon-theme SVGs, served as URLs by Vite.
const SVG_URLS = import.meta.glob<string>("../assets/file-icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});
const svgUrl = (id: string) => SVG_URLS[`../assets/file-icons/${id}.svg`];

// ─── Lucide alternatives ("Fahh Colour" and "Minimal") ──────────────────────
// Same resolver as the Material set; the icon id picks a glyph and a colour.

type Tone = "ts" | "tsx" | "js" | "rs" | "py" | "go" | "html" | "css" | "json" | "md" | "yaml"
  | "docker" | "git" | "db" | "image" | "pdf" | "shell" | "archive" | "folder" | "folderOpen" | "default";

const COLOUR: Record<Tone, string> = {
  ts: "#3178c6", tsx: "#00d8ff", js: "#f7df1e", rs: "#f74c00", py: "#3776ab", go: "#00add8",
  html: "#e34f26", css: "#264de4", json: "#facc15", md: "#a855f7", yaml: "#94a3b8", docker: "#2496ed",
  git: "#f05032", db: "#38bdf8", image: "#4ade80", pdf: "#ef4444", shell: "#22c55e", archive: "#eab308",
  folder: "#eab308", folderOpen: "#facc15", default: "#a1a1aa",
};

const g = (glyph: LucideIcon, tone: Tone, ids: string) =>
  ids.split(" ").map((id) => [id, [glyph, tone]] as const);

const GLYPHS: Record<string, readonly [LucideIcon, Tone]> = Object.fromEntries([
  ...g(FileCode2, "ts", "typescript typescript-def c cpp h hpp"),
  ...g(TestTube2, "shell", "test-ts test-js test-jsx"),
  ...g(Atom, "tsx", "react react_ts"),
  ...g(FileCode2, "js", "javascript"),
  ...g(Flame, "rs", "rust java swift scala"),
  ...g(FileCode2, "rs", "ruby gemfile"),
  ...g(FileCode2, "py", "python python-misc jupyter"),
  ...g(FileCode2, "go", "go go-mod dart lua zig julia r haskell elixir prolog"),
  ...g(FileCode2, "md", "kotlin php csharp"),
  ...g(Globe, "html", "html vue svelte astro http"),
  ...g(Palette, "css", "css sass less postcss tailwindcss"),
  ...g(FileJson, "json", "json tsconfig jsconfig"),
  ...g(FileJson, "js", "nodejs npm"),
  ...g(Settings, "yaml",
    "yaml toml settings xml editorconfig eslint prettier vite vitest babel webpack tauri vercel deno maven gradle nix terraform proto"),
  ...g(BookOpen, "md", "readme changelog contributing"),
  ...g(FileText, "md", "markdown mdx"),
  ...g(FileText, "default", "document log word diff"),
  ...g(FileText, "pdf", "pdf"),
  ...g(Terminal, "shell", "console powershell makefile cmake"),
  ...g(Database, "db", "database prisma graphql table"),
  ...g(Image, "image", "image svg font"),
  ...g(Music, "pdf", "audio"),
  ...g(Video, "md", "video"),
  ...g(Archive, "archive", "zip"),
  ...g(Cpu, "rs", "exe dll webassembly"),
  ...g(Lock, "archive", "lock yarn pnpm bun poetry key"),
  ...g(Lock, "js", "tune"),
  ...g(Box, "docker", "docker"),
  ...g(GitBranch, "git", "git folder-git folder-github"),
  ...g(Shield, "archive", "license"),
  ...g(Layers, "tsx", "folder-components"),
  ...g(TestTube2, "shell", "folder-test"),
  ...g(BookOpen, "md", "folder-docs"),
  ...g(Box, "archive", "folder-dist folder-target"),
]);

function lucideIcon(id: string, folder: boolean, open: boolean, mono: boolean, size: number) {
  const base = id.replace(/-open$/, "");
  const fallback: readonly [LucideIcon, Tone] = folder
    ? [open ? FolderOpen : Folder, open ? "folderOpen" : "folder"]
    : [File, "default"];
  const [Glyph, tone] = GLYPHS[base] ?? fallback;
  const color = mono ? (folder && open ? "#cbd5e1" : "#94a3b8") : base === "folder-src" ? COLOUR.ts : COLOUR[tone];
  const opacity = base === "folder-node" ? 0.7 : undefined;
  return <Glyph size={size} style={{ color, opacity }} className="shrink-0" aria-hidden="true" />;
}

function render(id: string, folder: boolean, open: boolean, theme: IconThemeId, size: number) {
  if (theme === "material") {
    return <img src={svgUrl(id)} width={size} height={size} alt="" className="fahh-file-icon shrink-0" draggable={false} />;
  }
  return lucideIcon(id, folder, open, theme === "minimal", size);
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function renderFileIcon(fileName: string, theme: IconThemeId, opts: { language?: string; light?: boolean; size?: number } = {}) {
  return render(fileIconId(fileName, opts.language, opts.light && theme === "material"), false, false, theme, opts.size ?? 14);
}

export function renderFolderIcon(name: string, open: boolean, theme: IconThemeId, size = 14) {
  return render(folderIconId(name, open), true, open, theme, size);
}

function useIconContext() {
  const theme = useIconThemeStore((s) => s.activeIconTheme);
  const light = useThemeStore((s) => s.activeTheme === "fahh-light");
  return { theme, light };
}

/** File icon in the active icon theme; use this everywhere a file is listed. */
export function FileIcon({ name, language, size }: { name: string; language?: string; size?: number }) {
  const { theme, light } = useIconContext();
  return renderFileIcon(name, theme, { language, light, size });
}

export function FolderIcon({ name, open, size }: { name: string; open: boolean; size?: number }) {
  const { theme } = useIconContext();
  return renderFolderIcon(name, open, theme, size);
}
