import { isEnabled, WORKSPACE_OS_FLAGS_ENV, type FeatureFlagKey } from "@/lib/feature-flags";

/**
 * The switch for meetings as objects (Workspace OS V1-9), off by default.
 *
 * `wos_meetings_v2` is not in the shared `workspaceOsFlagKeys` list yet (S1
 * owns that file), so the staging override is read here too: the same
 * WORKSPACE_OS_FLAGS variable, `all` or the key by name. Integration adds the
 * key to the shared list and this file becomes `isEnabled("wos_meetings_v2")`.
 */
export const MEETINGS_V2_FLAG = "wos_meetings_v2";

export function overrideTurnsOn(key: string, raw: string | undefined = process.env[WORKSPACE_OS_FLAGS_ENV]): boolean {
  const names = (raw ?? "").split(",").map((name) => name.trim().toLowerCase());
  return names.includes("all") || names.includes(key);
}

export async function meetingsV2Enabled(): Promise<boolean> {
  if (overrideTurnsOn(MEETINGS_V2_FLAG)) return true;
  return isEnabled(MEETINGS_V2_FLAG as FeatureFlagKey);
}
