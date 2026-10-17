import { useEffect, useRef, useState } from "react";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { Columns2, Eye, Maximize2, Minimize2, SquareSplitHorizontal, X } from "lucide-react";
import { EditorPanel } from "../Editor/EditorPanel";
import { TitleScreen } from "../Fahh/TitleScreen";
import { ImpactLayer } from "../Fahh/ImpactLayer";
import { getView } from "../../lib/viewRegistry";
import { runCommand } from "../../lib/commands";
import { isPreviewOnly, previewKindFor } from "../../lib/preview";
import { useEditorStore } from "../../store/editorStore";
import { useFileStore } from "../../store/fileStore";
import { usePreviewStore } from "../../store/previewStore";
import {
  closeEditorGroup,
  closeEditorPanel,
  loadLayout,
  saveLayoutNow,
  scheduleSave,
  setDockApi,
  splitActiveEditor,
  syncEditors,
  toggleZone,
} from "../../lib/workbench";
import { EDITOR_PREFIX, HOME_PREFIX } from "../../lib/dockLayout";
import "../../views";

function ViewHost({ params }: IDockviewPanelProps<{ viewId: string }>) {
  const def = getView(params.viewId);
  if (!def) return null;
  const C = def.component;
  return (
    <div className={`fahh-sidebar flex h-full w-full flex-col overflow-hidden ${def.defaultLocation === "panel" ? "bg-fahh-bg" : "bg-fahh-sidebar"}`}>
      <C />
    </div>
  );
}

function HomePanel() {
  return (
    <div className="flex h-full w-full flex-col">
      <TitleScreen />
    </div>
  );
}

function HomeTab() {
  return <div className="dv-default-tab"><span className="dv-default-tab-content">Welcome</span></div>;
}

function ViewTab({ api }: IDockviewPanelHeaderProps) {
  return (
    <div className="dv-default-tab">
      <span className="dv-default-tab-content">{api.title}</span>
    </div>
  );
}

function EditorTab({ api, containerApi }: IDockviewPanelHeaderProps) {
  const path = (api.id.startsWith(EDITOR_PREFIX) ? api.id.slice(EDITOR_PREFIX.length) : "").replace(/#\d+$/, "");
  const dirty = useEditorStore((s) => !!s.openTabs.find((t) => t.path === path)?.dirty);
  const name = path.split(/[\\/]/).pop() ?? path;
  const close = () => {
    const p = containerApi.getPanel(api.id);
    if (p) closeEditorPanel(p);
  };
  return (
    <div
      className="dv-default-tab"
      title={path}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          close();
        }
      }}
    >
      <span className={`dv-default-tab-content ${dirty ? "text-fahh-warn" : ""}`}>
        {dirty ? "● " : ""}
        {name}
      </span>
      <button
        type="button"
        className="dv-default-tab-action"
        aria-label="Close tab"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Buttons at the right of every group's tab strip. */
function GroupActions({ group, activePanel, containerApi }: IDockviewHeaderActionsProps) {
  const isEditor = group.panels.some((p) => p.id.startsWith(EDITOR_PREFIX) || p.id.startsWith(HOME_PREFIX));
  const path = activePanel?.id.startsWith(EDITOR_PREFIX) ? (activePanel.params as { path?: string } | undefined)?.path : undefined;
  const mode = usePreviewStore((s) => (path ? s.modes[path] : undefined));
  const [, tick] = useState(0);
  useEffect(() => {
    const d = containerApi.onDidMaximizedGroupChange(() => tick((n) => n + 1));
    return () => d.dispose();
  }, [containerApi]);
  const maxed = group.api.isMaximized();
  const btn = "rounded p-1 text-fahh-muted hover:bg-fahh-surface hover:text-fahh-text";
  const showPreview = !!path && !!previewKindFor(path) && !isPreviewOnly(path);
  return (
    <div className="fahh-preview-actions flex h-full items-center gap-0.5 px-1">
      {isEditor && showPreview && (
        <>
          <button type="button" onClick={() => runCommand("preview.side")} title="Open Preview to the Side (Ctrl+K V)" aria-label="Open preview to the side" aria-pressed={mode === "side"} className={`${btn} ${mode === "side" ? "!text-fahh-accent" : ""}`}>
            <Columns2 size={15} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => runCommand("preview.toggle")} title="Open Preview (Ctrl+Shift+V)" aria-label="Open preview" aria-pressed={mode === "only"} className={`${btn} flex items-center gap-1 text-xs ${mode === "only" ? "!text-fahh-accent" : ""}`}>
            <Eye size={15} aria-hidden="true" /> {mode === "only" ? "Source" : "Preview"}
          </button>
        </>
      )}
      {isEditor && path && (
        <button type="button" onClick={() => { group.api.setActive(); splitActiveEditor(); }} title="Split Editor Right (Ctrl+\)" aria-label="Split editor right" className={btn}>
          <SquareSplitHorizontal size={15} aria-hidden="true" />
        </button>
      )}
      {!isEditor && (
        <button type="button" onClick={() => (maxed ? containerApi.exitMaximizedGroup() : group.api.maximize())} title={maxed ? "Restore panel size" : "Maximize panel"} aria-label={maxed ? "Restore panel size" : "Maximize panel"} className={btn}>
          {maxed ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
        </button>
      )}
      {isEditor && path && (
        <button type="button" onClick={() => closeEditorGroup(group)} title="Close Editor Group" aria-label="Close editor group" className={btn}>
          <X size={14} aria-hidden="true" />
        </button>
      )}
      {!isEditor && (
        <button type="button" onClick={() => group.panels.forEach((p) => p.api.close())} title="Close this group of views (reopen from the View menu in the palette)" aria-label="Close view group" className={btn}>
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

const components = { editor: EditorPanel, home: HomePanel, view: ViewHost };
const tabComponents = { editor: EditorTab, home: HomeTab, view: ViewTab };

/** The dock: editor groups in the middle, views in side bars and the bottom panel, all draggable. */
export function Workbench() {
  const ref = useRef<HTMLDivElement>(null);
  const root = useFileStore((s) => s.root);
  const rootRef = useRef(root);

  const onReady = (e: DockviewReadyEvent) => {
    const api = e.api;
    setDockApi(api);
    loadLayout(rootRef.current);
    api.onDidLayoutChange(scheduleSave);
    api.onDidActivePanelChange((ev) => {
      const p = ev.panel;
      const path = p?.id.startsWith(EDITOR_PREFIX) ? (p.params as { path?: string } | undefined)?.path : undefined;
      if (path && useEditorStore.getState().activeTab !== path) useEditorStore.getState().setActiveTab(path);
      window.dispatchEvent(new Event("fahh-dock-active"));
    });
  };

  // The dock follows the files the editor store has open.
  useEffect(() => {
    let key = "";
    return useEditorStore.subscribe((s) => {
      const k = s.openTabs.map((t) => t.path).join("\n") + "\n\u0000" + s.activeTab;
      if (k === key) return;
      key = k;
      syncEditors();
    });
  }, []);

  // Each workspace remembers its own layout; with none saved yet, the current one stays.
  useEffect(() => {
    if (rootRef.current === root) return;
    saveLayoutNow();
    rootRef.current = root;
    loadLayout(root, true);
  }, [root]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "\\" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        splitActiveEditor();
      } else if (k === "b" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        toggleZone(e.altKey ? "secondary" : "primary");
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pagehide", saveLayoutNow);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pagehide", saveLayoutNow);
    };
  }, []);

  return (
    <div ref={ref} className="fahh-dock relative min-h-0 min-w-0 flex-1">
      <DockviewReact
        className="dockview-theme-fahh"
        components={components}
        tabComponents={tabComponents}
        rightHeaderActionsComponent={GroupActions}
        dndStrategy="pointer"
        onReady={onReady}
      />
      <ImpactLayer targetRef={ref} />
    </div>
  );
}
