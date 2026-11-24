/**
 * A tiny command bus. Components that are far from the app shell (the welcome
 * screen, the palette) ask for something by id; App.tsx owns what each id does.
 */

export const FAHH_COMMAND = "fahh-command";
/** Asked of the file tree, which owns the folder dialog. */
export const OPEN_FOLDER_EVENT = "fahh-open-folder";
export const OPEN_FILE_EVENT = "fahh-open-file";

export function runCommand(id: string): void {
  window.dispatchEvent(new CustomEvent<string>(FAHH_COMMAND, { detail: id }));
}

/** Ctrl+Shift+A opens the session search (App owns the palette). */
const SEARCH_EVENT = "fahh-search-sessions";
export const openSessionSearch = () => window.dispatchEvent(new Event(SEARCH_EVENT));
export const onSessionSearch = (fn: () => void) => {
  window.addEventListener(SEARCH_EVENT, fn);
  return () => window.removeEventListener(SEARCH_EVENT, fn);
};
