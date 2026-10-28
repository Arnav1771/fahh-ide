/**
 * The saved Fahh Local sessions of the open folder, for Agent mode's sidebar and the
 * Ctrl+Shift+A session search.
 */
import { agentSessions } from "./agent";
import { useFileStore } from "../store/fileStore";
import type { AgentSessionInfo } from "./types";

/** Newest first; [] without a folder (sessions are stored per workspace). */
export async function listSessions(): Promise<AgentSessionInfo[]> {
  const root = useFileStore.getState().root;
  if (!root) return [];
  try {
    return (await agentSessions(root)).slice().sort((a, b) => b.updated - a.updated);
  } catch {
    return [];
  }
}

/** "just now", "5m ago", "3h ago", "4d ago", "2 wks ago", "3 mo ago". `updated` is in ms or s. */
export function ago(updated: number, now = Date.now()): string {
  const ms = updated < 1e12 ? updated * 1000 : updated;
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d}d ago`;
  if (d < 60) return `${Math.round(d / 7)} wks ago`;
  return `${Math.round(d / 30)} mo ago`;
}
