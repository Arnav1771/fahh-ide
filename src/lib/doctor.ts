import { invoke } from "@tauri-apps/api/core";

/** One line of Help > Check Setup (core/setup.rs `check_setup`). */
export interface SetupCheck {
  name: string;
  kind: "tool" | "language server";
  found: boolean;
  version: string | null;
  program: string | null;
  hint: string;
}

export const checkSetup = () => invoke<SetupCheck[]>("check_setup");

/** Tools first, then language servers; drops anything malformed the backend might send. */
export function sortChecks(raw: unknown): SetupCheck[] {
  if (!Array.isArray(raw)) return [];
  const ok = raw.filter((c): c is SetupCheck => !!c && typeof c.name === "string" && typeof c.found === "boolean");
  return [...ok.filter((c) => c.kind !== "language server"), ...ok.filter((c) => c.kind === "language server")];
}

/** "All 8 found." or "2 missing: node, cargo." */
export function summarize(checks: SetupCheck[]): string {
  if (checks.length === 0) return "Nothing was checked.";
  const missing = checks.filter((c) => !c.found).map((c) => c.name);
  return missing.length === 0 ? `All ${checks.length} found.` : `${missing.length} missing: ${missing.join(", ")}.`;
}
