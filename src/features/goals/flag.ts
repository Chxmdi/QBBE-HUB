import { isEnabled, WORKSPACE_OS_FLAGS_ENV, type FeatureFlagKey } from "@/lib/feature-flags";

/**
 * The switch for goals (Workspace OS V1-11), off by default.
 * `wos_goals` is not in the shared key list yet (S1 owns it), so the
 * staging override is read here too; integration folds this into isEnabled.
 */
export const GOALS_FLAG = "wos_goals";

export function overrideTurnsOn(key: string, raw: string | undefined = process.env[WORKSPACE_OS_FLAGS_ENV]): boolean {
  const names = (raw ?? "").split(",").map((name) => name.trim().toLowerCase());
  return names.includes("all") || names.includes(key);
}

export async function goalsEnabled(): Promise<boolean> {
  if (overrideTurnsOn(GOALS_FLAG)) return true;
  return isEnabled(GOALS_FLAG as FeatureFlagKey);
}
