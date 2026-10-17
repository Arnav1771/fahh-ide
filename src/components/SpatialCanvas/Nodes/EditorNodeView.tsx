import { TabBar } from "../../Editor/TabBar";
import { EditorPane } from "../../Editor/EditorPane";
import { Breadcrumbs } from "../../Breadcrumbs";

export function EditorNodeView() {
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#141311]">
      <TabBar />
      <Breadcrumbs />
      <div className="flex-1 min-h-0 relative">
        <EditorPane monacoTheme="cate-obsidian" />
      </div>
    </div>
  );
}
