import { useEditorStore } from "../../store/editorStore";

export function TabBar() {
  const { openTabs, activeTab, setActiveTab, closeFile } = useEditorStore();

  if (openTabs.length === 0) return null;

  return (
    <div className="flex items-center bg-fahh-sidebar border-b border-fahh-surface overflow-x-auto shrink-0 h-9">
      {openTabs.map((tab) => {
        const isActive = tab.path === activeTab;
        const fileName = tab.path.split(/[\\/]/).pop() ?? tab.path;
        return (
          <div
            key={tab.path}
            onClick={() => setActiveTab(tab.path)}
            className={`flex items-center gap-2 px-3 h-full text-sm cursor-pointer select-none whitespace-nowrap border-r border-fahh-surface transition-colors ${
              isActive
                ? "bg-fahh-bg text-fahh-text"
                : "text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface"
            }`}
          >
            <span className={tab.dirty ? "text-fahh-warn" : ""}>
              {tab.dirty ? "● " : ""}
              {fileName}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeFile(tab.path);
              }}
              className="ml-1 opacity-50 hover:opacity-100 text-xs leading-none"
              aria-label="Close tab"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
