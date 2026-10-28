/**
 * DeepWiki: what a symbol is, where it is defined, its documentation and every place it is
 * used, from a whole-word workspace search. Language-agnostic: a definition is a line that
 * declares the name (def, class, fn, function, const x = …, a C signature, …).
 */
import type { SearchMatch } from "./types";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const KEYWORDS = "def|class|function\\*?|fn|struct|enum|trait|impl|interface|type|const|let|var|func|module|record|object|val|macro_rules!|namespace|protocol|extension";

/** Does this line declare `name` (rather than use it)? */
export function isDefinitionLine(line: string, name: string): boolean {
  const n = escape(name);
  const declared = new RegExp(
    `(?:^|[\\s(])(?:export\\s+)?(?:default\\s+)?(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?(?:static\\s+)?(?:abstract\\s+)?(?:${KEYWORDS})\\s+${n}\\b`
  );
  const assigned = new RegExp(`\\b${n}\\s*(?::[^=]*)?=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]*)?=>|[A-Za-z_$][\\w$]*\\s*=>)`);
  // `int add(int a, int b) {`, `std::string Foo::name() const` – a signature, not a call (no `;`).
  const cSignature = new RegExp(`^\\s*(?:[\\w:<>,*&\\[\\]]+\\s+)+[*&]*(?:\\w+::)*${n}\\s*\\([^;]*\\)\\s*(?:const\\s*)?(?:\\{\\s*)?$`);
  const cmdLike = /^\s*(?:return|if|while|for|switch|else|new|await|throw)\b/;
  return declared.test(line) || assigned.test(line) || (!cmdLike.test(line) && cSignature.test(line));
}

/** Split search hits for `name` into definitions and usages. */
export function classify(matches: SearchMatch[], name: string): { definitions: SearchMatch[]; usages: SearchMatch[] } {
  const definitions: SearchMatch[] = [];
  const usages: SearchMatch[] = [];
  for (const m of matches) (isDefinitionLine(m.line_text, name) ? definitions : usages).push(m);
  return { definitions, usages };
}

const COMMENT = /^\s*(?:\/\/\/?|#(?!include|define|\[)|--|;;?|\*|\/\*\*?|\*\/)/;

/**
 * The documentation of the definition on line `lineNumber` (1-based): the comment block right
 * above it, or a Python docstring right below it. "" when there is none.
 */
export function docFor(fileText: string, lineNumber: number): string {
  const lines = fileText.split(/\r?\n/);
  const idx = lineNumber - 1;
  const above: string[] = [];
  for (let i = idx - 1; i >= 0 && COMMENT.test(lines[i]) && above.length < 40; i--) above.unshift(lines[i]);
  // Decorators / attributes sit between a doc comment and the definition.
  if (!above.length) {
    let i = idx - 1;
    while (i >= 0 && /^\s*(?:@|#\[)/.test(lines[i])) i--;
    for (; i >= 0 && i < idx - 1 + 1 && COMMENT.test(lines[i]) && above.length < 40; i--) above.unshift(lines[i]);
  }
  if (above.length) {
    return above
      .map((l) => l.replace(/^\s*(?:\/\*\*?|\*\/|\/\/\/?|\*|#|--|;;?)\s?/, "").replace(/\s*\*\/\s*$/, ""))
      .join("\n")
      .trim();
  }
  const next = lines[idx + 1]?.trim() ?? "";
  const quote = next.startsWith('"""') ? '"""' : next.startsWith("'''") ? "'''" : null;
  if (!quote) return "";
  const body: string[] = [];
  const first = next.slice(3);
  if (first.includes(quote)) return first.slice(0, first.indexOf(quote)).trim();
  body.push(first);
  for (let i = idx + 2; i < lines.length && body.length < 60; i++) {
    const at = lines[i].indexOf(quote);
    if (at >= 0) {
      body.push(lines[i].slice(0, at));
      break;
    }
    body.push(lines[i]);
  }
  return body
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

/** The prompt "Explain with Fahh Local" sends (plan mode: read-only). */
export function explainPrompt(name: string, definition: SearchMatch | undefined, usageFiles: string[], root: string): string {
  const rel = (p: string) => (p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]/, "") : p);
  const where = definition ? ` It is defined in ${rel(definition.file)} at line ${definition.line_number}.` : "";
  const used = usageFiles.length ? ` It is used in: ${usageFiles.slice(0, 12).map(rel).join(", ")}${usageFiles.length > 12 ? ", …" : ""}.` : "";
  return (
    `Write a short wiki page for the symbol \`${name}\` in this codebase.${where}${used} ` +
    "Read the definition and the main call sites, then explain: what it is and what it is for, its inputs and outputs, " +
    "how the call sites use it, and anything surprising (side effects, error cases). Do not change any files."
  );
}
