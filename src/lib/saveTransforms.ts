/** Text clean-ups applied when a file is saved (Settings > Editor). */
export interface SaveCleanups {
  trimTrailingWhitespace: boolean;
  insertFinalNewline: boolean;
}

/** The text to write: trailing spaces/tabs removed per line, and exactly one final newline. Line endings are kept. */
export function cleanText(text: string, o: SaveCleanups): string {
  let out = text;
  if (o.trimTrailingWhitespace) out = out.replace(/[ \t]+(?=\r?\n|$)/g, "");
  if (o.insertFinalNewline && out.length > 0) {
    const eol = out.includes("\r\n") ? "\r\n" : "\n";
    out = out.replace(/(\r?\n)+$/, "") + eol;
  }
  return out;
}
