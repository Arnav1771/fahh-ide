import { FileTree } from "../../FileTree/FileTree";

export function FilesNodeView() {
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-fahh-sidebar h-full w-full">
      <FileTree />
    </div>
  );
}
