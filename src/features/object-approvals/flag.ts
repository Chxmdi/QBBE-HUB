import { isEnabled, WORKSPACE_OS_FLAGS_ENV, type FeatureFlagKey } from "@/lib/feature-flags";

/**
 * The switch for approvals on any object (Workspace OS V2-7), off by default.
 * `wos_object_approvals` is not in the shared key list yet (S1 owns it), so the
 * staging override is read here too; integration folds this into isEnabled.
 */
export const OBJECT_APPROVALS_FLAG = "wos_object_approvals";

export function overrideTurnsOn(key: string, raw: string | undefined = process.env[WORKSPACE_OS_FLAGS_ENV]): boolean {
  const names = (raw ?? "").split(",").map((name) => name.trim().toLowerCase());
  return names.includes("all") || names.includes(key);
}

export async function objectApprovalsEnabled(): Promise<boolean> {
  if (overrideTurnsOn(OBJECT_APPROVALS_FLAG)) return true;
  return isEnabled(OBJECT_APPROVALS_FLAG as FeatureFlagKey);
}
