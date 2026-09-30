import { isEnabled, WORKSPACE_OS_FLAGS_ENV, type FeatureFlagKey } from "@/lib/feature-flags";

/**
 * The switch for phone screens (Workspace OS V1-16), off by default.
 * `wos_mobile` is not in the shared key list yet (S1 owns it), so the
 * staging override is read here too; integration folds this into isEnabled.
 */
export const MOBILE_FLAG = "wos_mobile";

export function overrideTurnsOn(key: string, raw: string | undefined = process.env[WORKSPACE_OS_FLAGS_ENV]): boolean {
  const names = (raw ?? "").split(",").map((name) => name.trim().toLowerCase());
  return names.includes("all") || names.includes(key);
}

export async function mobileEnabled(): Promise<boolean> {
  if (overrideTurnsOn(MOBILE_FLAG)) return true;
  return isEnabled(MOBILE_FLAG as FeatureFlagKey);
}
