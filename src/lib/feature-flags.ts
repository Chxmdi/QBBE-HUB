import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Feature switches read on the server (W0-4, epic #199).
 *
 * Each Workspace OS module is merged unfinished and stays hidden until its row
 * in `feature_flag` is turned on (migration 20261101000100). Staging can turn
 * modules on without touching the table through WORKSPACE_OS_FLAGS: a
 * comma-separated list of keys, or `all`. The override can only turn a switch
 * on, never off, and production never sets it
 * (docs/runbooks/staging-provisioning.md, step 4c).
 */

export const workspaceOsFlagKeys = [
  "wos_objects",
  "wos_spaces",
  "wos_pages",
  "wos_editor",
  "wos_lenses",
  "wos_home",
  "wos_capture",
  "wos_workflows_v2",
  "wos_forms_v2",
  "wos_public_pages",
  "wos_offline",
  // Stream S5b (20261105110000_s5b_feature_switches).
  "wos_meetings_v2",
  "wos_decisions_v2",
  "wos_goals",
  "wos_mobile",
  "wos_object_approvals",
] as const;

export type WorkspaceOsFlagKey = (typeof workspaceOsFlagKeys)[number];

/** Switches that existed before Workspace OS (0008_spec_delivery). */
export type LegacyFlagKey =
  | "notification_email"
  | "gmail_inbox"
  | "google_calendar_overlay"
  | "volunteer_vms"
  | "workflow_rules";

export type FeatureFlagKey = WorkspaceOsFlagKey | LegacyFlagKey;

export const WORKSPACE_OS_FLAGS_ENV = "WORKSPACE_OS_FLAGS";

/**
 * The Workspace OS keys the environment override turns on. Unknown names are
 * ignored rather than rejected, so a typo cannot break a deploy; it simply
 * leaves that module off, which is the safe direction.
 */
export function overriddenFlags(
  raw: string | undefined = process.env[WORKSPACE_OS_FLAGS_ENV],
): ReadonlySet<WorkspaceOsFlagKey> {
  const names = (raw ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (names.includes("all")) return new Set(workspaceOsFlagKeys);
  return new Set(
    workspaceOsFlagKeys.filter((key) => names.includes(key)),
  );
}

type FlagReader = Pick<
  Awaited<ReturnType<typeof createSupabaseServerClient>>,
  "from"
>;

/**
 * Whether a switch is on for the current request. Reads through the caller's
 * own session, so RLS decides what is visible; a signed-out request, a missing
 * row or a read error all answer false.
 */
export async function isEnabled(
  key: FeatureFlagKey,
  client?: FlagReader,
): Promise<boolean> {
  if ((overriddenFlags() as ReadonlySet<string>).has(key)) return true;
  const reader = client ?? (await createSupabaseServerClient());
  const { data, error } = await reader
    .from("feature_flag")
    .select("enabled")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return false;
  return data.enabled === true;
}
