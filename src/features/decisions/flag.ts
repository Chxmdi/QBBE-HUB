import { isEnabled, WORKSPACE_OS_FLAGS_ENV, type FeatureFlagKey } from "@/lib/feature-flags";

/**
 * The switch for full decisions (Workspace OS V1-10), off by default.
 * `wos_decisions_v2` is not in the shared key list yet (S1 owns it), so the
 * staging override is read here too; integration folds this into isEnabled.
 */
export const DECISIONS_V2_FLAG = "wos_decisions_v2";

export function overrideTurnsOn(key: string, raw: string | undefined = process.env[WORKSPACE_OS_FLAGS_ENV]): boolean {
  const names = (raw ?? "").split(",").map((name) => name.trim().toLowerCase());
  return names.includes("all") || names.includes(key);
}

export async function decisionsV2Enabled(): Promise<boolean> {
  if (overrideTurnsOn(DECISIONS_V2_FLAG)) return true;
  return isEnabled(DECISIONS_V2_FLAG as FeatureFlagKey);
}
