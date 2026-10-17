import { useEditorStore } from "../../store/editorStore";
import { previewKindFor } from "../../lib/preview";
import { PreviewPane } from "./PreviewPane";

/** The dockable Preview view: shows the file in the active editor, wherever you put it. */
export function PreviewView() {
  const path = useEditorStore((s) => s.activeTab);
  const content = useEditorStore((s) => (s.activeTab ? s.fileContents[s.activeTab] ?? "" : ""));
  const kind = path ? previewKindFor(path) : null;
  if (!path || !kind) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-fahh-muted">
        Open a Markdown, HTML, SVG, CSV or image file to preview it here.
      </div>
    );
  }
  return (
    <div className="flex h-full min-w-0 bg-fahh-bg">
      <PreviewPane path={path} content={content} kind={kind} />
    </div>
  );
}
