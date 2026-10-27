import { useEffect, useRef, useState } from "react";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { Columns2, Eye, Globe, Maximize2, Minimize2, SquareSplitHorizontal, X } from "lucide-react";
import { EditorPane } from "../Editor/EditorPane";
import { Breadcrumbs } from "../Breadcrumbs";
import { TitleScreen } from "../Fahh/TitleScreen";
import { ImpactLayer } from "../Fahh/ImpactLayer";
import { THEME_DEFINITIONS } from "../ThemePanel";
import { getView, listViews } from "../../lib/viewRegistry";
import { matchesKeys } from "../../lib/hotkeys";
import { runCommand } from "../../lib/commands";
import { isPreviewOnly, previewKindFor } from "../../lib/preview";
import { openBrowser } from "../../lib/browser";
import { FileIcon } from "../../lib/iconTheme";
import { useEditorStore } from "../../store/editorStore";
import { useFileStore } from "../../store/fileStore";
import { useThemeStore } from "../../store/themeStore";
import { modeOf, usePreviewStore } from "../../store/previewStore";
import { ContextMenu, type MenuEntry } from "../ContextMenu";
import { revealPath } from "../../lib/tauri";
import { useToastStore } from "../../store/toastStore";
import { ErrorBoundary } from "../ErrorBoundary";
import {
  closeEditorGroup,
  closeEditorPanel,
  closeEditorsToRight,
  closeOtherEditors,
  getDockApi,
  loadLayout,
  saveLayoutNow,
  scheduleSave,
  revealView,
  setDockApi,
  splitActiveEditor,
  syncEditors,
  toggleZone,
} from "../../lib/workbench";
import { EDITOR_PREFIX, HOME_PREFIX } from "../../lib/dockLayout";
import "../../views";

/** Views whose shortcut App.tsx handles itself (it needs to know where focus is). */
const APP_OWNED_KEYS = new Set(["agent", "settings"]);

const announce = () => window.dispatchEvent(new Event("fahh-dock-active"));

function ViewHost({ params }: IDockviewPanelProps<{ viewId: string }>) {
  const def = getView(params.viewId);
  if (!def) return null;
  const C = def.component;
  return (
    <div className={`fahh-sidebar flex h-full w-full flex-col overflow-hidden ${def.defaultLocation === "panel" ? "bg-fahh-bg" : "bg-fahh-sidebar"}`}>
      <ErrorBoundary label={def.title ?? params.viewId}>
        <C />
      </ErrorBoundary>
    </div>
  );
}

function EditorPanel({ api, params }: IDockviewPanelProps<{ path: string }>) {
  const activeTheme = useThemeStore((s) => s.activeTheme);
  const monacoTheme = THEME_DEFINITIONS.find((d) => d.id === activeTheme)?.monacoTheme ?? "vs-dark";
  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      <ErrorBoundary label={`Editor (${params.path.split(/[\\/]/).pop()})`}>
        <Breadcrumbs path={params.path} />
        <EditorPane path={params.path} dock={api} monacoTheme={monacoTheme} />
      </ErrorBoundary>
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

/** A view's tab: its icon, then its name (narrow side groups show only the active tab's name; the tooltip has it always). */
function ViewTab({ api, params }: IDockviewPanelHeaderProps<{ viewId: string }>) {
  const def = getView(params.viewId);
  const Badge = def?.badge;
  const Icon = def?.icon;
  return (
    <div className="dv-default-tab fahh-view-tab" title={api.title}>
      {Icon && (
        <span className="flex shrink-0" aria-hidden="true">
          <Icon size={14} />
        </span>
      )}
      <span className="dv-default-tab-content fahh-view-tab-label">{api.title}</span>
      {Badge && <Badge />}
    </div>
  );
}

function EditorTab({ api, containerApi, params }: IDockviewPanelHeaderProps<{ path: string }>) {
  const path = params.path;
  const tab = useEditorStore((s) => s.openTabs.find((t) => t.path === path));
  const root = useFileStore((s) => s.root);
  const name = path.split(/[\\/]/).pop() ?? path;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const panel = () => containerApi.getPanel(api.id);
  const run = (fn: (p: NonNullable<ReturnType<typeof panel>>) => unknown) => () => {
    const p = panel();
    if (p) void fn(p);
  };
  const close = run(closeEditorPanel);
  const items: MenuEntry[] = [
    { label: "Close", keys: "Ctrl+W", action: close },
    { label: "Close Others", action: run(closeOtherEditors) },
    { label: "Close to the Right", action: run(closeEditorsToRight) },
    { label: "Close All", action: run((p) => closeEditorGroup(p.group)) },
    "separator",
    { label: "Copy Path", action: () => void navigator.clipboard.writeText(path).catch(() => {}) },
    {
      label: "Copy Relative Path",
      disabled: !root || !path.startsWith(root),
      action: () => void navigator.clipboard.writeText(path.slice((root ?? "").length).replace(/^[\\/]/, "")).catch(() => {}),
    },
    {
      label: "Reveal in File Explorer",
      disabled: !/[\\/]/.test(path),
      action: () => revealPath(path).catch((e) => useToastStore.getState().show(String(e), "error")),
    },
  ];
  return (
    <div
      className="dv-default-tab"
      title={path}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault(); // no autoscroll cursor
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          close();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
      <FileIcon name={name} language={tab?.language} />
      <span className={`dv-default-tab-content ${tab?.dirty ? "text-fahh-warn" : ""}`}>
        {tab?.dirty ? "● " : ""}
        {name}
      </span>
      <button
        type="button"
        className="dv-default-tab-action"
        aria-label={`Close ${name}`}
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
  const mode = usePreviewStore((s) => (path ? modeOf(s.modes, path) : undefined));
  const localUrl = usePreviewStore((s) => s.localUrl);
  const [, tick] = useState(0);
  useEffect(() => {
    const d = containerApi.onDidMaximizedGroupChange(() => tick((n) => n + 1));
    return () => d.dispose();
  }, [containerApi]);
  const maxed = group.api.isMaximized();
  const btn = "rounded p-1 text-fahh-muted hover:bg-fahh-surface hover:text-fahh-text";
  const on = "rounded p-1 bg-fahh-accent/15 text-fahh-accent";
  const showPreview = !!path && !!previewKindFor(path) && !isPreviewOnly(path);
  // The preview commands act on the active file: make this group's file the active one first.
  const preview = (id: string) => {
    if (activePanel) activePanel.api.setActive();
    runCommand(id);
  };
  return (
    <div className="fahh-preview-actions flex h-full items-center gap-0.5 px-1">
      {isEditor && showPreview && (
        <>
          <button type="button" onClick={() => preview("preview.side")} title="Split Preview: open the preview to the side (Ctrl+K V)" aria-label="Open preview to the side" aria-pressed={mode === "side"} className={mode === "side" ? on : btn}>
            <Columns2 size={15} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => preview("preview.toggle")} title={mode === "only" ? "Show Code (Ctrl+Shift+V)" : "Full Preview in place (Ctrl+Shift+V)"} aria-label="Open preview" aria-pressed={mode === "only"} className={mode === "only" ? on : btn}>
            <Eye size={15} aria-hidden="true" />
          </button>
        </>
      )}
      {isEditor && path && !showPreview && (
        <button type="button" onClick={() => openBrowser(localUrl || "http://localhost:5173")} title="UI Preview: open the web app in the built-in browser" aria-label="Open UI Preview" className={btn}>
          <Globe size={15} aria-hidden="true" />
        </button>
      )}
      {isEditor && path && (
        <button type="button" onClick={() => { activePanel?.api.setActive(); splitActiveEditor(); }} title="Split Editor Right (Ctrl+\)" aria-label="Split editor right" className={btn}>
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
        <button type="button" onClick={() => group.panels.forEach((p) => p.api.close())} title="Close these views (reopen them from the activity bar or the palette)" aria-label="Close view group" className={btn}>
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
    api.onDidLayoutChange(() => {
      scheduleSave();
      announce();
    });
    api.onDidActivePanelChange((ev) => {
      const p = ev.panel;
      const path = p?.id.startsWith(EDITOR_PREFIX) ? (p.params as { path?: string } | undefined)?.path : undefined;
      if (path && useEditorStore.getState().activeTab !== path) useEditorStore.getState().setActiveTab(path);
      announce();
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
      // Ctrl+Shift+E / F / G / X / D: the shortcuts each view advertises (App owns Ctrl+L and Ctrl+,).
      const view = listViews().find((v) => v.keys && !APP_OWNED_KEYS.has(v.id) && matchesKeys(e, v.keys));
      if (view) {
        e.preventDefault();
        e.stopPropagation();
        revealView(view.id);
        return;
      }
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
      // Leaving for the canvas: keep the layout, drop the dead dock. Checked a tick later, because
      // StrictMode's rehearsal unmount runs this too while the dock stays (and onReady does not rerun).
      saveLayoutNow();
      const mine = getDockApi();
      window.setTimeout(() => {
        if (getDockApi() === mine && !ref.current?.isConnected) setDockApi(null);
      }, 0);
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
