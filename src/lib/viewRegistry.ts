import type { ComponentType } from "react";

/** Where a view first appears: the left bar, the right bar, the bottom panel or the editor area. */
export type ViewLocation = "sidebar" | "secondary" | "panel" | "editor";

export interface ViewDef {
  /** Stable id: it is saved in layouts, so never rename a shipped view. */
  id: string;
  title: string;
  /** lucide-style icon: takes `size`. Shown in the activity bar. */
  icon: ComponentType<{ size?: number | string }>;
  component: ComponentType;
  defaultLocation: ViewLocation;
  /** Show an activity-bar button (default true). */
  activityBar?: boolean;
  /** Open in the default layout (default true). A view that is not opened is added when first revealed. */
  defaultOpen?: boolean;
}

const views = new Map<string, ViewDef>();

/**
 * Plug a panel into the workbench. Re-registering an id replaces it (hot reload).
 * Nothing in the layout code needs to change: see src/views/index.ts.
 */
export function registerView(def: ViewDef): void {
  views.set(def.id, def);
}

export const getView = (id: string): ViewDef | undefined => views.get(id);
export const listViews = (): ViewDef[] => [...views.values()];

/** Test-only. */
export function clearViews(): void {
  views.clear();
}
