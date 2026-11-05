/**
 * Which language server serves which Monaco language. The key is what `lsp_start` gets
 * (one process per key, see `server_command` in lsp_client.rs).
 *
 * A *primary* server owns a language: while it is up, Monaco's own TS/CSS/HTML/JSON
 * workers stand down for that language so suggestions are never doubled. *Extra*
 * servers (ESLint, Ruff, Tailwind) only add diagnostics, quick fixes and class names
 * beside the primary one, and start only when their binary is installed.
 */

const PRIMARY: Record<string, string> = {
  typescript: "typescript",
  javascript: "typescript",
  python: "python",
  rust: "rust",
  go: "go",
  c: "cpp",
  cpp: "cpp",
  java: "java",
  json: "json",
  html: "html",
  css: "css",
  scss: "css",
  less: "css",
  yaml: "yaml",
  shell: "bash",
  lua: "lua",
  ruby: "ruby",
  csharp: "csharp",
  dart: "dart",
  kotlin: "kotlin",
};

export type ExtraServer = "eslint" | "ruff" | "tailwind";

/** Extra servers and the Monaco languages they attach to. */
export const EXTRA_LANGUAGES: Record<ExtraServer, readonly string[]> = {
  eslint: ["javascript", "typescript"],
  ruff: ["python"],
  tailwind: ["html", "css", "scss", "less", "javascript", "typescript"],
};

export const primaryServerFor = (language: string | null | undefined): string | null =>
  (language && PRIMARY[language.toLowerCase()]) || null;

/** Monaco languages a server key serves. */
export function languagesOf(server: string): string[] {
  if (server in EXTRA_LANGUAGES) return [...EXTRA_LANGUAGES[server as ExtraServer]];
  return Object.entries(PRIMARY).filter(([, s]) => s === server).map(([l]) => l);
}

export const isExtraServer = (server: string): server is ExtraServer => server in EXTRA_LANGUAGES;

/** Extra servers worth starting for a language, given what the workspace uses. */
export function extraServersFor(language: string, project: { eslint: boolean; tailwind: boolean }): ExtraServer[] {
  const out: ExtraServer[] = [];
  for (const [server, langs] of Object.entries(EXTRA_LANGUAGES) as [ExtraServer, readonly string[]][]) {
    if (!langs.includes(language)) continue;
    if (server === "eslint" && !project.eslint) continue;
    if (server === "tailwind" && !project.tailwind) continue;
    out.push(server);
  }
  return out;
}

/** Does the workspace use ESLint / Tailwind? From the root's file names and package.json text. */
export function detectProjectTools(rootFiles: string[], packageJson: string | null): { eslint: boolean; tailwind: boolean } {
  const has = (re: RegExp) => rootFiles.some((f) => re.test(f));
  const pkg = packageJson ?? "";
  return {
    eslint: has(/^(eslint\.config\.(js|mjs|cjs|ts|mts|cts)|\.eslintrc(\.(js|cjs|json|ya?ml))?)$/) || /"eslint"\s*:/.test(pkg),
    tailwind: has(/^tailwind\.config\.(js|cjs|mjs|ts)$/) || /"(tailwindcss|@tailwindcss\/[\w-]+)"\s*:/.test(pkg),
  };
}

/** The LSP `languageId` for a file (Monaco calls .tsx "typescript"; servers want "typescriptreact"). */
export function lspLanguageId(path: string, monacoLanguage: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "tsx") return "typescriptreact";
  if (ext === "jsx") return "javascriptreact";
  if (monacoLanguage === "shell") return "shellscript";
  return monacoLanguage;
}

/** Answer to `workspace/configuration` for one item. */
export function configurationFor(server: string, section: string | undefined, workspaceUri: string): unknown {
  if (server === "eslint") {
    // vscode-eslint-language-server reads its whole settings object (section "") per file.
    return {
      validate: "on",
      packageManager: "npm",
      useESLintClass: false,
      experimental: {},
      codeAction: {
        disableRuleComment: { enable: true, location: "separateLine" },
        showDocumentation: { enable: false },
      },
      codeActionOnSave: { enable: false, mode: "all" },
      format: false,
      quiet: false,
      onIgnoredFiles: "off",
      options: {},
      rulesCustomizations: [],
      run: "onType",
      problems: { shortenToSingleLine: false },
      nodePath: null,
      workingDirectory: { mode: "auto" },
      workspaceFolder: { uri: workspaceUri, name: workspaceUri.split("/").pop() || "workspace" },
    };
  }
  void section;
  return {};
}

/** Install line shown when a server is missing (mirrors Check Setup). */
export const INSTALL_HINT: Record<string, string> = {
  typescript: "npm install -g typescript-language-server typescript",
  python: "npm install -g pyright (or pip install python-lsp-server)",
  rust: "rustup component add rust-analyzer",
  eslint: "npm install -g vscode-langservers-extracted",
  ruff: "pip install ruff (0.4.5 or newer)",
  tailwind: "npm install -g @tailwindcss/language-server",
  html: "npm install -g vscode-langservers-extracted",
  css: "npm install -g vscode-langservers-extracted",
  json: "npm install -g vscode-langservers-extracted",
  yaml: "npm install -g yaml-language-server",
};
