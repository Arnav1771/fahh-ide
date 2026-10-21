import { FILE_ICON_MAP as M } from "./fileIconMap";

/**
 * The one file/folder icon resolver. Returns an icon id from the vendored
 * material-icon-theme subset (src/assets/file-icons/<id>.svg).
 *
 * Files: exact filename (case-insensitive) -> longest multi-dot extension
 * suffix ("d.ts" before "ts") -> language id -> default file.
 * Folders: name (open/closed) -> default folder.
 */
export function fileIconId(fileName: string, languageId?: string, light = false): string {
  const lower = fileName.toLowerCase();
  let id: string | undefined = M.fileNames[lower];
  if (!id) {
    // "app.test.tsx" tries "test.tsx", then "tsx"; then a known filename with a
    // suffix ("Dockerfile.dev" -> "dockerfile", ".env.local" -> ".env").
    const parts = lower.split(".");
    for (let i = 1; i < parts.length && !id; i++) id = M.fileExtensions[parts.slice(i).join(".")];
    for (let j = parts.length - 1; j > 0 && !id; j--) id = M.fileNames[parts.slice(0, j).join(".")];
  }
  id ??= (languageId && M.languageIds[languageId.toLowerCase()]) || M.file;
  return (light && M.light[id]) || id;
}

export function folderIconId(folderName: string, open: boolean): string {
  const lower = folderName.toLowerCase();
  return (open ? M.folderNamesOpen[lower] : M.folderNames[lower]) ?? (open ? M.folderOpen : M.folder);
}
