/**
 * Agent mode's start screen: what the open folder is (from its top-level file names) and
 * a few first prompts that fit it. Pure, so it runs under vitest.
 */

export interface Starters {
  /** "TypeScript + Vite", "Rust", or null when nothing is recognised. */
  stack: string | null;
  prompts: string[];
}

const has = (names: Set<string>, ...want: string[]) => want.some((w) => names.has(w));
const hasPrefix = (names: Set<string>, prefix: string) => [...names].some((n) => n.startsWith(prefix));

/** `names`: the workspace's top-level file and folder names. */
export function starterPrompts(names: string[]): Starters {
  const n = new Set(names.map((x) => x.toLowerCase()));

  if (has(n, "cargo.toml")) {
    return {
      stack: "Rust",
      prompts: [
        "Run cargo check and fix the first error it reports",
        "Find unwrap() and expect() calls that can panic on user input",
        "Add unit tests to the module in src/ that has the fewest",
        "Explain how the crates and modules in this project fit together",
      ],
    };
  }

  if (has(n, "package.json")) {
    const lang = has(n, "tsconfig.json") ? "TypeScript" : "JavaScript";
    const framework = hasPrefix(n, "next.config")
      ? "Next.js"
      : hasPrefix(n, "nuxt.config")
        ? "Nuxt"
        : hasPrefix(n, "svelte.config")
          ? "SvelteKit"
          : has(n, "angular.json")
            ? "Angular"
            : hasPrefix(n, "vite.config")
              ? "Vite"
              : null;
    const check = lang === "TypeScript" ? "Run the type checker and fix what it reports" : "Find code paths that can throw on undefined values";
    const special =
      framework === "Next.js"
        ? "List the API routes and check that each one validates its input"
        : framework === "Vite" || framework === "Nuxt" || framework === "SvelteKit"
          ? "Find components that re-render or refetch more than they need to"
          : "Find unused exports and dead code";
    return {
      stack: framework ? `${lang} + ${framework}` : lang,
      prompts: [check, "Add tests for the most important module that has none", special, "Explain the project structure and where to start reading"],
    };
  }

  if (has(n, "pyproject.toml", "requirements.txt", "setup.py", "pipfile")) {
    return {
      stack: "Python",
      prompts: [
        "Add type hints to the main module and fix what mypy reports",
        "Find exceptions that are caught and silently ignored",
        "Write pytest tests for the module that has none",
        "Explain how this project is organised and how to run it",
      ],
    };
  }

  if (has(n, "go.mod")) {
    return {
      stack: "Go",
      prompts: [
        "Run go vet and fix what it reports",
        "Find returned errors that are ignored",
        "Add table-driven tests for the package that has the fewest",
        "Explain the packages in this module and how they depend on each other",
      ],
    };
  }

  return {
    stack: null,
    prompts: [
      "Explain how this project is organised",
      "Find likely bugs in the files that changed most recently",
      "Write a README section on how to build and run this project",
      "Suggest three small refactors that would make this code easier to read",
    ],
  };
}

/** A plan's markdown as a checklist: "- [ ] x" / "- [x] x" lines, or null when it has none. */
export function planChecklist(markdown: string): { done: boolean; text: string }[] | null {
  const items = [...markdown.matchAll(/^\s*(?:[-*]|\d+\.)\s+\[( |x|X)\]\s+(.+)$/gm)].map((m) => ({ done: m[1] !== " ", text: m[2].trim() }));
  return items.length ? items : null;
}
