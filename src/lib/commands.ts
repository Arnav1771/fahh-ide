/**
 * A tiny command bus. Components that are far from the app shell (the welcome
 * screen, the palette) ask for something by id; App.tsx owns what each id does.
 */

export const FAHH_COMMAND = "fahh-command";
/** Asked of the file tree, which owns the folder dialog. */
export const OPEN_FOLDER_EVENT = "fahh-open-folder";

export function runCommand(id: string): void {
  window.dispatchEvent(new CustomEvent<string>(FAHH_COMMAND, { detail: id }));
}
